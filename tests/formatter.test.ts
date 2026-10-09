import { describe, expect, it } from "bun:test";
import { markdownToTelegramHtml, escapeHtml } from "../src/utils/formatter";

describe("formatter utils", () => {
  describe("escapeHtml", () => {
    it("should escape special characters", () => {
      expect(escapeHtml("<script>&test</script>")).toBe("&lt;script&gt;&amp;test&lt;/script&gt;");
    });

    it("should return empty string on empty input", () => {
      expect(escapeHtml("")).toBe("");
    });
  });

  describe("markdownToTelegramHtml", () => {
    it("should convert bold text", () => {
      expect(markdownToTelegramHtml("**Hello World**")).toBe("<b>Hello World</b>");
    });

    it("should convert italic text", () => {
      expect(markdownToTelegramHtml("*Italic*")).toBe("<i>Italic</i>");
    });

    it("should convert inline code and preserve content", () => {
      expect(markdownToTelegramHtml("Use `const x = 10;` in code")).toBe("Use <code>const x = 10;</code> in code");
    });

    it("should convert fenced code blocks with language", () => {
      const md = "```typescript\nconst a = 1;\nconsole.log(a);\n```";
      const result = markdownToTelegramHtml(md);
      expect(result).toContain('<pre><code class="language-typescript">');
      expect(result).toContain("const a = 1;");
      expect(result).toContain("</code></pre>");
    });

    it("should convert headers to bold", () => {
      expect(markdownToTelegramHtml("## Section Title")).toBe("<b>Section Title</b>");
    });

    it("should convert links", () => {
      expect(markdownToTelegramHtml("[Google](https://google.com)")).toBe('<a href="https://google.com">Google</a>');
    });

    it("should convert bullet points", () => {
      const md = "- Item 1\n- Item 2";
      const html = markdownToTelegramHtml(md);
      expect(html).toContain("• Item 1");
      expect(html).toContain("• Item 2");
    });

    it.skip("should auto-balance open tags", () => {
      const broken = "<b>Unclosed bold tag";
      const balanced = markdownToTelegramHtml(broken);
      expect(balanced).toBe("<b>Unclosed bold tag</b>");
    });

    it("should handle spoilers", () => {
      expect(markdownToTelegramHtml("||Secret spoiler||")).toBe("<tg-spoiler>Secret spoiler</tg-spoiler>");
    });
  });
});
