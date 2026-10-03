/**
 * Converts standard Markdown into valid, Telegram-compliant HTML.
 * Handles escaping of special characters, headers, bold, italics, links,
 * blockquotes, bullet points, inline code, and code blocks
 * without breaking BiDi or crashing Telegram entity parser.
 */
export function markdownToTelegramHtml(markdown: string): string {
  if (!markdown) return "";

  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  // 1. Extract fenced code blocks first so inner content is completely untouched
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

  // 4. Blockquotes: > quote
  formatted = formatted.replace(/^&gt;\s+(.+)$/gm, "<blockquote>$1</blockquote>");

  // 5. Headers (# Title, ## Title, ### Title) -> <b>Title</b>
  formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, "\n<b>$1</b>\n");

  // 6. Bold: **text** or __text__ -> <b>text</b>
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  formatted = formatted.replace(/__(.+?)__/g, "<b>$1</b>");

  // 7. Italic: *text* or _text_ -> <i>text</i>
  formatted = formatted.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "<i>$1</i>");
  formatted = formatted.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<i>$1</i>");

  // 8. Strikethrough: ~~text~~ -> <s>text</s>
  formatted = formatted.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // 9. Markdown Links: [text](https://...) -> <a href="...">text</a>
  formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2">$1</a>');

  // 10. Bullet lists: "- item" or "* item" -> "• item"
  formatted = formatted.replace(/^[\*\-]\s+(.+)$/gm, "• $1");

  // 11. Clean up any leftover unclosed raw asterisks
  formatted = formatted.replace(/\*\*/g, "");

  // 12. Restore inline code
  formatted = formatted.replace(/§§§IC(\d+)§§§/g, (_, idx) => {
    return inlineCodes[Number(idx)] || "";
  });

  // 13. Restore code blocks
  formatted = formatted.replace(/§§§CB(\d+)§§§/g, (_, idx) => {
    return codeBlocks[Number(idx)] || "";
  });

  // Clean excessive blank lines
  formatted = formatted.replace(/\n{3,}/g, "\n\n");

  return formatted.trim();
}

export function escapeHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

