import { GoogleGenAI } from "@google/genai";
import { HttpsProxyAgent } from "https-proxy-agent";
import { CONFIG } from "../config";
import { db } from "../db";

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

export interface RawMessageRow {
  text?: string;
  user_id?: number;
  first_name?: string;
  role?: string;
}

/**
 * فیلتر کردن نویز پیام‌ها:
 * - طول کمتر از ۳ کاراکتر
 * - ایموجی‌های خالص
 * - دستورات ربات (شروع با /)
 * - پیام‌های خالی
 */
export function filterMessageNoise(text: string | null | undefined): boolean {
  if (!text) return false;
  const clean = text.trim();
  if (clean.length < 3) return false;
  if (clean.startsWith("/")) return false;
  // بررسی ایموجی خالص با رجکس یونیکد
  if (/^[\p{Extended_Pictographic}\s]+$/u.test(clean)) return false;
  return true;
}

/**
 * استخراج و خلاصه‌سازی هوشمند تاریخچه چت (دایجست گفتگو)
 */
export async function generateChatDigest(
  chatId: number,
  limit = 100,
  focus?: string
): Promise<string> {
  const safeLimit = Math.min(Math.max(limit, 10), 300);
  let rows: RawMessageRow[] = [];

  try {
    if (chatId < 0) {
      // چت گروهی: دریافت از جدول messages
      rows = db
        .query(
          `SELECT m.text, m.user_id, u.first_name 
           FROM messages m 
           LEFT JOIN users u ON m.user_id = u.user_id 
           WHERE m.chat_id = ? 
           ORDER BY m.id DESC 
           LIMIT ?`
        )
        .all(chatId, safeLimit) as RawMessageRow[];
    } else {
      // چت خصوصی: دریافت از جدول chat_history
      rows = db
        .query(
          `SELECT role, content as text, user_id 
           FROM chat_history 
           WHERE user_id = ? 
           ORDER BY id DESC 
           LIMIT ?`
        )
        .all(chatId, safeLimit) as RawMessageRow[];
    }
  } catch (err) {
    console.error("Error querying messages for digest:", err);
  }

  // فیلتر نویز و حذف موارد نامعتبر
  const validMessages = rows
    .filter((r) => filterMessageNoise(r.text))
    .reverse(); // چیدمان به ترتیب زمانی

  if (validMessages.length === 0) {
    return "در تاریخچه پیام‌های اخیر، پیام متنی معناداری برای خلاصه کردن یافت نشد.";
  }

  const transcript = validMessages
    .map((m) => {
      const sender = m.first_name || (m.role === "model" ? "مزمز" : m.role === "user" ? "کاربر" : `کاربر ${m.user_id}`);
      return `[${sender}]: ${m.text}`;
    })
    .join("\n");

  const apiKey = CONFIG.GEMINI_API_KEY || (CONFIG.GEMINI_API_KEYS && CONFIG.GEMINI_API_KEYS[0]);
  if (!apiKey) {
    return "خطا: کلید هوش مصنوعی برای تولید دایجست چت تنظیم نشده است.";
  }

  const ai = new GoogleGenAI({
    apiKey,
    // @ts-ignore
    httpOptions: agent ? { agent } : undefined,
  });

  const focusInstruction = focus ? `\n- تمرکز ویژه در خلاصه روی این موضوع یا شخص باشد: «${focus}»` : "";

  const prompt = `شما یک ابزار تخصصی خلاصه و تحلیل مکالمات تلگرام هستید.
پیام‌های اخیر این گفتگو را بررسی کن و یک دایجست (Digest) دقیق، تمیز، مفید و ساختاریافته به زبان فارسی ارائه بده.

قالب خروجی:
📌 **نکات کلیدی (Key Points):**
(مهم‌ترین موضوعات، گفتگوها و پرسش‌وپاسخ‌ها در قالب بولت‌پوینت)

🎯 **تصمیمات و نتایج (Decisions & Outcomes):**
(هرگونه نتیجه‌گیری، توافق، تسک یا تصمیم نهایی در چت)

👥 **مشارکت‌کنندگان فعال (Active Participants):**
(افرادی که بیشترین حضور یا اثرگذاری را داشتند)

قوانین مهم:
- کاملاً موجز، مستقیم و بدون حاشیه‌پردازی.
- متن‌های تکراری و تعارفات را حذف کن.${focusInstruction}

متن گفتگو:
${transcript}`;

  const fastModels = ["gemini-2.0-flash-lite", "gemini-2.0-flash"];

  for (const model of fastModels) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
      });

      if (res.text) {
        return res.text.trim();
      }
    } catch (err: any) {
      console.warn(`[DIGEST] Model ${model} failed, trying next fallback...`, err?.message || err);
    }
  }

  return "متأسفانه در حال حاضر امکان تحلیل و تولید دایجست تاریخچه پیام‌ها وجود ندارد.";
}
