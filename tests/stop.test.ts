import { describe, expect, it } from "bun:test";
import { askGemini, STOPPED_RESULT } from "../src/services/ai";
import { runningTasks } from "../src/handlers/message";

describe("Stop and Abort Lifecycle", () => {
  describe("AbortController per-chat map lifecycle", () => {
    it("should manage task lifecycle: create, abort, and clean up in finally", async () => {
      const chatId = 999001;
      expect(runningTasks.has(chatId)).toBe(false);

      const controller = new AbortController();
      runningTasks.set(chatId, controller);
      expect(runningTasks.has(chatId)).toBe(true);
      expect(runningTasks.get(chatId)).toBe(controller);
      expect(controller.signal.aborted).toBe(false);

      // Simulate /stop abort
      const runningCtrl = runningTasks.get(chatId);
      if (runningCtrl) {
        runningCtrl.abort();
        runningTasks.delete(chatId);
      }
      expect(controller.signal.aborted).toBe(true);
      expect(runningTasks.has(chatId)).toBe(false);

      // Simulate finally block of task
      try {
        // Task was running...
      } finally {
        if (runningTasks.get(chatId) === controller) {
          runningTasks.delete(chatId);
        }
      }
      expect(runningTasks.has(chatId)).toBe(false);
    });

    it("should safely clean up in finally when task completes normally", async () => {
      const chatId = 999002;
      const controller = new AbortController();
      runningTasks.set(chatId, controller);

      try {
        expect(runningTasks.get(chatId)).toBe(controller);
      } finally {
        if (runningTasks.get(chatId) === controller) {
          runningTasks.delete(chatId);
        }
      }

      expect(runningTasks.has(chatId)).toBe(false);
    });

    it("should not delete a newer controller if an older task finishes later", async () => {
      const chatId = 999003;
      const oldController = new AbortController();
      const newController = new AbortController();

      // Old task starts
      runningTasks.set(chatId, oldController);

      // New task starts and replaces controller
      runningTasks.get(chatId)?.abort();
      runningTasks.set(chatId, newController);

      expect(oldController.signal.aborted).toBe(true);
      expect(newController.signal.aborted).toBe(false);
      expect(runningTasks.get(chatId)).toBe(newController);

      // Old task's finally executes
      if (runningTasks.get(chatId) === oldController) {
        runningTasks.delete(chatId);
      }

      // New controller must still be intact
      expect(runningTasks.get(chatId)).toBe(newController);

      // New task's finally executes
      if (runningTasks.get(chatId) === newController) {
        runningTasks.delete(chatId);
      }
      expect(runningTasks.has(chatId)).toBe(false);
    });
  });

  describe("askGemini with aborted signal", () => {
    it("should return STOPPED_RESULT immediately when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await askGemini(
        1234567,
        "یک داستان بلند درباره فضا بنویس",
        undefined,
        undefined,
        controller.signal
      );

      expect(result).toBe(STOPPED_RESULT);
      expect(result).toBe("⛔ متوقف شد");
    });
  });

  describe("sequentialize routing rules", () => {
    it("should bypass sequencing for /stop command and callback queries", () => {
      const getConstraint = (ctx: any) => {
        if (ctx.callbackQuery) return undefined;
        const text = ctx.message?.text || ctx.msg?.text;
        if (text && /^\/stop(?:@\w+)?(?:\s|$)/i.test(text.trim())) {
          return undefined;
        }
        return ctx.chat?.id ? String(ctx.chat.id) : undefined;
      };

      // /stop commands should return undefined (bypass sequencing)
      expect(getConstraint({ message: { text: "/stop" }, chat: { id: 100 } })).toBeUndefined();
      expect(getConstraint({ message: { text: "/stop@mazmazAgentBot" }, chat: { id: 100 } })).toBeUndefined();
      expect(getConstraint({ message: { text: "/stop please" }, chat: { id: 100 } })).toBeUndefined();

      // callback queries should return undefined (bypass sequencing)
      expect(getConstraint({ callbackQuery: { data: "btn_click" }, chat: { id: 100 } })).toBeUndefined();

      // normal messages should be sequentialized by chat ID
      expect(getConstraint({ message: { text: "سلام ربات" }, chat: { id: 100 } })).toBe("100");
      expect(getConstraint({ message: { text: "دانلود موزیک شادمهر" }, chat: { id: 200 } })).toBe("200");
    });
  });
});
