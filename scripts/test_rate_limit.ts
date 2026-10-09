import { GoogleGenAI } from "@google/genai";
import { HttpsProxyAgent } from "https-proxy-agent";

// Load configuration
const apiKey = process.argv[2] || process.env.GEMINI_API_KEY;
const proxyUrl = process.env.PROXY_URL || "http://127.0.0.1:10808";
const useProxy = process.env.USE_PROXY === "true";

if (!apiKey || apiKey.length < 10) {
  console.error("❌ لطفا کلید API را وارد کنید یا در متغیر GEMINI_API_KEY قرار دهید.");
  console.log("استفاده: bun run scripts/test_rate_limit.ts <API_KEY>");
  process.exit(1);
}

const agent = useProxy ? new HttpsProxyAgent(proxyUrl) : undefined;
const ai = new GoogleGenAI({
  apiKey,
  // @ts-ignore
  httpOptions: agent ? { agent } : undefined,
});

const model = process.env.AI_MODEL || "gemini-3.7-flash";
const CONCURRENT_REQUESTS = 6;

console.log("==========================================");
console.log(`🚀 شروع تست استرس لیمیت و سرعت API گوگل`);
console.log(`📦 مدل هدف: ${model}`);
console.log(`⚡ تعداد درخواست همزمان (Concurrent): ${CONCURRENT_REQUESTS}`);
console.log(`🌐 پروکسی: ${useProxy ? proxyUrl : "بدون پروکسی (مستقیم)"}`);
console.log("==========================================\n");

const prompts = [
  "سلام! در یک جمله خودت را معرفی کن.",
  "پایتون سریع‌تر است یا جاوا اسکریپت؟ فقط ۲ کلمه بگو.",
  "پایتخت فرانسه کجاست؟",
  "یک جوک خیلی کوتاه خنده‌دار بگو.",
  "فرمول قانون دوم نیوتون چیست؟",
  "بزرگترین سیاره منظومه شمسی کدام است؟",
];

async function runSingleTest(id: number, prompt: string) {
  const start = performance.now();
  try {
    const res = await ai.models.generateContent({
      model,
      contents: prompt,
    });
    const duration = Math.round(performance.now() - start);
    const text = res.text?.trim() || "";
    console.log(`✅ [درخواست #${id}] موفق (${duration}ms) -> "${text.slice(0, 45)}..."`);
    return { ok: true, duration, status: 200, id };
  } catch (err: any) {
    const duration = Math.round(performance.now() - start);
    const status = err?.status || err?.error?.code || (String(err?.message || "").includes("429") ? 429 : 500);
    console.log(`❌ [درخواست #${id}] خطا (${status}) (${duration}ms): ${err?.message?.slice(0, 60) || err}`);
    return { ok: false, duration, status, id };
  }
}

async function main() {
  console.log(`⏳ در حال ارسال همزمان ${CONCURRENT_REQUESTS} درخواست به Google Gemini...\n`);
  const overallStart = performance.now();

  const results = await Promise.all(
    prompts.slice(0, CONCURRENT_REQUESTS).map((p, i) => runSingleTest(i + 1, p))
  );

  const totalTime = Math.round(performance.now() - overallStart);
  const successCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;
  const avgLatency = Math.round(
    results.reduce((acc, r) => acc + r.duration, 0) / results.length
  );

  console.log("\n==========================================");
  console.log("📊 نتیجه نهایی بنچمارک:");
  console.log(`• تعداد کل درخواست‌ها: ${results.length}`);
  console.log(`• موفق: ${successCount} ✅`);
  console.log(`• لیمیت یا خطا: ${failCount} ❌`);
  console.log(`• میانگین زمان پاسخگویی: ${avgLatency} میلی‌ثانیه`);
  console.log(`• کل زمان پردازش همزمان: ${totalTime} میلی‌ثانیه`);

  if (failCount === 0) {
    console.log(`\n🎉 عالی! کلید شما بدون لیمیت به صورت همزمان تمام ${CONCURRENT_REQUESTS} درخواست را زیر ${totalTime}ms پردازش کرد!`);
  } else if (results.some((r) => r.status === 429)) {
    console.log("\n⚠️ یکی از درخواست‌ها با لیمیت 429 مواجه شد (سقف در دقیقه). سیستم چرخش کلید بات خودکار این را حل می‌کند.");
  }
  console.log("==========================================");
}

main();
