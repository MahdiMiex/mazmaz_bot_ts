import { describe, expect, it } from "bun:test";
import {
  checkProfanity,
  isPersian,
  isDeadModel,
  getModelCandidateChain,
  getResolvedActiveModel,
} from "../src/services/ai";

describe("ai service helpers", () => {
  describe("checkProfanity", () => {
    it("should detect prohibited words", () => {
      const roast = checkProfanity("این یک متن با کلمه bitch است");
      expect(roast).not.toBeNull();
      expect(typeof roast).toBe("string");
    });

    it("should return null for clean text", () => {
      const result = checkProfanity("سلام وقت شما بخیر، وضعیت آب و هوا چطوره؟");
      expect(result).toBeNull();
    });
  });

  describe("isPersian", () => {
    it("should return true for Persian text", () => {
      expect(isPersian("سلام من یک کاربر فارسی‌زبان هستم")).toBe(true);
    });

    it("should return false for English text", () => {
      expect(isPersian("Hello world, this is English text only.")).toBe(false);
    });
  });

  describe("isDeadModel", () => {
    it("should identify deprecated gemini models as dead", () => {
      expect(isDeadModel("gemini-1.5-flash")).toBe(true);
      expect(isDeadModel("gemini-1.5-pro")).toBe(true);
      expect(isDeadModel("gemini-2.0-flash")).toBe(true);
      expect(isDeadModel("gemini-2.5-flash")).toBe(true);
    });

    it("should identify active 3.x models as non-dead", () => {
      expect(isDeadModel("gemini-3.7-flash")).toBe(false);
      expect(isDeadModel("gemini-3.8-flash")).toBe(false);
      expect(isDeadModel("gemini-3.5-flash")).toBe(false);
    });
  });

  describe("model candidate resolution", () => {
    it("should resolve a valid active model", () => {
      const active = getResolvedActiveModel();
      expect(active.model).toBeDefined();
      expect(isDeadModel(active.model)).toBe(false);
    });

    it("should return candidate chain without dead models", () => {
      const chain = getModelCandidateChain();
      expect(chain.length).toBeGreaterThan(0);
      for (const m of chain) {
        expect(isDeadModel(m)).toBe(false);
      }
    });
  });
});
