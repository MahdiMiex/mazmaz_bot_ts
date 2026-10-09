import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import {
  db,
  registerOrUpdateUser,
  getUserById,
  approveUser,
  rejectUser,
  banUser,
  unbanUser,
  isUserBanned,
  muteUser,
  unmuteUser,
  isUserMuted,
  setUserQuota,
  addQuota,
  setSetting,
  getSetting,
  deleteSetting,
  checkAndConsumeQuota,
  saveStateSnapshot,
} from "../src/db";

describe("database operations", () => {
  const testUserId = 999988881;

  beforeAll(() => {
    db.run("DELETE FROM users WHERE user_id = ?", [testUserId]);
    db.run("DELETE FROM bot_settings WHERE key = ?", ["test_config_key"]);
    saveStateSnapshot();
  });

  afterAll(() => {
    db.run("DELETE FROM users WHERE user_id = ?", [testUserId]);
    db.run("DELETE FROM bot_settings WHERE key = ?", ["test_config_key"]);
    saveStateSnapshot();
  });

  it("should register a new regular user as unapproved", () => {
    const reg = registerOrUpdateUser(testUserId, "testuser", "Test", "User");
    expect(reg.isApproved).toBe(false);
    expect(reg.isAdmin).toBe(false);

    const user = getUserById(testUserId);
    expect(user).toBeDefined();
    expect(user.username).toBe("testuser");
    expect(user.is_approved).toBe(0);
  });

  it("should approve user", () => {
    approveUser(testUserId);
    const user = getUserById(testUserId);
    expect(user.is_approved).toBe(1);
  });

  it("should reject/disapprove user", () => {
    rejectUser(testUserId);
    const user = getUserById(testUserId);
    expect(user.is_approved).toBe(0);
  });

  it("should handle ban and unban", () => {
    expect(isUserBanned(testUserId)).toBe(false);
    banUser(testUserId);
    expect(isUserBanned(testUserId)).toBe(true);
    unbanUser(testUserId);
    expect(isUserBanned(testUserId)).toBe(false);
  });

  it("should handle mute and unmute", () => {
    expect(isUserMuted(testUserId).isMuted).toBe(false);
    muteUser(testUserId, 60, "spamming");
    expect(isUserMuted(testUserId).isMuted).toBe(true);
    unmuteUser(testUserId);
    expect(isUserMuted(testUserId).isMuted).toBe(false);
  });

  it("should manage user quotas", () => {
    setUserQuota(testUserId, 50);
    let user = getUserById(testUserId);
    expect(user.daily_quota).toBe(50);

    addQuota(testUserId, 10);
    user = getUserById(testUserId);
    expect(user.daily_quota).toBe(60);
  });

  it("should consume quota correctly for approved user", () => {
    approveUser(testUserId);
    db.run("UPDATE users SET used_today = 0 WHERE user_id = ?", [testUserId]);
    setUserQuota(testUserId, 10);
    const result = checkAndConsumeQuota(testUserId);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it("should save, retrieve and delete settings", () => {
    setSetting("test_config_key", "test_value_123");
    expect(getSetting("test_config_key")).toBe("test_value_123");

    deleteSetting("test_config_key");
    expect(getSetting("test_config_key")).toBe("");
  });
});
