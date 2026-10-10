import { describe, expect, it } from "bun:test";
import { askGemini, STOPPED_RESULT } from "../src/services/ai";
import { runningTasks, RunningTask } from "../src/handlers/message";
import { getSequentialKey } from "../src/utils/sequentialKey";
import { CONFIG } from "../src/config";

describe("Stop and Abort Lifecycle", () => {
  describe("runningTasks store format and lifecycle", () => {
    it("should store { controller, ownerId, startedAt } and clean up in finally", async () => {
      const chatId = 999101;
      const ownerId = 5001;
      expect(runningTasks.has(chatId)).toBe(false);

      const controller = new AbortController();
      const taskEntry: RunningTask = {
        controller,
        ownerId,
        startedAt: Date.now(),
      };

      runningTasks.set(chatId, taskEntry);
      expect(runningTasks.has(chatId)).toBe(true);
      expect(runningTasks.get(chatId)).toBe(taskEntry);
      expect(taskEntry.controller.signal.aborted).toBe(false);
      expect(taskEntry.ownerId).toBe(ownerId);
      expect(typeof taskEntry.startedAt).toBe("number");

      // Finally cleanup simulation
      try {
        // running...
      } finally {
        if (runningTasks.get(chatId) === taskEntry) {
          runningTasks.delete(chatId);
        }
      }

      expect(runningTasks.has(chatId)).toBe(false);
    });

    it("should not delete a newer task entry if an older task finishes later", async () => {
      const chatId = 999102;
      const oldController = new AbortController();
      const newController = new AbortController();

      const oldEntry: RunningTask = {
        controller: oldController,
        ownerId: 5002,
        startedAt: Date.now() - 1000,
      };
      const newEntry: RunningTask = {
        controller: newController,
        ownerId: 5003,
        startedAt: Date.now(),
      };

      // Old task starts
      runningTasks.set(chatId, oldEntry);

      // New task starts and replaces old task
      runningTasks.get(chatId)?.controller.abort();
      runningTasks.set(chatId, newEntry);

      expect(oldController.signal.aborted).toBe(true);
      expect(newController.signal.aborted).toBe(false);
      expect(runningTasks.get(chatId)).toBe(newEntry);

      // Old task's finally executes
      if (runningTasks.get(chatId) === oldEntry) {
        runningTasks.delete(chatId);
      }

      // New task must still remain
      expect(runningTasks.get(chatId)).toBe(newEntry);

      // New task's finally executes
      if (runningTasks.get(chatId) === newEntry) {
        runningTasks.delete(chatId);
      }

      expect(runningTasks.has(chatId)).toBe(false);
    });
  });

  describe("/stop authorization logic", () => {
    function simulateStopCommand(senderId: number, chatId: number) {
      const runningTask = runningTasks.get(chatId);
      let taskStopped = false;
      let unauthorizedStop = false;

      if (runningTask) {
        const isOwner = runningTask.ownerId === senderId;
        const isAdmin = CONFIG.ADMIN_IDS.includes(senderId);

        if (isOwner || isAdmin) {
          runningTask.controller.abort();
          runningTasks.delete(chatId);
          taskStopped = true;
        } else {
          unauthorizedStop = true;
        }
      }

      let replyText = "";
      if (unauthorizedStop) {
        replyText = "فقط درخواست‌دهنده یا مدیر می‌تواند عملیات را متوقف کند.";
      } else if (taskStopped) {
        replyText = "⛔ عملیات در حال اجرا متوقف شد و حافظه مکالمه پاک گردید.";
      } else {
        replyText = "هیچ عملیات فعالی در حال اجرا نبود. حافظه مکالمه پاک شد.";
      }

      return { taskStopped, unauthorizedStop, replyText };
    }

    it("allows the task owner to abort the running task and cleans up in finally", async () => {
      const chatId = 999201;
      const ownerId = 7001;
      const controller = new AbortController();
      const taskEntry: RunningTask = {
        controller,
        ownerId,
        startedAt: Date.now(),
      };

      runningTasks.set(chatId, taskEntry);

      // Owner sends /stop
      const result = simulateStopCommand(ownerId, chatId);

      expect(result.taskStopped).toBe(true);
      expect(result.unauthorizedStop).toBe(false);
      expect(result.replyText).toContain("متوقف شد");
      expect(controller.signal.aborted).toBe(true);
      expect(runningTasks.has(chatId)).toBe(false);

      // Task's finally block executes
      try {
        // ...
      } finally {
        if (runningTasks.get(chatId) === taskEntry) {
          runningTasks.delete(chatId);
        }
      }
      expect(runningTasks.has(chatId)).toBe(false);
    });

    it("allows an admin to abort the running task and cleans up in finally", async () => {
      const chatId = 999202;
      const ownerId = 7002;
      const adminId = CONFIG.ADMIN_IDS[0];
      expect(adminId).toBeDefined();

      const controller = new AbortController();
      const taskEntry: RunningTask = {
        controller,
        ownerId,
        startedAt: Date.now(),
      };

      runningTasks.set(chatId, taskEntry);

      // Admin sends /stop
      const result = simulateStopCommand(adminId, chatId);

      expect(result.taskStopped).toBe(true);
      expect(result.unauthorizedStop).toBe(false);
      expect(result.replyText).toContain("متوقف شد");
      expect(controller.signal.aborted).toBe(true);
      expect(runningTasks.has(chatId)).toBe(false);

      // Task's finally block executes
      try {
        // ...
      } finally {
        if (runningTasks.get(chatId) === taskEntry) {
          runningTasks.delete(chatId);
        }
      }
      expect(runningTasks.has(chatId)).toBe(false);
    });

    it("does NOT allow a different non-admin user to abort, and removes entry in finally when task completes", async () => {
      const chatId = 999203;
      const ownerId = 7003;
      const otherUserId = 9999999;
      expect(CONFIG.ADMIN_IDS.includes(otherUserId)).toBe(false);

      const controller = new AbortController();
      const taskEntry: RunningTask = {
        controller,
        ownerId,
        startedAt: Date.now(),
      };

      runningTasks.set(chatId, taskEntry);

      // Non-owner, non-admin sends /stop
      const result = simulateStopCommand(otherUserId, chatId);

      expect(result.taskStopped).toBe(false);
      expect(result.unauthorizedStop).toBe(true);
      expect(result.replyText).toBe("فقط درخواست‌دهنده یا مدیر می‌تواند عملیات را متوقف کند.");
      expect(controller.signal.aborted).toBe(false);
      expect(runningTasks.has(chatId)).toBe(true);
      expect(runningTasks.get(chatId)).toBe(taskEntry);

      // Task continues and finishes normally; finally executes
      try {
        // Task completed normally or with error
      } finally {
        if (runningTasks.get(chatId) === taskEntry) {
          runningTasks.delete(chatId);
        }
      }

      expect(runningTasks.has(chatId)).toBe(false);
    });

    it("replies that nothing was running if chat has no active task", async () => {
      const chatId = 999204;
      const userId = 7004;
      expect(runningTasks.has(chatId)).toBe(false);

      const result = simulateStopCommand(userId, chatId);
      expect(result.taskStopped).toBe(false);
      expect(result.unauthorizedStop).toBe(false);
      expect(result.replyText).toBe("هیچ عملیات فعالی در حال اجرا نبود. حافظه مکالمه پاک شد.");
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

  describe("real getSequentialKey function", () => {
    it("should bypass sequencing for /stop command and callback queries", () => {
      // /stop commands should return undefined (bypass sequencing)
      expect(getSequentialKey({ message: { text: "/stop" }, chat: { id: 100 } })).toBeUndefined();
      expect(getSequentialKey({ message: { text: "/stop@mazmazAgentBot" }, chat: { id: 100 } })).toBeUndefined();
      expect(getSequentialKey({ message: { text: "/stop please" }, chat: { id: 100 } })).toBeUndefined();
      expect(getSequentialKey({ message: { text: "  /stop   " }, chat: { id: 100 } })).toBeUndefined();

      // callback queries should return undefined (bypass sequencing)
      expect(getSequentialKey({ callbackQuery: { data: "btn_click" }, chat: { id: 100 } })).toBeUndefined();

      // normal messages should be sequentialized by chat ID
      expect(getSequentialKey({ message: { text: "سلام ربات" }, chat: { id: 100 } })).toBe("100");
      expect(getSequentialKey({ message: { text: "دانلود موزیک شادمهر" }, chat: { id: 200 } })).toBe("200");
    });
  });
});
