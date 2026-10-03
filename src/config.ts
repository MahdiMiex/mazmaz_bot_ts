import fs from "fs";
import path from "path";

export const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN || "8715729332:AAG3BuKTC8irEHMHpzG37kpSh1_erB43ivA",
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
  AI_MODEL: process.env.AI_MODEL || "gemini-flash-latest",
  DEFAULT_DAILY_QUOTA: parseInt(process.env.DEFAULT_DAILY_QUOTA || "24", 10),
  DB_PATH: path.resolve(import.meta.dir, "../data/bot.sqlite"),
  DOWNLOADS_DIR: path.resolve(import.meta.dir, "../downloads"),
};

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
