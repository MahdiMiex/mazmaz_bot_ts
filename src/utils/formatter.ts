/**
 * Converts standard Markdown into valid, Telegram-compliant HTML.
 * Handles escaping, headers, bold, italics, links, inline code, and code blocks
 * without breaking BiDi or crashing Telegram entity parser.
 */
export function markdownToTelegramHtml(markdown: string): string {
  if (!markdown) return "";

  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  // 1. Extract fenced code blocks first so inner content is untouched
  let formatted = markdown.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const langAttr = lang ? ` class="language-${lang}"` : "";
    const index = codeBlocks.length;
    codeBlocks.push(`<pre><code${langAttr}>${escaped}</code></pre>`);
    return `§§§CB${index}§§§`;
  });

  // 2. Extract inline code
  formatted = formatted.replace(/`([^`\n]+)`/g, (_, code) => {
    const escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const index = inlineCodes.length;
    inlineCodes.push(`<code>${escaped}</code>`);
    return `§§§IC${index}§§§`;
  });

  // 3. Escape HTML special characters in the text
  formatted = formatted
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 4. Headers (# Title, ## Title, ### Title) -> <b>Title</b>
  formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // 5. Bold: **text** or __text__ -> <b>text</b>
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  formatted = formatted.replace(/__(.+?)__/g, "<b>$1</b>");

  // 6. Italic: *text* or _text_ -> <i>text</i>
  formatted = formatted.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "<i>$1</i>");
  formatted = formatted.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<i>$1</i>");

  // 7. Strikethrough: ~~text~~ -> <s>text</s>
  formatted = formatted.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // 8. Markdown Links: [text](https://...) -> <a href="...">text</a>
  formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2">$1</a>');

  // 9. Bullet lists: "- item" or "* item" -> "• item"
  formatted = formatted.replace(/^[\*\-]\s+(.+)$/gm, "• $1");

  // 10. Restore inline code
  formatted = formatted.replace(/§§§IC(\d+)§§§/g, (_, idx) => {
    return inlineCodes[Number(idx)] || "";
  });

  // 11. Restore code blocks
  formatted = formatted.replace(/§§§CB(\d+)§§§/g, (_, idx) => {
    return codeBlocks[Number(idx)] || "";
  });

  return formatted.trim();
}
