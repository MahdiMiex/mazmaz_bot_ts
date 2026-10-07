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
try {
  db.run("ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0;");
} catch {}
try {
  db.run("ALTER TABLE users ADD COLUMN muted_until TEXT;");
} catch {}
try {
  db.run("ALTER TABLE users ADD COLUMN mute_reason TEXT;");
} catch {}

db.run(`
  CREATE TABLE IF NOT EXISTS feedback_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT,
    content TEXT,
    chat_title TEXT,
    chat_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending'
  );
`);

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

db.run(`
  CREATE TABLE IF NOT EXISTS groups (
    chat_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT DEFAULT 'group',
    added_by_id INTEGER,
    added_by_name TEXT,
    added_by_username TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    message_id INTEGER,
    user_id INTEGER,
    text TEXT,
    created_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages (chat_id, id DESC);

  CREATE TABLE IF NOT EXISTS chats (
    chat_id INTEGER PRIMARY KEY,
    title TEXT
  );

  CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    value TEXT,
    approved INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

try {
  db.run(`
    INSERT OR IGNORE INTO chats (chat_id, title)
    SELECT chat_id, title FROM groups WHERE status = 'approved';
  `);
} catch {}

export function getSetting(key: string, defaultValue = ""): string {
  try {
    const row = db.query("SELECT value FROM bot_settings WHERE key = ?").get(key) as any;
    return row?.value !== undefined && row?.value !== null ? row.value : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function setSetting(key: string, value: string): void {
  try {
    db.run("INSERT OR REPLACE INTO bot_settings (key, value) VALUES (?, ?)", [key, value]);
    saveStateSnapshot();
  } catch (e: any) {
    console.warn("Failed to set bot setting:", e?.message);
  }
}

const SNAPSHOT_PATH = path.resolve(import.meta.dir, "../data/persistent_state.json");

export function saveStateSnapshot() {
  try {
    const groups = db.query("SELECT * FROM groups WHERE status = 'approved'").all() as any[];
    const approvedUsers = db.query("SELECT user_id, username, first_name, last_name, is_approved, daily_quota, can_use_commands FROM users WHERE is_approved = 1").all() as any[];
    const settings = db.query("SELECT key, value FROM bot_settings").all() as any[];
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({ groups, users: approvedUsers, settings }, null, 2), "utf-8");
  } catch (e: any) {
    console.warn("Failed to write persistent_state.json:", e?.message);
  }
}

export function restoreStateSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return;
    const raw = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data.groups)) {
      for (const g of data.groups) {
        db.run(
          `INSERT OR IGNORE INTO groups (chat_id, title, type, added_by_id, added_by_name, added_by_username, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [g.chat_id, g.title, g.type, g.added_by_id, g.added_by_name, g.added_by_username, g.status]
        );
        db.run("INSERT OR REPLACE INTO chats (chat_id, title) VALUES (?, ?)", [g.chat_id, g.title]);
      }
    }
    if (Array.isArray(data.users)) {
      for (const u of data.users) {
        db.run(
          `INSERT OR IGNORE INTO users (user_id, username, first_name, last_name, is_approved, daily_quota, can_use_commands)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [u.user_id, u.username, u.first_name, u.last_name, u.is_approved, u.daily_quota, u.can_use_commands]
        );
      }
    }
    if (Array.isArray(data.settings)) {
      for (const s of data.settings) {
        db.run("INSERT OR REPLACE INTO bot_settings (key, value) VALUES (?, ?)", [s.key, s.value]);
      }
    }
    console.log("✅ Restored persistent state for groups and approved users!");
  } catch (e: any) {
    console.warn("Failed to restore state snapshot:", e?.message);
  }
}

// Restore state immediately upon startup if available
restoreStateSnapshot();



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
  if (CONFIG.ADMIN_IDS.includes(userId)) {
    return "";
  }
  const info = getUserQuotaInfo(userId);
  return `\n\n──────────────\n📊 <b>سهمیه باقی‌مانده امروز:</b> <code>${info.remaining}/${info.dailyQuota}</code>`;
}

export function approveUser(userId: number, quota = CONFIG.DEFAULT_DAILY_QUOTA) {
  db.run(`UPDATE users SET is_approved = 1, daily_quota = ? WHERE user_id = ?`, [
    quota,
    userId,
  ]);
  saveStateSnapshot();
}

export function rejectUser(userId: number) {
  db.run(`UPDATE users SET is_approved = 0 WHERE user_id = ?`, [userId]);
  saveStateSnapshot();
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
  // Prune to maintain sliding window of max 100 messages per user
  pruneOldChatHistory(userId, 100);
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

export function getUserDetailedLogs(
  userId: number,
  limit = 20
): Array<{ id: number; user_id: number; role: string; content: string; created_at: string }> {
  return db
    .query(
      `SELECT id, user_id, role, content, created_at 
       FROM chat_history 
       WHERE user_id = ? 
       ORDER BY id DESC 
       LIMIT ?`
    )
    .all(userId, limit) as any[];
}

export function getRecentGlobalLogs(
  limit = 15
): Array<{
  id: number;
  user_id: number;
  role: string;
  content: string;
  created_at: string;
  first_name?: string;
  username?: string;
}> {
  return db
    .query(
      `SELECT h.id, h.user_id, h.role, h.content, h.created_at, u.first_name, u.username
       FROM chat_history h
       LEFT JOIN users u ON h.user_id = u.user_id
       ORDER BY h.id DESC
       LIMIT ?`
    )
    .all(limit) as any[];
}

export function getUsersWithRecentChat(
  limit = 10
): Array<{
  user_id: number;
  first_name: string;
  username: string;
  msg_count: number;
  last_msg_at: string;
}> {
  return db
    .query(
      `SELECT u.user_id, u.first_name, u.username, COUNT(h.id) as msg_count, MAX(h.created_at) as last_msg_at
       FROM users u
       INNER JOIN chat_history h ON u.user_id = h.user_id
       GROUP BY u.user_id
       ORDER BY last_msg_at DESC
       LIMIT ?`
    )
    .all(limit) as any[];
}

export function getUserMessageCount(userId: number): number {
  const row = db
    .query("SELECT COUNT(*) as count FROM chat_history WHERE user_id = ?")
    .get(userId) as any;
  return row?.count || 0;
}

export function clearChatHistory(userId: number) {
  db.run("DELETE FROM chat_history WHERE user_id = ?", [userId]);
}

export function pruneOldChatHistory(userId: number, keepLatest = 100) {
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

export function muteUser(
  userId: number,
  durationHours: number,
  reason = "استفاده از کلمات نامناسب"
): { untilDate: Date; untilStr: string } {
  const until = new Date(Date.now() + durationHours * 3600 * 1000);
  const untilIso = until.toISOString();
  db.run(
    "UPDATE users SET muted_until = ?, mute_reason = ? WHERE user_id = ?",
    [untilIso, reason, userId]
  );
  const untilStr = new Intl.DateTimeFormat("fa-IR", {
    timeStyle: "medium",
    dateStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(until);
  return { untilDate: until, untilStr };
}

export function unmuteUser(userId: number): boolean {
  db.run("UPDATE users SET muted_until = NULL, mute_reason = NULL WHERE user_id = ?", [userId]);
  return true;
}

export function isUserMuted(userId: number): { isMuted: boolean; untilStr?: string; reason?: string } {
  if (CONFIG.ADMIN_IDS.includes(userId)) return { isMuted: false };
  const user = db.query("SELECT muted_until, mute_reason FROM users WHERE user_id = ?").get(userId) as any;
  if (!user || !user.muted_until) return { isMuted: false };

  const until = new Date(user.muted_until);
  if (until.getTime() > Date.now()) {
    const untilStr = new Intl.DateTimeFormat("fa-IR", {
      timeStyle: "medium",
      dateStyle: "short",
      timeZone: "Asia/Tehran",
    }).format(until);
    return { isMuted: true, untilStr, reason: user.mute_reason || "نقض قوانین ربات" };
  } else {
    unmuteUser(userId);
    return { isMuted: false };
  }
}

export function banUser(userId: number): boolean {
  db.run("UPDATE users SET is_banned = 1 WHERE user_id = ?", [userId]);
  return true;
}

export function unbanUser(userId: number): boolean {
  db.run("UPDATE users SET is_banned = 0 WHERE user_id = ?", [userId]);
  return true;
}

export function isUserBanned(userId: number): boolean {
  if (CONFIG.ADMIN_IDS.includes(userId)) return false;
  const user = db.query("SELECT is_banned FROM users WHERE user_id = ?").get(userId) as any;
  return user?.is_banned === 1;
}

export function setUserQuota(userId: number, newQuota: number): boolean {
  db.run("UPDATE users SET daily_quota = ? WHERE user_id = ?", [newQuota, userId]);
  return true;
}

export function addQuota(userId: number, amount: number): number {
  const user = db.query("SELECT daily_quota FROM users WHERE user_id = ?").get(userId) as any;
  const current = user?.daily_quota || CONFIG.DEFAULT_DAILY_QUOTA;
  const updated = Math.max(0, current + amount);
  db.run("UPDATE users SET daily_quota = ? WHERE user_id = ?", [updated, userId]);
  return updated;
}

export function boostUserQuota(targetUserId: number, amount = 10): { ok: boolean; newQuota?: number } {
  const user = db.query("SELECT daily_quota FROM users WHERE user_id = ?").get(targetUserId) as any;
  if (!user) {
    db.run(
      "INSERT INTO users (user_id, daily_quota, is_approved) VALUES (?, ?, 1)",
      [targetUserId, CONFIG.DEFAULT_DAILY_QUOTA + amount]
    );
    return { ok: true, newQuota: CONFIG.DEFAULT_DAILY_QUOTA + amount };
  }
  const newQuota = addQuota(targetUserId, amount);
  return { ok: true, newQuota };
}

export function saveFeedbackReport(
  userId: number,
  type: "bug" | "suggestion" | "criticism" | "profanity",
  content: string,
  chatTitle: string,
  chatId: number
): number {
  const result = db.run(
    "INSERT INTO feedback_reports (user_id, type, content, chat_title, chat_id) VALUES (?, ?, ?, ?, ?)",
    [userId, type, content, chatTitle, chatId]
  );
  return result.lastInsertRowid as number;
}

export interface GroupInfo {
  chat_id: number;
  title: string;
  type: string;
  added_by_id: number;
  added_by_name: string;
  added_by_username: string;
  status: "pending" | "approved" | "rejected" | "left";
  created_at: string;
  updated_at: string;
}

export function registerOrUpdateGroup(
  chatId: number,
  title: string,
  type = "group",
  addedById = 0,
  addedByName = "",
  addedByUsername = "",
  status?: "pending" | "approved" | "rejected" | "left"
) {
  const existing = db.query("SELECT * FROM groups WHERE chat_id = ?").get(chatId) as any;
  if (!existing) {
    const finalStatus = status || "pending";
    db.run(
      `INSERT INTO groups (chat_id, title, type, added_by_id, added_by_name, added_by_username, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [chatId, title, type, addedById, addedByName, addedByUsername, finalStatus]
    );
  } else {
    const finalStatus = status !== undefined ? status : existing.status;
    const finalAddedById = addedById !== 0 ? addedById : existing.added_by_id;
    const finalAddedByName = addedByName ? addedByName : existing.added_by_name;
    const finalAddedByUsername = addedByUsername ? addedByUsername : existing.added_by_username;
    db.run(
      `UPDATE groups 
       SET title = ?, type = ?, added_by_id = ?, added_by_name = ?, added_by_username = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE chat_id = ?`,
      [title || existing.title, type || existing.type, finalAddedById, finalAddedByName, finalAddedByUsername, finalStatus, chatId]
    );
  }

  // همگام‌سازی با جدول chats برای ابزار manage_bot_chats
  const effectiveStatus = status !== undefined ? status : (existing ? existing.status : "pending");
  if (effectiveStatus === "approved") {
    db.run("INSERT OR REPLACE INTO chats (chat_id, title) VALUES (?, ?)", [chatId, title || existing?.title || "گروه"]);
    saveStateSnapshot();
  } else if (effectiveStatus === "left" || effectiveStatus === "rejected") {
    db.run("DELETE FROM chats WHERE chat_id = ?", [chatId]);
    saveStateSnapshot();
  }
}

export function getGroupById(chatId: number): GroupInfo | null {
  return (db.query("SELECT * FROM groups WHERE chat_id = ?").get(chatId) as any) || null;
}

export function getAllGroups(): GroupInfo[] {
  return db.query("SELECT * FROM groups ORDER BY updated_at DESC, created_at DESC").all() as any[];
}

export function setGroupStatus(chatId: number, status: "pending" | "approved" | "rejected" | "left") {
  db.run("UPDATE groups SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?", [status, chatId]);
  if (status === "approved") {
    const grp = getGroupById(chatId);
    if (grp) {
      db.run("INSERT OR REPLACE INTO chats (chat_id, title) VALUES (?, ?)", [chatId, grp.title]);
    }
  } else if (status === "left" || status === "rejected") {
    db.run("DELETE FROM chats WHERE chat_id = ?", [chatId]);
  }
  saveStateSnapshot();
}

export function isGroupApproved(chatId: number): boolean {
  const group = db.query("SELECT status FROM groups WHERE chat_id = ?").get(chatId) as any;
  return group?.status === "approved";
}

export function proposeRule(key: string, value: string): number {
  const existing = db.query("SELECT id FROM rules WHERE key = ?").get(key) as any;
  if (existing) {
    db.run("UPDATE rules SET value = ?, approved = 0, created_at = CURRENT_TIMESTAMP WHERE id = ?", [value, existing.id]);
    return Number(existing.id);
  }
  const res = db.run("INSERT INTO rules (key, value, approved) VALUES (?, ?, 0)", [key, value]);
  return Number(res.lastInsertRowid);
}

export function approveRule(id: number): boolean {
  try {
    db.run("UPDATE rules SET approved = 1 WHERE id = ?", [id]);
    return true;
  } catch (e) {
    console.error("Error approving rule:", e);
    return false;
  }
}

export function rejectRule(id: number): boolean {
  try {
    db.run("DELETE FROM rules WHERE id = ?", [id]);
    return true;
  } catch (e) {
    console.error("Error rejecting rule:", e);
    return false;
  }
}

export function getApprovedRules(): { id: number; key: string; value: string }[] {
  try {
    return db.query("SELECT id, key, value FROM rules WHERE approved = 1 ORDER BY id ASC").all() as any[];
  } catch (e) {
    console.error("Error getting approved rules:", e);
    return [];
  }
}

export function getRuleById(id: number): { id: number; key: string; value: string; approved: number } | null {
  try {
    return (db.query("SELECT id, key, value, approved FROM rules WHERE id = ?").get(id) as any) || null;
  } catch {
    return null;
  }
}

export function clearChatContext(chatId: number): void {
  try {
    db.run("DELETE FROM chat_history WHERE user_id = ?", [chatId]);
    db.run("DELETE FROM messages WHERE chat_id = ?", [chatId]);
  } catch (e) {
    console.error("Error clearing chat context:", e);
  }
}




