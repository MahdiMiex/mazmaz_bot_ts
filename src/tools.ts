import { HttpsProxyAgent } from "https-proxy-agent";
import { CONFIG } from "./config";
import { runToolWithLogger } from "./utils/toolLogger";
import { searchWeb } from "./services/webSearch";

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

// تعریف اسکیمای ابزارها برای مدل
export const toolDeclarations = [
  {
    name: "web_search",
    description: "جستجو در وب برای اخبار، مشخصات و اطلاعات به‌روز",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "عبارت جستجو" } },
      required: ["query"]
    }
  },
  {
    name: "fetch_url",
    description: "استخراج متن و محتوای یک لینک اینترنتی",
    parameters: {
      type: "OBJECT",
      properties: { url: { type: "STRING", description: "آدرس کامل صفحه وب" } },
      required: ["url"]
    }
  },
  {
    name: "get_weather",
    description: "دریافت وضعیت زنده آب‌وهوا و دمای شهرها",
    parameters: {
      type: "OBJECT",
      properties: { city: { type: "STRING", description: "نام شهر به انگلیسی یا فارسی" } },
      required: ["city"]
    }
  },
  {
    name: "eval_math",
    description: "محاسبه عبارات ریاضی و مهندسی",
    parameters: {
      type: "OBJECT",
      properties: { expression: { type: "STRING", description: "عبارت ریاضی مثل 2^8 یا sin(45)" } },
      required: ["expression"]
    }
  }
];

/**
 * ارزیابی امن و بهینه‌سازی شده عبارات ریاضی با بررسی دقیق ورودی و مدیریت خطای تقسیم بر صفر
 */
export function evaluateMathExpression(rawExpr: string): { expression: string; result?: number; error?: string } {
  const expr = String(rawExpr || "").trim();
  if (!expr) {
    return { expression: expr, error: "عبارت ریاضی وارد نشده است." };
  }

  if (expr.length > 500) {
    return { expression: expr, error: "طول عبارت ریاضی بیش از حد مجاز است." };
  }

  // ۱. نرمال‌سازی ارقام فارسی/عربی و نمادهای متداول ریاضی
  const normalized = expr
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/\^/g, "**")
    .replace(/٫/g, ".");

  // ۲. اعتبارسنجی کاراکترها: فقط ارقام، عملگرها، پرانتز و حروف مجاز
  if (!/^[0-9a-zA-Z\s.+\-*/%(),]+$/.test(normalized)) {
    return { expression: expr, error: "عبارت ریاضی شامل کاراکترهای غیرمجاز است." };
  }

  // ۳. بررسی شناسه‌ها و توابع مجاز جهت جلوگیری از اجرای کدهای دلخواه
  const identifiers = expr.match(/[a-zA-Z_]+/g) || [];
  const allowed = new Set([
    "sin", "cos", "tan", "asin", "acos", "atan",
    "sqrt", "cbrt", "abs", "log", "log10", "log2", "exp",
    "round", "ceil", "floor",
    "pi", "PI", "e", "E"
  ]);

  for (const id of identifiers) {
    if (!allowed.has(id)) {
      return { expression: expr, error: `عملگر یا تابع نامعتبر در عبارت ریاضی: ${id}` };
    }
  }

  const scope: Record<string, any> = {
    sin: (x: number) => Math.sin((x * Math.PI) / 180),
    cos: (x: number) => Math.cos((x * Math.PI) / 180),
    tan: (x: number) => Math.tan((x * Math.PI) / 180),
    asin: (x: number) => (Math.asin(x) * 180) / Math.PI,
    acos: (x: number) => (Math.acos(x) * 180) / Math.PI,
    atan: (x: number) => (Math.atan(x) * 180) / Math.PI,
    sqrt: (x: number) => {
      if (x < 0) throw new Error("جذر اعداد منفی در اعداد حقیقی تعریف نشده است");
      return Math.sqrt(x);
    },
    cbrt: Math.cbrt,
    abs: Math.abs,
    log: (x: number) => {
      if (x <= 0) throw new Error("لگاریتم برای مقادیر صفر یا منفی تعریف نشده است");
      return Math.log(x);
    },
    log10: (x: number) => {
      if (x <= 0) throw new Error("لگاریتم برای مقادیر صفر یا منفی تعریف نشده است");
      return Math.log10(x);
    },
    log2: (x: number) => {
      if (x <= 0) throw new Error("لگاریتم برای مقادیر صفر یا منفی تعریف نشده است");
      return Math.log2(x);
    },
    exp: Math.exp,
    round: Math.round,
    ceil: Math.ceil,
    floor: Math.floor,
    pi: Math.PI,
    PI: Math.PI,
    e: Math.E,
    E: Math.E,
  };

  try {
    const fn = new Function(...Object.keys(scope), `"use strict"; return (${normalized});`);
    const res = fn(...Object.values(scope));

    // بررسی خطای تقسیم بر صفر و مقادیر غیرعددی
    if (typeof res !== "number" || !Number.isFinite(res)) {
      if (res === Infinity || res === -Infinity) {
        return { expression: expr, error: "خطای تقسیم بر صفر: نتیجه محاسبه بی‌نهایت (Infinity) است." };
      }
      return { expression: expr, error: "نتیجه محاسبه یک عدد معتبر نیست (NaN)." };
    }

    // تصحیح خطای ممیز شناور (floating-point precision)
    const rounded = Number(Math.round(Number(`${res}e12`)) + "e-12");
    return { expression: expr, result: rounded };
  } catch (err: any) {
    return { expression: expr, error: `خطا در نحو یا محاسبه عبارت ریاضی: ${err?.message || "عبارت نامعتبر است"}` };
  }
}

/**
 * پیاده‌سازی متمرکز و ایمن ابزارهای عمومی بات با ثبت لاگ و مدیریت خطای لایه مرزی
 */
export async function executeTool(name: string, args: any): Promise<any> {
  try {
    if (name === "web_search") {
      const query = String(args?.query || args?.q || "").trim();
      return await runToolWithLogger("WEB_SEARCH", query, async () => {
        if (!query) return { error: "عبارت جستجو وارد نشده است." };
        const results = await searchWeb(query, 4);
        return { query, results };
      });
    }

    if (name === "fetch_url") {
      const url = String(args?.url || "").trim();
      return await runToolWithLogger("FETCH_URL", url, async () => {
        if (!url) return { error: "آدرس لینک مشخص نشده است." };
        const targetUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

        const fetchOpts: any = {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
          signal: AbortSignal.timeout(15000),
        };
        if (agent) {
          fetchOpts.agent = agent;
        }

        const res = await fetch(`https://r.jina.ai/${targetUrl}`, fetchOpts);
        if (!res.ok) {
          return { error: `خطا در دریافت صفحه (کد وضعیت: ${res.status})` };
        }
        const text = await res.text();
        return { content: text.slice(0, 3000) };
      });
    }

    if (name === "get_weather") {
      const city = String(args?.city || "").trim();
      return await runToolWithLogger("GET_WEATHER", city, async () => {
        if (!city) return { error: "نام شهر وارد نشده است." };

        const fetchOpts: any = {
          headers: { "User-Agent": "curl/7.68.0" },
          signal: AbortSignal.timeout(10000),
        };
        if (agent) {
          fetchOpts.agent = agent;
        }

        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, fetchOpts);
        if (!res.ok) {
          return { error: `سرویس آب‌وهوا در دسترس نیست (کد وضعیت: ${res.status})` };
        }

        const text = await res.text();
        if (!text || !text.trim().startsWith("{")) {
          return { error: "پاسخ دریافتی از سرویس آب‌وهوا نامعتبر یا غیرمنتظره است." };
        }

        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          return { error: "خطا در پردازش اطلاعات ارسالی از سرویس آب‌وهوا." };
        }

        const current = data?.current_condition?.[0];
        if (!current) {
          return { error: `اطلاعات آب‌وهوا برای شهر «${city}» یافت نشد.` };
        }

        return {
          city,
          temp_C: current.temp_C,
          weather: current.weatherDesc?.[0]?.value || "نامشخص",
          humidity: current.humidity,
          feelsLike_C: current.FeelsLikeC,
          windspeedKmph: current.windspeedKmph,
        };
      });
    }

    if (name === "eval_math") {
      const expr = String(args?.expression || "").trim();
      return await runToolWithLogger("EVAL_MATH", expr, async () => {
        return evaluateMathExpression(expr);
      });
    }

    return { error: `ابزار ناشناخته است: ${name}` };
  } catch (err: any) {
    console.error(`[TOOL_ERROR] Error executing tool ${name}:`, err?.message || err);
    return { error: `خطا در اجرای ابزار ${name}: ${err?.message || "خطای ناشناخته"}` };
  }
}
