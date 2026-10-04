import { Context } from "grammy";
import { CONFIG } from "../config";
import { HttpsProxyAgent } from "https-proxy-agent";

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

export const webToolsDeclaration = [
  {
    name: "fetch_web_page",
    description: "استخراج متن کامل و تمیز یک صفحه وب برای مطالعه و خلاصهسازی اخبار یا مقالات",
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING", description: "آدرس کامل صفحه وب با http یا https" }
      },
      required: ["url"]
    }
  },
  {
    name: "take_web_screenshot",
    description: "گرفتن اسکرینشات از صفحه وب و ارسال مستقیم آن به کاربر در تلگرام بدون درگیر کردن رم سرور",
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING", description: "آدرس کامل صفحه وب" }
      },
      required: ["url"]
    }
  }
];

export async function captureWebScreenshot(ctx: Context, url: string, caption?: string) {
  const targetUrl = url.startsWith("http") ? url : `https://${url}`;

  // سرویس سبک ابری بدون درگیری کرومیوم و رم سرور
  const apiUrl = `https://api.microlink.io?url=${encodeURIComponent(
    targetUrl
  )}&screenshot=true&meta=false&embed=screenshot.url&waitForTimeout=1500`;

  await ctx.replyWithPhoto(apiUrl, {
    caption: caption || `📸 اسکرین‌شات از: ${targetUrl}`,
    reply_to_message_id: ctx.msg?.message_id,
  });
}

export async function executeWebTool(ctx: Context, name: string, args: any): Promise<any> {
  if (name === "fetch_web_page") {
    try {
      let rawUrl = (args?.url || "").trim();
      if (!rawUrl) return { error: "آدرس وب‌سایت وارد نشده است." };
      if (!/^https?:\/\//i.test(rawUrl)) {
        rawUrl = `https://${rawUrl}`;
      }

      const fetchOpts: any = {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      };
      if (agent) {
        fetchOpts.agent = agent;
      }

      const res = await fetch(`https://r.jina.ai/${rawUrl}`, fetchOpts);
      if (!res.ok) return { error: `خطا در دریافت صفحه: ${res.statusText}` };
      const text = await res.text();
      return { content: text.slice(0, 8000) }; // برش متن برای مدیریت کانتکست
    } catch (err: any) {
      return { error: err?.message || String(err) };
    }
  }

  if (name === "take_web_screenshot") {
    try {
      const rawUrl = (args?.url || "").trim();
      if (!rawUrl) return { error: "آدرس صفحه برای اسکرین‌شات مشخص نشده است." };
      if (!ctx || !ctx.replyWithPhoto) {
        return { error: "کانتکست چت تلگرام برای ارسال مستقیم عکس در دسترس نیست." };
      }

      await captureWebScreenshot(ctx, rawUrl);
      return { success: true, message: "اسکرین‌شات با موفقیت ارسال شد." };
    } catch (err: any) {
      console.error("[SCREENSHOT ERROR]:", err?.message || err);
      return { error: `خطا در دریافت اسکرین‌شات: ${err?.message || String(err)}` };
    }
  }

  return { error: "ابزار یافت نشد" };
}
