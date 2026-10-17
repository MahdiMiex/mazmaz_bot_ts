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

    it("should safely intercept division by zero", async () => {
      const res = await executeTool("eval_math", { expression: "10 / 0" });
      expect(res.error).toBeDefined();
      expect(res.error).toContain("تقسیم بر صفر");
    });

    it("should safely intercept NaN expressions", async () => {
      const res = await executeTool("eval_math", { expression: "0 / 0" });
      expect(res.error).toBeDefined();
      expect(res.error).toContain("NaN");
    });

    it("should support Persian digits and operators", async () => {
      const res = await executeTool("eval_math", { expression: "۴ × ۳ + ۲" });
      expect(res.result).toBe(14);
    });

    it("should reject malicious punctuation and statements", async () => {
      const res = await executeTool("eval_math", { expression: "1; const a = 2;" });
      expect(res.error).toBeDefined();
      expect(res.error).toContain("کاراکترهای غیرمجاز");
    });
  });

  describe("get_weather", () => {
    it("should return error when city is empty", async () => {
      const res = await executeTool("get_weather", { city: "" });
      expect(res.error).toBeDefined();
      expect(res.error).toContain("نام شهر وارد نشده است");
    });

    it("should handle service downtime (res.ok is false) without throwing", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response("Gateway Timeout", {
          status: 504,
          statusText: "Gateway Timeout",
        }) as any;

      try {
        const res = await executeTool("get_weather", { city: "تهران" });
        expect(res.error).toBeDefined();
        expect(res.error).toContain("504");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should handle non-JSON responses without crashing", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response("<html><head><title>502 Bad Gateway</title></head><body>Error</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }) as any;

      try {
        const res = await executeTool("get_weather", { city: "تهران" });
        expect(res.error).toBeDefined();
        expect(res.error).toContain("نامعتبر");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should parse valid wttr.in weather data correctly", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            current_condition: [
              {
                temp_C: "22",
                weatherDesc: [{ value: "Sunny" }],
                humidity: "35",
                FeelsLikeC: "21",
                windspeedKmph: "15",
              },
            ],
          }),
          { status: 200 }
        ) as any;

      try {
        const res = await executeTool("get_weather", { city: "تهران" });
        expect(res.temp_C).toBe("22");
        expect(res.weather).toBe("Sunny");
        expect(res.humidity).toBe("35");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("web_search", () => {
    it("should return error for empty query", async () => {
      const res = await executeTool("web_search", { query: "" });
      expect(res.error).toBeDefined();
    });

    it("should route through searchWeb and handle results", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            results: [{ title: "تست جستجو", content: "توضیحات تست", url: "https://example.com" }],
          }),
          { status: 200 }
        ) as any;

      try {
        const res = await executeTool("web_search", { query: "آب و هوای امروز" });
        expect(res).toBeDefined();
        expect(res.results).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it("should return error for unknown tool", async () => {
    const res = await executeTool("non_existent_tool", {});
    expect(res.error).toBeDefined();
  });
});
