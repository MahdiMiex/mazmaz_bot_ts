import fs from "fs";
import path from "path";

function getDatabasePath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "bot.sqlite");
  }
  if (fs.existsSync("/data")) {
    return "/data/bot.sqlite";
  }
  return path.resolve(import.meta.dir, "../data/bot.sqlite");
}

export const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  ADMIN_IDS: (process.env.ADMIN_IDS || "8062873417")
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id)),
  CREATOR_NAME: "مهدی",
  CREATOR_USERNAME: "mmahdiz44",
  CREATOR_ID: 8062873417,
  PROXY_URL: process.env.PROXY_URL || "http://127.0.0.1:10808",
  USE_PROXY: process.env.USE_PROXY !== "false",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  GEMINI_API_KEYS: (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean),
  AI_MODEL: process.env.AI_MODEL || "gemini-3.5-flash-lite",
  GEMINI_MODELS: (process.env.GEMINI_MODELS || "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash,gemini-3.6-flash,gemini-3.7-flash,gemini-3.8-flash")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  ALLOWED_MODELS: (process.env.ALLOWED_MODELS || "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash,gemini-3.6-flash,gemini-3.7-flash,gemini-3.8-flash,gemini-3.1-flash-lite")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  TAVILY_API_KEY: process.env.TAVILY_API_KEY || "",
  BRAVE_API_KEY: process.env.BRAVE_API_KEY || "",
  SEARXNG_URL: process.env.SEARXNG_URL || "",
  DEFAULT_DAILY_QUOTA: parseInt(process.env.DEFAULT_DAILY_QUOTA || "24", 10),
  DB_PATH: getDatabasePath(),
  DOWNLOADS_DIR: path.resolve(import.meta.dir, "../downloads"),
};

export function validateStartupConfig(): void {
  if (CONFIG.ADMIN_IDS.length === 0 || CONFIG.ADMIN_IDS.some((id) => !Number.isFinite(id) || id <= 0)) {
    console.error("❌ Fatal Configuration Error: ADMIN_IDS must contain at least one valid numeric Telegram ID!");
    process.exit(1);
  }
  if (CONFIG.ALLOWED_MODELS.length === 0) {
    console.error("❌ Fatal Configuration Error: ALLOWED_MODELS must be a non-empty list of model names!");
    process.exit(1);
  }
}

export function updateGeminiApiKey(newKey: string): boolean {
  const clean = newKey.trim();
  CONFIG.GEMINI_API_KEY = clean;
  if (!CONFIG.GEMINI_API_KEYS.includes(clean)) {
    CONFIG.GEMINI_API_KEYS.push(clean);
  }

  try {
    const envPath = path.resolve(import.meta.dir, "../.env");
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
    if (content.includes("GEMINI_API_KEY=")) {
      content = content.replace(/GEMINI_API_KEY=.*$/m, `GEMINI_API_KEY=${newKey.trim()}`);
    } else {
      content += `\nGEMINI_API_KEY=${newKey.trim()}\n`;
    }
    fs.writeFileSync(envPath, content, "utf-8");
    return true;
  } catch (e) {
    console.error("Failed to persist GEMINI_API_KEY to .env:", e);
    return false;
  }
}
