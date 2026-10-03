import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";
import { CONFIG } from "./config";

fs.mkdirSync(path.dirname(CONFIG.DB_PATH), { recursive: true });
fs.mkdirSync(CONFIG.DOWNLOADS_DIR, { recursive: true });

export const db = new Database(CONFIG.DB_PATH);

// Enable WAL mode for high concurrency
db.run("PRAGMA journal_mode = WAL;");

// Initialize tables
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    is_approved INTEGER DEFAULT 0,
    daily_quota INTEGER DEFAULT 24,
    used_today INTEGER DEFAULT 0,
    last_reset_date TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    can_use_commands INTEGER DEFAULT 0
  );
`);

try {
  db.run("ALTER TABLE users ADD COLUMN can_use_commands INTEGER DEFAULT 0;");
} catch {
  // Column already exists
}

db.run(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT NOT NULL,
    is_done INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS stats (
    key TEXT PRIMARY KEY,
    value INTEGER DEFAULT 0
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
  );
`);

db.run(`
  CREATE INDEX IF NOT EXISTS idx_chat_history_user ON chat_history(user_id, id DESC);
`);


export function registerOrUpdateUser(
  userId: number,
  username: string,
  firstName: string,
  lastName = ""
) {
  const todayStr = new Date().toISOString().split("T")[0];
  const isAdmin = CONFIG.ADMIN_IDS.includes(userId);

  const user = db
    .query("SELECT * FROM users WHERE user_id = ?")
    .get(userId) as any;

  if (!user) {
    const approved = isAdmin ? 1 : 0;
    db.run(
      `INSERT INTO users (user_id, username, first_name, last_name, is_approved, daily_quota, used_today, last_reset_date)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        userId,
        username || "",
        firstName || "",
        lastName || "",
        approved,
        isAdmin ? 999999 : CONFIG.DEFAULT_DAILY_QUOTA,
        todayStr,
      ]
    );
    return {
      isApproved: approved === 1,
      isAdmin,
      usedToday: 0,
      dailyQuota: CONFIG.DEFAULT_DAILY_QUOTA,
      remaining: CONFIG.DEFAULT_DAILY_QUOTA,
      isNew: true,
    };
  } else {
    let usedToday = user.used_today || 0;
    const lastDate = user.last_reset_date;
    const dailyQuota = user.daily_quota || CONFIG.DEFAULT_DAILY_QUOTA;
    const approved = user.is_approved === 1 || isAdmin;

    if (lastDate !== todayStr) {
      usedToday = 0;
      db.run(
        `UPDATE users SET used_today = 0, last_reset_date = ?, last_active = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [todayStr, userId]
      );
    } else {
      db.run(
        `UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE user_id = ?`,
        [userId]
      );
    }

    const remaining = Math.max(0, dailyQuota - usedToday);
    return {
      isApproved: approved,
      isAdmin,
      usedToday,
      dailyQuota,
      remaining,
      isNew: false,
    };
  }
}

export function checkAndConsumeQuota(userId: number, isGroup = false): {
  allowed: boolean;
  reason: string;
  remaining: number;
} {
  if (CONFIG.ADMIN_IDS.includes(userId)) {
    return { allowed: true, reason: "admin", remaining: 999999 };
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const user = db
    .query("SELECT * FROM users WHERE user_id = ?")
    .get(userId) as any;

  if (!user) return { allowed: false, reason: "not_registered", remaining: 0 };
  if (!isGroup && !user.is_approved) return { allowed: false, reason: "not_approved", remaining: 0 };

  let usedToday = user.used_today || 0;
  const dailyQuota = user.daily_quota || CONFIG.DEFAULT_DAILY_QUOTA;

  if (user.last_reset_date !== todayStr) {
    usedToday = 0;
    db.run(
      `UPDATE users SET used_today = 0, last_reset_date = ? WHERE user_id = ?`,
      [todayStr, userId]
    );
  }

  if (usedToday >= dailyQuota) {
    return { allowed: false, reason: "quota_exceeded", remaining: 0 };
  }

  const newUsed = usedToday + 1;
  db.run(`UPDATE users SET used_today = ? WHERE user_id = ?`, [newUsed, userId]);
  return { allowed: true, reason: "ok", remaining: dailyQuota - newUsed };
}

export function getUserQuotaInfo(userId: number): { remaining: number; dailyQuota: number; isAdmin: boolean } {
  if (CONFIG.ADMIN_IDS.includes(userId)) {
    return { remaining: 999999, dailyQuota: 999999, isAdmin: true };
  }
  const todayStr = new Date().toISOString().split("T")[0];
  const user = db.query("SELECT * FROM users WHERE user_id = ?").get(userId) as any;
  if (!user) return { remaining: CONFIG.DEFAULT_DAILY_QUOTA, dailyQuota: CONFIG.DEFAULT_DAILY_QUOTA, isAdmin: false };
  let usedToday = user.used_today || 0;
  if (user.last_reset_date !== todayStr) usedToday = 0;
  const dailyQuota = user.daily_quota || CONFIG.DEFAULT_DAILY_QUOTA;
  return { remaining: Math.max(0, dailyQuota - usedToday), dailyQuota, isAdmin: false };
}

export function formatQuotaFooter(userId: number): string {
  const info = getUserQuotaInfo(userId);
  if (info.isAdmin) {
    return "\n\n──────────────\n👑 <b>دسترسی ادمین:</b> <code>نامحدود ⚡</code>";
  }
  return `\n\n──────────────\n📊 <b>سهمیه باقی‌مانده امروز:</b> <code>${info.remaining}/${info.dailyQuota}</code>`;
}

export function approveUser(userId: number, quota = CONFIG.DEFAULT_DAILY_QUOTA) {
  db.run(`UPDATE users SET is_approved = 1, daily_quota = ? WHERE user_id = ?`, [
    quota,
    userId,
  ]);
}

export function rejectUser(userId: number) {
  db.run(`UPDATE users SET is_approved = 0 WHERE user_id = ?`, [userId]);
}

export function getUserById(userId: number) {
  return db.query("SELECT * FROM users WHERE user_id = ?").get(userId) as any;
}

export function getAllUsers() {
  return db.query("SELECT * FROM users ORDER BY created_at DESC").all() as any[];
}

export function getUserCount(): number {
  const row = db.query("SELECT COUNT(*) as count FROM users").get() as any;
  return row?.count || 0;
}

export function getAllUserIds(): number[] {
  const rows = db.query("SELECT user_id FROM users").all() as any[];
  return rows.map((r) => r.user_id);
}

export function addTask(userId: number, title: string) {
  return db.run("INSERT INTO tasks (user_id, title) VALUES (?, ?)", [
    userId,
    title,
  ]);
}

export function getTasks(userId: number) {
  return db
    .query("SELECT * FROM tasks WHERE user_id = ? ORDER BY is_done ASC, id DESC")
    .all(userId) as any[];
}

export function toggleTask(taskId: number, userId: number) {
  db.run(
    "UPDATE tasks SET is_done = NOT is_done WHERE id = ? AND user_id = ?",
    [taskId, userId]
  );
}

export function deleteTask(taskId: number, userId: number) {
  db.run("DELETE FROM tasks WHERE id = ? AND user_id = ?", [taskId, userId]);
}

export function incrementStat(key: string) {
  db.run(
    `INSERT INTO stats (key, value) VALUES (?, 1)
     ON CONFLICT(key) DO UPDATE SET value = value + 1`,
    [key]
  );
}

export function getStats(): Record<string, number> {
  const rows = db.query("SELECT key, value FROM stats").all() as any[];
  const res: Record<string, number> = {};
  for (const r of rows) res[r.key] = r.value;
  return res;
}

export function saveChatMessage(userId: number, role: "user" | "model" | "tool", content: string) {
  db.run("INSERT INTO chat_history (user_id, role, content) VALUES (?, ?, ?)", [
    userId,
    role,
    content.slice(0, 8000), // Cap single message size to prevent bloat
  ]);
  // Prune to maintain sliding window of max 16 messages per user
  pruneOldChatHistory(userId, 16);
}

export function getChatHistory(userId: number, limit = 12): Array<{ role: "user" | "model"; content: string; text: string }> {
  const rows = db
    .query("SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, limit) as any[];

  // Reverse so they are in chronological order
  return rows.reverse().map((r) => ({
    role: r.role === "model" ? "model" : "user",
    content: r.content,
    text: r.content,
  }));
}


export function clearChatHistory(userId: number) {
  db.run("DELETE FROM chat_history WHERE user_id = ?", [userId]);
}

export function pruneOldChatHistory(userId: number, keepLatest = 16) {
  db.run(
    `DELETE FROM chat_history WHERE user_id = ? AND id NOT IN (
      SELECT id FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT ?
    )`,
    [userId, userId, keepLatest]
  );
}

export function canUserUseCommands(userId: number): boolean {
  if (CONFIG.ADMIN_IDS.includes(userId)) return true;
  const user = db.query("SELECT can_use_commands FROM users WHERE user_id = ?").get(userId) as any;
  return user?.can_use_commands === 1;
}

export function setCommandAccess(userId: number, allowed: boolean): boolean {
  db.run("UPDATE users SET can_use_commands = ? WHERE user_id = ?", [allowed ? 1 : 0, userId]);
  return true;
}


