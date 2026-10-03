import * as cheerio from "cheerio";
import { HttpsProxyAgent } from "https-proxy-agent";
import { CONFIG } from "../config";
import { runToolWithLogger } from "../utils/toolLogger";

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

export interface SearchResult {
  title: string;
  snippet: string;
  link: string;
}

export async function searchWeb(query: string, maxResults = 4): Promise<string> {
  return await runToolWithLogger("SEARCH", query, async () => {
    const cleanQuery = query.trim();
    if (!cleanQuery) return "عبارت جستجو خالی است.";

    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fa,en-US;q=0.9,en;q=0.8",
      },
      // @ts-ignore
      agent,
    });

    if (!res.ok) {
      throw new Error(`خطای دریافت نتایج جستجو از موتور وب: کد ${res.status}`);
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $(".result").slice(0, maxResults).each((_, el) => {
      const title = $(el).find(".result__title").text().trim();
      const snippet = $(el).find(".result__snippet").text().trim();
      const rawLink = $(el).find(".result__url").text().trim();

      if (title && (snippet || rawLink)) {
        results.push({
          title,
          snippet: snippet || "بدون توضیح",
          link: rawLink.startsWith("http") ? rawLink : `https://${rawLink}`,
        });
      }
    });

    if (results.length === 0) {
      return `هیچ نتیجه‌ای در وب برای «${cleanQuery}» پیدا نشد.`;
    }

    const formatted = results
      .map(
        (r, i) =>
          `[${i + 1}] عنوان: ${r.title}\nتوضیحات: ${r.snippet}\nلینک منبع: ${r.link}`
      )
      .join("\n\n");

    return `🔍 نتایج زنده وب برای «${cleanQuery}»:\n\n${formatted}`;
  });
}
