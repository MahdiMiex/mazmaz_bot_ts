import { describe, expect, it } from "bun:test";
import {
  isKeyAvailable,
  markKeyCooldown,
  withRetry,
} from "../src/services/resilience";

describe("resilience service", () => {
  describe("API key cooldown management", () => {
    it("should report fresh key as available", () => {
      expect(isKeyAvailable("test_key_12345")).toBe(true);
    });

    it("should mark key as unavailable during cooldown", () => {
      const key = "test_key_cooldown_abc";
      markKeyCooldown(key, 5000);
      expect(isKeyAvailable(key)).toBe(false);
    });
  });

  describe("withRetry", () => {
    it("should return result on first successful attempt", async () => {
      let attempts = 0;
      const res = await withRetry(async (attempt) => {
        attempts = attempt;
        return "success";
      }, 3, 10);
      expect(res).toBe("success");
      expect(attempts).toBe(1);
    });

    it("should retry on network / 429 error and succeed", async () => {
      let attempts = 0;
      const res = await withRetry(async (attempt) => {
        attempts = attempt;
        if (attempt === 1) {
          const err: any = new Error("429 Too Many Requests");
          err.status = 429;
          throw err;
        }
        return "recovered";
      }, 3, 10);
      expect(res).toBe("recovered");
      expect(attempts).toBe(2);
    });

    it("should immediately throw non-retryable error without retrying", async () => {
      let attempts = 0;
      try {
        await withRetry(async (attempt) => {
          attempts = attempt;
          const err: any = new Error("Bad Request 400");
          err.status = 400;
          throw err;
        }, 3, 10);
      } catch (err: any) {
        expect(err.status).toBe(400);
      }
      expect(attempts).toBe(1);
    });
  });
});
