import * as cheerio from "cheerio";
import { HttpsProxyAgent } from "https-proxy-agent";
import { search, SafeSearchType } from "duck-duck-scrape";
import { CONFIG } from "../config";
import { runToolWithLogger } from "../utils/toolLogger";

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

export interface SearchResult {
  title: string;
  snippet: string;
  link: string;
}

/**
 * Removes UTM and tracking parameters to save token budget.
 */
function cleanUrl(raw: string): string {
  try {
    if (raw.includes("duckduckgo.com/l/?uddg=")) {
      const match = raw.match(/uddg=([^&]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
    const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    parsed.searchParams.delete("utm_source");
    parsed.searchParams.delete("utm_medium");
    parsed.searchParams.delete("utm_campaign");
    parsed.searchParams.delete("fbclid");
    parsed.searchParams.delete("gclid");
    return parsed.toString();
  } catch {
    return raw;
  }
}

/**
 * Tier 1: Tavily AI Search API (Token-optimized for LLMs)
 */
async function searchTavily(query: string, maxResults: number): Promise<string | null> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: CONFIG.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      include_answer: true,
      max_results: maxResults,
    }),
    // @ts-ignore
    agent,
  });

  if (!res.ok) return null;
  const data: any = await res.json();
  const results: any[] = data.results || [];

  let text = "";
  if (data.answer) {
    text += `💡 <b>پاسخ سریع Tavily:</b> ${data.answer.trim()}\n\n`;
  }

  if (results.length > 0) {
    text += "🔍 <b>نتایج مرتبط:</b>\n";
    text += results
      .slice(0, maxResults)
      .map(
        (r, i) =>
          `[${i + 1}] <b>${r.title}</b>\n• ${r.content.slice(0, 160).trim()}...\n• منبع: ${cleanUrl(r.url)}`
      )
      .join("\n\n");
  }

  return text.trim() || null;
}

/**
 * Tier 2: Brave Search API
 */
async function searchBrave(query: string, maxResults: number): Promise<string | null> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": CONFIG.BRAVE_API_KEY,
    },
    // @ts-ignore
    agent,
  });

  if (!res.ok) return null;
  const data: any = await res.json();
  const results: any[] = data.web?.results || [];

  if (results.length === 0) return null;

  const formatted = results
    .slice(0, maxResults)
    .map(
      (r, i) =>
        `[${i + 1}] <b>${r.title}</b>\n• ${(r.description || "").slice(0, 160).trim()}...\n• منبع: ${cleanUrl(r.url)}`
    )
    .join("\n\n");

  return `🔍 <b>نتایج زنده وب (Brave Search):</b>\n\n${formatted}`;
}

/**
 * Tier 3: SearXNG Self-Hosted Meta-Engine
 */
async function searchSearXNG(query: string, maxResults: number): Promise<string | null> {
  const baseUrl = CONFIG.SEARXNG_URL.replace(/\/$/, "");
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) return null;
  const data: any = await res.json();
  const results: any[] = data.results || [];

  if (results.length === 0) return null;

  const formatted = results
    .slice(0, maxResults)
    .map(
      (r, i) =>
        `[${i + 1}] <b>${r.title}</b>\n• ${(r.content || "").slice(0, 160).trim()}...\n• منبع: ${cleanUrl(r.url)}`
    )
    .join("\n\n");

  return `🔍 <b>نتایج تجمیعی وب (SearXNG):</b>\n\n${formatted}`;
}

/**
 * Tier 4: DuckDuckGo Lite Scraper (Instant zero-bot-challenge scraping)
 */
async function searchDuckDuckGoLite(query: string, maxResults: number): Promise<string | null> {
  const url = "https://lite.duckduckgo.com/lite/";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      body: "q=" + encodeURIComponent(query),
      // @ts-ignore
      agent,
    });

    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $(".result-link").slice(0, maxResults).each((_, el) => {
      const title = $(el).text().trim();
      const rawLink = $(el).attr("href") || "";
      const tr = $(el).closest("tr");
      const snippet = tr.next().find(".result-snippet").text().trim();

      if (title && (snippet || rawLink)) {
        results.push({
          title,
          snippet: snippet || "بدون توضیح",
          link: cleanUrl(rawLink),
        });
      }
    });

    if (results.length === 0) return null;

    const formatted = results
      .map(
        (r, i) =>
          `[${i + 1}] <b>${r.title}</b>\n• ${r.snippet.slice(0, 160)}...\n• منبع: ${r.link}`
      )
      .join("\n\n");

    return `🔍 <b>نتایج زنده وب (DuckDuckGo):</b>\n\n${formatted}`;
  } catch (e: any) {
    console.warn("[DDG LITE] Failed:", e?.message);
    return null;
  }
}

/**
 * Tier 5: Google News RSS Scraper (Real-time breaking events and headlines)
 */
async function searchGoogleNews(query: string, maxResults: number): Promise<string | null> {
  const isFa = /[\u0600-\u06FF]/.test(query);
  const langParams = isFa ? "&hl=fa&gl=IR&ceid=IR:fa" : "&hl=en-US&gl=US&ceid=US:en";
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}${langParams}`;

  try {
    const res = await fetch(url, {
      // @ts-ignore
      agent,
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    const items: SearchResult[] = [];

    $("item").slice(0, maxResults).each((_, el) => {
      const title = $(el).find("title").text().trim();
      const link = $(el).find("link").text().trim();
      const pubDate = $(el).find("pubDate").text().trim();

      if (title) {
        items.push({
          title,
          snippet: pubDate ? `تاریخ انتشار: ${pubDate}` : "خبر برخط",
          link: cleanUrl(link),
        });
      }
    });

    if (items.length === 0) return null;

    const formatted = items
      .map(
        (r, i) =>
          `[${i + 1}] <b>${r.title}</b>\n• ${r.snippet}\n• منبع: ${r.link}`
      )
      .join("\n\n");

    return `📰 <b>جدیدترین اخبار برخط (Google News):</b>\n\n${formatted}`;
  } catch (e: any) {
    console.warn("[GOOGLE NEWS RSS] Failed:", e?.message);
    return null;
  }
}

/**
 * Token-optimized multi-tier web search:
 * Strictly caps output length to ~1,200 characters (~300 tokens) to prevent LLM bloat.
 */
export async function searchWeb(query: string, maxResults = 3): Promise<string> {
  return await runToolWithLogger("SEARCH", query, async () => {
    const cleanQuery = query.trim().slice(0, 120);
    if (!cleanQuery) return "عبارت جستجو خالی است.";

    let output = "";

    // 1. Tavily AI Search (if key provided)
    if (CONFIG.TAVILY_API_KEY) {
      try {
        const tavilyRes = await searchTavily(cleanQuery, maxResults);
        if (tavilyRes) output = tavilyRes;
      } catch (err: any) {
        console.warn("[TAVILY SEARCH] Failed:", err?.message);
      }
    }

    // 2. Brave Search API (if key provided)
    if (!output && CONFIG.BRAVE_API_KEY) {
      try {
        const braveRes = await searchBrave(cleanQuery, maxResults);
        if (braveRes) output = braveRes;
      } catch (err: any) {
        console.warn("[BRAVE SEARCH] Failed:", err?.message);
      }
    }

    // 3. SearXNG (if local/remote URL provided)
    if (!output && CONFIG.SEARXNG_URL) {
      try {
        const searxRes = await searchSearXNG(cleanQuery, maxResults);
        if (searxRes) output = searxRes;
      } catch (err: any) {
        console.warn("[SEARXNG SEARCH] Failed:", err?.message);
      }
    }

    // 4. DuckDuckGo Lite Scraper (high-speed, clean, zero captcha)
    if (!output) {
      try {
        const ddgRes = await searchDuckDuckGoLite(cleanQuery, maxResults);
        if (ddgRes) output = ddgRes;
      } catch (e: any) {
        console.warn("[SEARCH FALLBACK] Error in searchDuckDuckGoLite:", e?.message);
      }
    }

    // 5. Google News RSS (if search looks like news or previous tiers gave empty)
    if (!output) {
      try {
        const newsRes = await searchGoogleNews(cleanQuery, maxResults);
        if (newsRes) output = newsRes;
      } catch (e: any) {
        console.warn("[SEARCH FALLBACK] Error in searchGoogleNews:", e?.message);
      }
    }

    if (!output) {
      output = `امکان استعلام وب در این لحظه میسر نشد. لطفاً بر اساس اطلاعات موجود و دانش خودت پاسخ کامل بده.`;
    }

    // Token Guard: Hard cap output length to ~1400 chars (prevents token inflation)
    if (output.length > 1400) {
      output = output.slice(0, 1400) + "\n\n...(سایر نتایج برای کاهش مصرف توکن خلاصه شدند)";
    }

    return output;
  });
}

export const webSearchTool = {
  name: "web_search",
  description: "جستجوی زنده در اینترنت برای اخبار، مستندات و اطلاعات جدید بدون کلید API",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "متن یا کلمه کلیدی جستجو" }
    },
    required: ["query"]
  }
};

export async function executeWebSearch(
  query: string,
  limit = 4
): Promise<{ ok: boolean; data?: Array<{ title: string; url: string; snippet: string }>; error?: string }> {
  // scrape first results page directly; upgrade to serp API if bot hits rate limits
  try {
    const searchResults = await search(query, {
      safeSearch: SafeSearchType.OFF
    });

    if (searchResults && searchResults.results && searchResults.results.length > 0) {
      const items = searchResults.results.slice(0, limit).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description
      }));
      return { ok: true, data: items };
    }
  } catch (err: any) {
    console.warn("[duck-duck-scrape] Primary scrape failed, falling back to multi-tier search engine:", err?.message || err);
  }

  // Fallback to our multi-tier search engine (Tavily, DuckDuckGo Lite, Brave, Google News RSS)
  try {
    const rawFallback = await searchWeb(query, limit);
    if (rawFallback && !rawFallback.includes("امکان استعلام وب در این لحظه میسر نشد")) {
      return {
        ok: true,
        data: [
          {
            title: `نتایج جستجو برای: ${query}`,
            url: "https://duckduckgo.com/?q=" + encodeURIComponent(query),
            snippet: rawFallback.slice(0, 800)
          }
        ]
      };
    }
    return { ok: false, error: "نتیجه‌ای یافت نشد." };
  } catch (fallbackErr: any) {
    return { ok: false, error: fallbackErr?.message || "خطا در برقراری ارتباط با موتور جستجو" };
  }
}

export async function handleAgentTool(name: string, args: { query?: string }) {
  if (name === "web_search" && args.query) {
    return await executeWebSearch(args.query);
  }
  return { error: "ابزار نامعتبر" };
}

