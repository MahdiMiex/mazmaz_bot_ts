import { askGemini } from "./ai";
import { CONFIG } from "../config";
import { HttpsProxyAgent } from "https-proxy-agent";
import * as cheerio from "cheerio";

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

export const LMSYS_ARENA_SUMMARY = `
🏆 <b>جدیدترین رتبه‌بندی بنچمارک‌های هوش مصنوعی (LMSYS Chatbot Arena):</b>

1. 🥇 <b>Gemini 2.0 Pro / Flash (Google)</b> - پیشتاز در مولتی‌مدال، کدنویسی و پاسخ‌دهی بلادرنگ
2. 🥈 <b>Claude 3.5 Sonnet (Anthropic)</b> - برترین مدل در تحلیل عمیق کد، لاجیک و مهندسی نرم‌افزار
3. 🥉 <b>GPT-4o / o1-preview (OpenAI)</b> - قدرت استدلال مرحله‌به‌مرحله و حل مسائل پیچیده ریاضی
4. 🔹 <b>DeepSeek V3 / R1</b> - شگفتی متن‌باز با کارایی فوق‌العاده بالا و هزینه نزدیک به صفر
5. 🔹 <b>Llama 3.3 70B (Meta)</b> - قدرتمندترین مدل متن‌باز عمومی
`;

export const TOP_HARDWARE_BENCHMARKS = `
💻 <b>برترین بنچمارک‌های سخت‌افزار (CPU, GPU & Mobile):</b>

📱 <b>پردازنده‌های موبایل (Geekbench 6 / AnTuTu):</b>
• <b>Apple A18 Pro (iPhone 16 Pro):</b> تک‌هسته‌ای: ~3400 | چندهسته‌ای: ~8500
• <b>Snapdragon 8 Elite (Gen 4):</b> تک‌هسته‌ای: ~3200 | چندهسته‌ای: ~10500 | قدرت گرافیکی خیره‌کننده
• <b>MediaTek Dimensity 9400:</b> تک‌هسته‌ای: ~3000 | چندهسته‌ای: ~9300

🖥️ <b>پردازنده‌های لپ‌تاپ و دسکتاپ (Cinebench R23):</b>
• <b>Apple M4 Pro / Max:</b> پیشتاز بازدهی انرژی و عملکرد تک‌هسته‌ای در لپ‌تاپ
• <b>AMD Ryzen 9 9950X / 7800X3D:</b> غول گیمینگ و رندرینگ چندهسته‌ای
• <b>Intel Core Ultra 9 285K (Arrow Lake):</b> بهینه‌سازی حرارتی و راندمان بالا
`;

export async function queryBenchmark(userId: number, deviceOrQuery: string): Promise<string> {
  const q = deviceOrQuery.trim().toLowerCase();

  if (q.includes("آرنا") || q.includes("arena") || q.includes("lmsys") || q.includes("هوش مصنوعی")) {
    return LMSYS_ARENA_SUMMARY;
  }

  // Live search for the requested device benchmark
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(deviceOrQuery + " benchmark geekbench specs")}`;
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
      // @ts-ignore
      agent,
    });

    let searchContext = "";
    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);
      const snippets = $(".result__snippet")
        .map((_, el) => $(el).text())
        .get()
        .slice(0, 4)
        .join("\n");
      searchContext = snippets;
    }

    const prompt = (
      `کاربر درخواست بنچمارک و مشخصات این دستگاه/قطعه را دارد: «${deviceOrQuery}»\n\n` +
      (searchContext ? `نتایج جستجوی زنده:\n${searchContext}\n\n` : "") +
      "لطفاً به عنوان یک کارشناس خبره سخت‌افزار و هوش مصنوعی، بنچمارک‌های اصلی (Geekbench, AnTuTu, Cinebench، امتیاز گیمینگ، عملکرد باتری و رقبای هم‌رده) را به صورت منظم، با اعداد تخمینی دقیق و مقایسه‌ای به زبان فارسی بیان کن."
    );

    const analysis = await askGemini(userId, prompt);
    return `⚡ <b>تحلیل تخصصی بنچمارک «${deviceOrQuery}»:</b>\n\n${analysis}`;
  } catch (err) {
    return `${TOP_HARDWARE_BENCHMARKS}\n\n💡 برای بنچمارک قطعه خاص کافیه بنویسی: <code>بنچمارک [اسم مدل یا گوشی]</code>`;
  }
}
