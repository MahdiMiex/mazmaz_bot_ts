import { describe, expect, it } from "bun:test";
import { splitMessage } from "../src/utils/chunker";

describe("chunker utils", () => {
  it("should not split text shorter than maxLen", () => {
    const text = "Short message";
    const chunks = splitMessage(text, 100);
    expect(chunks).toEqual(["Short message"]);
  });

  it("should split long text at paragraph breaks", () => {
    const p1 = "A".repeat(60);
    const p2 = "B".repeat(60);
    const text = `${p1}\n\n${p2}`;
    const chunks = splitMessage(text, 80);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(p1);
    expect(chunks[1]).toBe(p2);
  });

  it("should split long text at line breaks if no paragraph breaks", () => {
    const l1 = "A".repeat(50);
    const l2 = "B".repeat(50);
    const text = `${l1}\n${l2}`;
    const chunks = splitMessage(text, 70);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(l1);
    expect(chunks[1]).toBe(l2);
  });

  it("should preserve and close open code blocks across split boundaries", () => {
    const code = "```js\n" + "console.log('test');\n".repeat(10) + "```";
    const chunks = splitMessage(code, 80);
    expect(chunks.length).toBeGreaterThan(1);
    // Check first chunk closes code block
    expect(chunks[0].endsWith("```")).toBe(true);
    // Check second chunk starts code block
    expect(chunks[1].startsWith("```")).toBe(true);
  });
});
