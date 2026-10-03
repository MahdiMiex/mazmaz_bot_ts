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
 * Tier 4: DuckDuckGo Scraper (Default Zero-Config fallback with retry)
 */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  let html = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
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
      if (res.ok) {
        html = await res.text();
        break;
      }
    } catch (e: any) {
      if (attempt === 1) {
        console.warn("[DDG SCRAPE] Connection dropped, returning fallback:", e?.message);
        return `امکان برقراری ارتباط با وب‌سرچ برای «${query}» در این لحظه میسر نشد. لطفاً بر اساس دانش داخلی خودت پاسخ بده.`;
      }
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  if (!html) {
    return `امکان برقراری ارتباط با وب‌سرچ برای «${query}» در این لحظه میسر نشد. لطفاً بر اساس دانش داخلی خودت پاسخ بده.`;
  }

  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  $(".result").slice(0, maxResults).each((_, el) => {
    const title = $(el).find(".result__title").text().trim();
    const snippet = $(el).find(".result__snippet").text().trim();
    const rawLink = $(el).find(".result__url").text().trim();

    if (title && (snippet || rawLink)) {
      results.push({
        title,
        snippet: (snippet || "بدون توضیح").slice(0, 160),
        link: cleanUrl(rawLink),
      });
    }
  });

  if (results.length === 0) {
    return `هیچ نتیجه‌ای در وب برای «${query}» پیدا نشد.`;
  }

  const formatted = results
    .map(
      (r, i) =>
        `[${i + 1}] <b>${r.title}</b>\n• ${r.snippet}...\n• منبع: ${r.link}`
    )
    .join("\n\n");

  return `🔍 <b>نتایج زنده وب:</b>\n\n${formatted}`;
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

    // 4. Default resilient fallback: DuckDuckGo scraper
    if (!output) {
      try {
        output = await searchDuckDuckGo(cleanQuery, maxResults);
      } catch (e: any) {
        console.warn("[SEARCH FALLBACK] Error in searchDuckDuckGo:", e?.message);
        output = `امکان استعلام وب در این لحظه میسر نشد. لطفاً بر اساس اطلاعات موجود پاسخ کامل بده.`;
      }
    }

    // Token Guard: Hard cap output length to ~1400 chars (prevents token inflation)
    if (output.length > 1400) {
      output = output.slice(0, 1400) + "\n\n...(سایر نتایج برای کاهش مصرف توکن خلاصه شدند)";
    }

    return output;
  });
}
