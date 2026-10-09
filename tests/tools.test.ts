import { describe, expect, it } from "bun:test";
import { executeTool, toolDeclarations } from "../src/tools";

describe("tools", () => {
  it("should have correct tool declarations", () => {
    expect(toolDeclarations.length).toBeGreaterThan(0);
    const mathTool = toolDeclarations.find((t) => t.name === "eval_math");
    expect(mathTool).toBeDefined();
    expect(mathTool?.parameters?.required).toContain("expression");
  });

  describe("eval_math", () => {
    it("should calculate basic arithmetic operations", async () => {
      const res = await executeTool("eval_math", { expression: "2 + 2 * 3" });
      expect(res.result).toBe(8);
    });

    it("should support power with ^ and × ÷ characters", async () => {
      const res = await executeTool("eval_math", { expression: "2 ^ 4 + 10 ÷ 2 - 2 × 3" });
      // 16 + 5 - 6 = 15
      expect(res.result).toBe(15);
    });

    it("should support trigonometric functions (degree input)", async () => {
      const res = await executeTool("eval_math", { expression: "sin(90)" });
      expect(res.result).toBeCloseTo(1, 4);
    });

    it("should block arbitrary code execution / unsafe identifiers", async () => {
      const res = await executeTool("eval_math", { expression: "process.exit(1)" });
      expect(res.error).toBeDefined();
      expect(res.error).toContain("عملگر یا تابع نامعتبر");
    });

    it("should handle empty expression gracefully", async () => {
      const res = await executeTool("eval_math", { expression: "" });
      expect(res.error).toBeDefined();
    });
  });

  it("should return error for unknown tool", async () => {
    const res = await executeTool("non_existent_tool", {});
    expect(res.error).toBeDefined();
  });
});
