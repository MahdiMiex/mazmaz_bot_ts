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
