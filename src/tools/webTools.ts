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
      let rawUrl = (args?.url || "").trim();
      if (!rawUrl) return { error: "آدرس صفحه برای اسکرین‌شات مشخص نشده است." };
      if (!/^https?:\/\//i.test(rawUrl)) {
        rawUrl = `https://${rawUrl}`;
      }

      if (!ctx || !ctx.replyWithPhoto) {
        return { error: "کانتکست چت تلگرام برای ارسال مستقیم عکس در دسترس نیست." };
      }

      const targetUrl = encodeURIComponent(rawUrl);
      // ۱. پارامترهای ضروری برای رندر کامل جاوااسکریپت، سایت‌های SPA و ممانعت از صفحه سفید
      const primaryUrl = `https://api.microlink.io/?url=${targetUrl}&screenshot=true&embed=screenshot.url&waitForTimeout=2500&waitUntil=networkidle2&viewport.width=1280&viewport.height=800`;
      const fallbackUrl = `https://image.thum.io/get/width/1280/crop/800/wait/3/noanimate/${rawUrl}`;

      const replyOpts = {
        caption: `📸 اسکرین‌شات از:\n<code>${rawUrl}</code>`,
        parse_mode: "HTML" as const,
        reply_parameters: ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined,
        reply_to_message_id: ctx.message?.message_id,
      };

      try {
        await ctx.replyWithPhoto(primaryUrl, replyOpts);
      } catch (primaryErr: any) {
        console.warn("[SCREENSHOT] Primary Microlink failed, trying fallback thum.io:", primaryErr?.message || primaryErr);
        await ctx.replyWithPhoto(fallbackUrl, replyOpts);
      }

      return { success: true, message: "اسکرینشات با رندر کامل جاوااسکریپت و بدون صفحه سفید ارسال شد." };
    } catch (err: any) {
      console.error("[SCREENSHOT ERROR]:", err?.message || err);
      return { error: `خطا در دریافت اسکرین‌شات: ${err?.message || String(err)}` };
    }
  }

  return { error: "ابزار یافت نشد" };
}
