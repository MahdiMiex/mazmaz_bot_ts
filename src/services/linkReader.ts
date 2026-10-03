import * as cheerio from "cheerio";
import { CONFIG } from "../config";
import { HttpsProxyAgent } from "https-proxy-agent";
import { askGemini } from "./ai";

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

export function isGeneralWebUrl(text: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(text.trim());
}

export async function fetchAndAnalyzeLink(
  userId: number,
  url: string,
  userInstruction = ""
): Promise<string> {
  try {
    let cleanUrl = url.trim();
    let siteType = "وب‌سایت";

    // Handle Reddit
    if (cleanUrl.includes("reddit.com")) {
      siteType = "ردیت (Reddit)";
      // Reddit JSON endpoint
      const jsonUrl = cleanUrl.replace(/\/$/, "") + ".json";
      try {
        const rRes = await fetch(jsonUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
          // @ts-ignore
          agent,
        });
        if (rRes.ok) {
          const rData = (await rRes.json()) as any;
          const post = rData[0]?.data?.children[0]?.data;
          if (post) {
            const content = `عنوان پست ردیت: ${post.title}\nمتن پست: ${post.selftext || "(پست چندرسانه‌ای)"}\nساب‌ردیت: r/${post.subreddit}\nامتیاز: ${post.ups}`;
            const prompt = `این یک پست از ردیت است:\n${content}\n\nلطفاً آن را تحلیل، خلاصه و به زبان فارسی روان با نکات کلیدی برای من بیان کن.${userInstruction ? `\nدستور کاربر: ${userInstruction}` : ""}`;
            return await askGemini(userId, prompt);
          }
        }
      } catch (err) {
        console.warn("Reddit JSON failed, falling back to html:", err);
      }
    }

    // Handle Twitter / X
    if (cleanUrl.includes("twitter.com") || cleanUrl.includes("x.com")) {
      siteType = "توییتر / X";
      // Use fx/vx proxy for easy JSON/data
      const fxtwitterUrl = cleanUrl.replace(/twitter\.com|x\.com/, "api.fxtwitter.com");
      try {
        const tRes = await fetch(fxtwitterUrl, {
          // @ts-ignore
          agent,
        });
        if (tRes.ok) {
          const tData = (await tRes.json()) as any;
          if (tData.tweet) {
            const tweet = tData.tweet;
            const content = `توییت از: ${tweet.author?.name} (@${tweet.author?.screen_name})\nمتن توییت: ${tweet.text}\nلایک‌ها: ${tweet.likes} | بازنشر: ${tweet.retweets}`;
            const prompt = `این یک توییت است:\n${content}\n\nلطفاً پیام این توییت را به همراه تحلیل، مفهوم و خلاصه‌اش به فارسی توضیح بده.${userInstruction ? `\nدستور کاربر: ${userInstruction}` : ""}`;
            return await askGemini(userId, prompt);
          }
        }
      } catch (err) {
        console.warn("FxTwitter fetch failed:", err);
      }
    }

    // Standard Web Page / News Article
    const res = await fetch(cleanUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
      // @ts-ignore
      agent,
    });

    if (!res.ok) {
      return `❌ خطا در دریافت لینک ${siteType} (کد خطا: ${res.status})`;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Remove noise
    $("script, style, nav, footer, header, noscript, aside, form, svg").remove();

    const title = $("title").text().trim() || $("h1").first().text().trim() || "بدون عنوان";
    const bodyText = $("article, main, .content, #content, body")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4500);

    const prompt = (
      `من این لینک را فرستاده‌ام: ${cleanUrl}\n` +
      `عنوان صفحه: ${title}\n` +
      `متن استخراج شده از صفحه:\n${bodyText}\n\n` +
      `لطفاً به عنوان یک دستیار دانا و باهوش، این محتوا را خلاصه، تحلیل و نکات مهم و آموزنده آن را به صورت مرتب و با بولت‌پوینت توضیح بده.` +
      (userInstruction ? `\n\nهمچنین به این درخواست من دقت کن: ${userInstruction}` : "")
    );

    const analysis = await askGemini(userId, prompt);
    return `🌐 <b>تحلیل و خلاصه‌سازی محتوای لینک (${siteType}):</b>\n📌 <b>عنوان:</b> ${title}\n\n${analysis}`;
  } catch (err: any) {
    console.error("Link Reader error:", err);
    return `❌ خطا در تحلیل لینک: ${err.message || err}`;
  }
}

/**
 * Directly scrapes and extracts clean readable text from a URL for AI tools (without calling askGemini).
 */
export async function scrapeWebPageContent(url: string): Promise<string> {
  const result = await executeFetchPage(url, 4000);
  if (!result.ok) {
    return `خطا در باز کردن وب‌سایت: ${result.error}`;
  }
  return `لینک: ${result.url}\nمحتوای متنی استخراج‌شده از وب:\n${result.content}`;
}

// ۱. تعریف اسکیما برای هوش مصنوعی
export const fetchPageTool = {
  name: "fetch_page",
  description: "باز کردن لینک‌های وب و استخراج متن اصلی صفحه بدون بارگذاری تبلیغات و استایل‌ها",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "آدرس کامل صفحه وب (شامل http:// یا https://)" }
    },
    required: ["url"]
  }
};

// ۲. تابع استخراج متن از لینک
export async function executeFetchPage(url: string, maxLength = 4000): Promise<{ ok: boolean; url?: string; content?: string; error?: string }> {
  try {
    const cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) {
      return { ok: false, error: "آدرس وب‌سایت نامعتبر است. آدرس باید با http:// یا https:// شروع شود." };
    }

    // ۱. هندلر اختصاصی ردیت (پشتیبانی کامل از Reddit RSS و JSON بدون بلاک کلودفلر)
    if (cleanUrl.includes("reddit.com")) {
      const rssUrl = cleanUrl.replace(/\/$/, "") + "/.rss";
      try {
        const rssRes = await fetch(rssUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
          signal: AbortSignal.timeout(10000),
          ...(agent ? { agent } : {})
        });
        if (rssRes.ok) {
          const xml = await rssRes.text();
          if (xml.includes("<feed") || xml.includes("<entry")) {
            const doc = cheerio.load(xml, { xmlMode: true });
            const feedTitle = doc("feed > title").text().trim();
            const entries: string[] = [];
            doc("entry").slice(0, 5).each((i, el) => {
              const entryTitle = doc(el).find("title").text().trim();
              const author = doc(el).find("author name").text().trim();
              const contentHtml = doc(el).find("content").text();
              const cleanContent = cheerio.load(contentHtml).text().replace(/\s+/g, " ").trim().slice(0, 300);
              entries.push(`[${i + 1}] ${entryTitle} (توسط ${author})\n${cleanContent}`);
            });
            if (entries.length > 0) {
              const rContent = `ردیت: ${feedTitle}\n\n` + entries.join("\n\n");
              return { ok: true, url: cleanUrl, content: rContent.slice(0, maxLength) };
            }
          }
        }
      } catch (rssErr) {
        console.warn("Reddit RSS fetch failed, falling back:", rssErr);
      }

      // روش دوم: Reddit JSON
      const jsonUrl = cleanUrl.replace(/\/$/, "") + ".json";
      try {
        const rRes = await fetch(jsonUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
          signal: AbortSignal.timeout(10000),
          ...(agent ? { agent } : {})
        });
        if (rRes.ok) {
          const rData = (await rRes.json()) as any;
          const post = rData[0]?.data?.children[0]?.data;
          if (post) {
            let rContent = `عنوان پست ردیت: ${post.title}\nمتن پست: ${post.selftext || "(پست رسانه‌ای یا بدون متن)"}\nساب‌ردیت: r/${post.subreddit}\nامتیاز: ${post.ups}`;
            const comments = rData[1]?.data?.children || [];
            if (comments.length > 0) {
              rContent += "\n\nبرترین کامنت‌ها:";
              for (const c of comments.slice(0, 3)) {
                if (c.data?.body) {
                  rContent += `\n• [${c.data.author}]: ${c.data.body.slice(0, 250)}`;
                }
              }
            }
            return { ok: true, url: cleanUrl, content: rContent.slice(0, maxLength) };
          }
        }
      } catch (err) {
        console.warn("Reddit direct JSON failed:", err);
      }
    }

    // ۲. هندلر اختصاصی توییتر / X
    if (cleanUrl.includes("twitter.com") || cleanUrl.includes("x.com")) {
      const fxtwitterUrl = cleanUrl.replace(/twitter\.com|x\.com/, "api.fxtwitter.com");
      try {
        const tRes = await fetch(fxtwitterUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; mazmazBot/1.0)" },
          signal: AbortSignal.timeout(10000),
          ...(agent ? { agent } : {})
        });
        if (tRes.ok) {
          const tData = (await tRes.json()) as any;
          if (tData.tweet) {
            const tweet = tData.tweet;
            const tContent = `توییت از: ${tweet.author?.name} (@${tweet.author?.screen_name})\nمتن توییت: ${tweet.text}\nتاریخ: ${tweet.created_at || ""}\nآمار: ${tweet.likes || 0} لایک | ${tweet.retweets || 0} ریتوییت`;
            return { ok: true, url: cleanUrl, content: tContent.slice(0, maxLength) };
          }
        }
      } catch (err) {
        console.warn("FxTwitter fetch failed, falling back:", err);
      }
    }

    // ۳. پردازش استاندارد وب‌سایت‌ها و سایت‌های خبری با Cheerio
    const fetchOptions: any = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      signal: AbortSignal.timeout(10000)
    };
    if (agent) {
      fetchOptions.agent = agent;
    }

    try {
      const res = await fetch(cleanUrl, fetchOptions);
      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);

        // حذف تبلیغات، استایل‌ها و نویزها
        $("script, style, noscript, nav, footer, header, svg, iframe, .ad, .ads, .advertisement, .cookie, #cookie, .banner, .popup, #comments, .comments").remove();

        const title = $("meta[property='og:title']").attr("content") || $("title").text().trim() || $("h1").first().text().trim() || "";
        const description = $("meta[property='og:description']").attr("content") || $("meta[name='description']").attr("content") || "";

        // اولویت با تگ‌های اختصاصی مقالات و اخبار
        const articleEl = $("article, main, [itemprop='articleBody'], .post-content, .entry-content, .article-content, .article-body, .story-body, #content");
        let text = (articleEl.length ? articleEl.text() : $("body").text())
          .replace(/\s+/g, " ")
          .trim();

        if (text.length > 80) {
          let finalContent = "";
          if (title) finalContent += `عنوان صفحه: ${title}\n`;
          if (description && !text.includes(description.slice(0, 30))) finalContent += `خلاصه صفحه: ${description}\n\n`;
          finalContent += text;
          return { ok: true, url: cleanUrl, content: finalContent.slice(0, maxLength) };
        }
      }
    } catch (e: any) {
      console.warn("Direct Cheerio scrape failed, trying Jina AI Reader:", e?.message || e);
    }

    // ۴. پشتیبان قدرتمند برای سایت‌های تک‌صفحه‌ای (SPA)، کلاینت‌ساید و سایت‌های خبری قفل‌شده با Jina AI Reader
    try {
      const jinaRes = await fetch(`https://r.jina.ai/${cleanUrl}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(10000),
        ...(agent ? { agent } : {})
      });
      if (jinaRes.ok) {
        const jinaText = await jinaRes.text();
        if (jinaText && jinaText.length > 100) {
          return { ok: true, url: cleanUrl, content: jinaText.slice(0, maxLength) };
        }
      }
    } catch (jinaErr: any) {
      console.warn("Jina AI Reader failed:", jinaErr?.message || jinaErr);
    }

    return { ok: false, error: "متن قابل استخراجی در این صفحه یافت نشد." };
  } catch (err: any) {
    return { ok: false, error: err?.message || "خطا در برقراری ارتباط با سایت" };
  }
}

// ۳. هندلر اتصال به ایجنت
export async function handleAgentTool(name: string, args: { url?: string }) {
  if (name === "fetch_page" && args.url) {
    return await executeFetchPage(args.url);
  }
  return { error: "ابزار نامعتبر" };
}

