import { getWeather } from "../services/weather";
import { getCryptoPrices } from "../services/crypto";
import { queryBenchmark, LMSYS_ARENA_SUMMARY, TOP_HARDWARE_BENCHMARKS } from "../services/benchmarks";
import { fetchAndAnalyzeLink, scrapeWebPageContent, executeFetchPage } from "../services/linkReader";
import { searchWeb, executeWebSearch } from "../services/webSearch";
import { addTask, getTasks, boostUserQuota } from "../db";
import { runToolWithLogger } from "../utils/toolLogger";
import { CONFIG } from "../config";
import { adminToolsSchema, executeAdminTool, setupTrackingMiddleware } from "./adminTools";
import { webToolsDeclaration, executeWebTool } from "./webTools";
import { executeTool as executeCustomTool } from "../tools";

export { adminToolsSchema, executeAdminTool, setupTrackingMiddleware, webToolsDeclaration, executeWebTool };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "OBJECT";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export const TOOLS_SCHEMA: ToolDefinition[] = [
  ...(webToolsDeclaration as ToolDefinition[]),
  {
    name: "eval_math",
    description: "محاسبه عبارات ریاضی و مهندسی",
    parameters: {
      type: "OBJECT",
      properties: {
        expression: { type: "STRING", description: "عبارت ریاضی مثل 2^8 یا sin(45)" },
      },
      required: ["expression"],
    },
  },
  {
    name: "fetch_page",
    description: "باز کردن لینک‌های وب و استخراج متن اصلی صفحه بدون بارگذاری تبلیغات و استایل‌ها",
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING", description: "آدرس کامل صفحه وب (شامل http:// یا https://)" },
      },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    description: "جستجوی زنده در اینترنت برای اخبار، مستندات و اطلاعات جدید بدون کلید API",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "متن یا کلمه کلیدی جستجو" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_weather",
    description: "Get real-time weather forecasts and temperature for any city (e.g. Tehran, Tabriz, Mashhad, etc.)",
    parameters: {
      type: "OBJECT",
      properties: {
        city: { type: "STRING", description: "City name in Persian or English" },
      },
      required: ["city"],
    },
  },
  {
    name: "get_crypto_prices",
    description: "Get real-time prices for USD Dollar, Tether, Bitcoin, Ethereum and major cryptocurrencies in Tomans/USD",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Optional specific coin symbol, e.g. btc, eth, usdt" },
      },
    },
  },
  {
    name: "query_benchmark",
    description: "Get official hardware benchmark rankings (CPUs, GPUs, Mobile chipsets like Apple M4, Snapdragon 8 Elite) and LMSYS AI Arena leaderboards",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Device or processor name or 'arena'" },
      },
    },
  },
  {
    name: "read_web_link",
    description: "Scrape, extract and analyze the content of any web article, Reddit post, Twitter/X tweet, or news link",
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING", description: "The full URL to scrape and analyze" },
      },
      required: ["url"],
    },
  },
  {
    name: "manage_tasks",
    description: "Add or list user daily to-do tasks and reminders",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "'add' or 'list'" },
        title: { type: "STRING", description: "Task title when action is 'add'" },
      },
      required: ["action"],
    },
  },
  {
    name: "boost_quota",
    description: "افزایش سهمیه روزانه کاربر توسط ادمین",
    parameters: {
      type: "OBJECT",
      properties: {
        targetUserId: { type: "INTEGER", description: "شناسه عددی کاربر تلگرام" },
        amount: { type: "INTEGER", description: "تعداد پیام اضافه (پیشفرض ۱۰)" },
      },
      required: ["targetUserId"],
    },
  },
];

export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  userId: number,
  ctx?: any
): Promise<string> {
  try {
    switch (toolName) {
      case "boost_quota": {
        return await runToolWithLogger("BOOST_QUOTA", String(args.targetUserId), async () => {
          const isAdmin = CONFIG.ADMIN_IDS.includes(userId);
          if (!isAdmin) {
            return "خطا: شما دسترسی لازم برای افزایش یا تغییر سهمیه کاربران را ندارید. این عملیات فقط مختص رئیس مهدی است.";
          }
          const targetUserId = Number(args.targetUserId);
          const amount = Number(args.amount) || 10;
          if (!targetUserId || isNaN(targetUserId)) {
            return "خطا: شناسه عددی کاربر نامعتبر است.";
          }
          const res = boostUserQuota(targetUserId, amount);
          return JSON.stringify({
            ok: res.ok,
            targetUserId,
            amountAdded: amount,
            newQuota: res.newQuota,
            message: `سهمیه کاربر ${targetUserId} به میزان ${amount} افزایش یافت. سهمیه جدید: ${res.newQuota}`,
          });
        });
      }
      case "eval_math": {
        return await runToolWithLogger("EVAL_MATH", JSON.stringify(args), async () => {
          const res = await executeCustomTool("eval_math", args);
          return typeof res === "string" ? res : JSON.stringify(res);
        });
      }
      case "fetch_web_page":
      case "take_web_screenshot": {
        return await runToolWithLogger(`WEB_${toolName.toUpperCase()}`, JSON.stringify(args), async () => {
          const res = await executeWebTool(ctx, toolName, args);
          return typeof res === "string" ? res : JSON.stringify(res);
        });
      }
      case "fetch_page": {
        if (!args.url) return JSON.stringify({ ok: false, error: "آدرس وب‌سایت مشخص نشده است." });
        return await runToolWithLogger("FETCH_PAGE", args.url, async () => {
          const res = await executeFetchPage(args.url);
          return JSON.stringify(res);
        });
      }
      case "web_search": {
        const query = args.query || args.q || "";
        return await runToolWithLogger("SEARCH", query, async () => {
          const res = await executeWebSearch(query);
          return JSON.stringify(res);
        });
      }
      case "get_weather": {
        const city = args.city || "تهران";
        return await runToolWithLogger("WEATHER", city, () => getWeather(city));
      }
      case "get_crypto_prices": {
        return await runToolWithLogger("CRYPTO", args.query || "all", () => getCryptoPrices());
      }
      case "query_benchmark": {
        const query = args.query || "all";
        return await runToolWithLogger("BENCHMARK", query, () => queryBenchmark(userId, query));
      }
      case "read_web_link": {
        if (!args.url) return "خطا: آدرس لینک مشخص نشده است.";
        return await runToolWithLogger("LINK_READER", args.url, () => scrapeWebPageContent(args.url));
      }
      case "manage_tasks": {
        return await runToolWithLogger("TASKS", args.action || "list", async () => {
          if (args.action === "add" && args.title) {
            addTask(userId, args.title);
            return `✅ تسک «${args.title}» با موفقیت اضافه شد.`;
          }
          const tasks = getTasks(userId);
          if (tasks.length === 0) return "لیست کارهای روزمره شما خالی است.";
          return tasks.map((t) => `${t.is_done ? "✅" : "⬜"} ${t.title}`).join("\n");
        });
      }
      case "ban_chat_member":
      case "mute_chat_member":
      case "unmute_chat_member":
      case "summarize_chat":
      case "delete_recent_messages":
      case "moderate_user":
      case "manage_bot_chats": {
        return await runToolWithLogger(`ADMIN_${toolName.toUpperCase()}`, JSON.stringify(args), async () => {
          const res = await executeAdminTool(ctx?.api, ctx, toolName, args, userId);
          return JSON.stringify(res);
        });
      }
      default:
        return `ابزار ناشناخته: ${toolName}`;
    }
  } catch (err: any) {
    console.error(`Error executing tool ${toolName}:`, err?.message || err);
    return `امکان اجرای ابزار ${toolName} در این لحظه وجود ندارد. لطفاً بر اساس اطلاعات موجود و دانش خودت پاسخ کامل بده.`;
  }
}

