import { getWeather } from "../services/weather";
import { getCryptoPrices } from "../services/crypto";
import { queryBenchmark, LMSYS_ARENA_SUMMARY, TOP_HARDWARE_BENCHMARKS } from "../services/benchmarks";
import { fetchAndAnalyzeLink } from "../services/linkReader";
import { searchWeb } from "../services/webSearch";
import { addTask, getTasks } from "../db";
import { runToolWithLogger } from "../utils/toolLogger";

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
  {
    name: "web_search",
    description: "Search Google and the live web for up-to-date real-time news, current events, recent tech facts, documentation, or answers you don't know from memory. Use short, focused keyword queries.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Short keyword-focused search query (3-5 words max, in English or Persian)" },
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
];

export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  userId: number
): Promise<string> {
  try {
    switch (toolName) {
      case "web_search": {
        const query = args.query || args.q || "";
        return await searchWeb(query);
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
        return await runToolWithLogger("LINK_READER", args.url, () => fetchAndAnalyzeLink(userId, args.url));
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
      default:
        return `ابزار ناشناخته: ${toolName}`;
    }
  } catch (err: any) {
    console.error(`Error executing tool ${toolName}:`, err);
    return `خطا در اجرای ابزار ${toolName}: ${err.message || err}`;
  }
}

