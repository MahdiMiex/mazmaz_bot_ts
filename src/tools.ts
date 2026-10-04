// تعریف اسکیمای ابزارها برای مدل
export const toolDeclarations = [
  {
    name: "web_search",
    description: "جستجو در وب برای اخبار، مشخصات و اطلاعات بهروز",
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
    description: "دریافت وضعیت زنده آبوهوا و دمای شهرها",
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

// پیادهسازی سریع و بدون وابستگی سنگین
export async function executeTool(name: string, args: any): Promise<any> {
  try {
    if (name === "web_search") {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`, {
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      const html = await res.text();
      // استخراج تیتر و لینکها به صورت سبک
      const matches = [...html.matchAll(/<a class="result__url" href="([^"]+)">/g)].slice(0, 4);
      return { results: matches.map(m => m[1]) };
    }

    if (name === "fetch_url") {
      const res = await fetch(`https://r.jina.ai/${args.url}`);
      const text = await res.text();
      return { content: text.slice(0, 3000) }; // برش متن برای مصرف بهینه توکن
    }

    if (name === "get_weather") {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(args.city)}?format=j1`);
      const data = await res.json();
      const current = data.current_condition[0];
      return {
        temp_C: current.temp_C,
        weather: current.weatherDesc[0].value,
        humidity: current.humidity
      };
    }

    if (name === "eval_math") {
      const sanitized = args.expression.replace(/[^0-9+\-*/().^ ]/g, "");
      return { result: Function(`'use strict'; return (${sanitized})`)() };
    }
  } catch (err: any) {
    return { error: `خطا در اجرای ابزار: ${err.message}` };
  }

  return { error: "ابزار ناشناخته است." };
}
