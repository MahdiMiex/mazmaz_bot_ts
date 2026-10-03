import { Context } from "grammy";

/**
 * Splits text into Telegram-safe chunks (max 3800 characters)
 * preserving code blocks and line boundaries cleanly.
 */
export function splitMessage(text: string, maxLen = 3800): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = -1;

    // 1. Try splitting at double newline (paragraph boundary)
    const pBreak = remaining.lastIndexOf("\n\n", maxLen);
    if (pBreak > maxLen * 0.5) {
      splitIndex = pBreak;
    }

    // 2. Try splitting at single newline
    if (splitIndex === -1) {
      const lBreak = remaining.lastIndexOf("\n", maxLen);
      if (lBreak > maxLen * 0.4) {
        splitIndex = lBreak;
      }
    }

    // 3. Try splitting at space
    if (splitIndex === -1) {
      const sBreak = remaining.lastIndexOf(" ", maxLen);
      if (sBreak > maxLen * 0.3) {
        splitIndex = sBreak;
      }
    }

    // 4. Hard slice if no clean whitespace
    if (splitIndex === -1) {
      splitIndex = maxLen;
    }

    let chunk = remaining.slice(0, splitIndex).trim();
    remaining = remaining.slice(splitIndex).trim();

    // Preserve open code blocks across chunks
    const codeBlocks = (chunk.match(/```/g) || []).length;
    if (codeBlocks % 2 !== 0) {
      chunk += "\n```";
      remaining = "```\n" + remaining;
    }

    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Sends a Telegram chat action (e.g. "typing") periodically until the async action completes.
 */
export async function withTyping<T>(ctx: Context, action: () => Promise<T>): Promise<T> {
  const sendTyping = () => {
    ctx.replyWithChatAction("typing").catch(() => {});
  };
  sendTyping();
  const interval = setInterval(sendTyping, 4000);
  try {
    return await action();
  } finally {
    clearInterval(interval);
  }
}

/**
 * Sends a message safely to Telegram, automatically splitting into multiple
 * messages if it exceeds Telegram limits.
 */
export async function sendSafeMessage(
  ctx: Context,
  text: string,
  options: {
    parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
    reply_markup?: any;
    reply_parameters?: any;
  } = { parse_mode: "HTML" }
) {
  const chunks = splitMessage(text);
  const defaultReplyParams = ctx.message?.message_id
    ? { message_id: ctx.message.message_id, allow_sending_without_reply: true }
    : undefined;
  const replyParams = options.reply_parameters !== undefined ? options.reply_parameters : defaultReplyParams;

  for (let i = 0; i < chunks.length; i++) {
    const isFirst = i === 0;
    const isLast = i === chunks.length - 1;
    const opts: any = {
      ...options,
      reply_markup: isLast ? options.reply_markup : undefined,
      reply_parameters: isFirst ? replyParams : undefined,
    };
    try {
      await ctx.reply(chunks[i], opts);
    } catch (err: any) {
      // Fallback without parse_mode if invalid HTML tags
      console.warn("Failed sending with parse_mode, falling back to plain text:", err.message);
      await ctx.reply(chunks[i], {
        reply_markup: opts.reply_markup,
        reply_parameters: opts.reply_parameters,
      });
    }
    if (chunks.length > 1 && !isLast) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

/**
 * Safely updates an existing message with throttled edits to avoid Telegram 429 FloodWait.
 */
export class ThrottledStatusUpdater {
  private lastUpdate = 0;
  private pendingText: string | null = null;
  private timer: any = null;

  constructor(
    private ctx: Context,
    private messageId: number,
    private throttleMs = 700
  ) {}

  async update(text: string, parseMode: "HTML" | "Markdown" = "HTML") {
    const now = Date.now();
    this.pendingText = text;

    if (now - this.lastUpdate > this.throttleMs) {
      this.lastUpdate = now;
      await this.flush(parseMode);
    } else if (!this.timer) {
      this.timer = setTimeout(async () => {
        this.timer = null;
        this.lastUpdate = Date.now();
        await this.flush(parseMode);
      }, this.throttleMs - (now - this.lastUpdate));
    }
  }

  private async flush(parseMode: "HTML" | "Markdown") {
    if (!this.pendingText) return;
    const textToEdit = this.pendingText;
    this.pendingText = null;
    try {
      await this.ctx.api.editMessageText(this.ctx.chat!.id, this.messageId, textToEdit, {
        parse_mode: parseMode,
      });
    } catch (e: any) {
      // Ignore identical content edits or message not modified
      if (!String(e.message).includes("message is not modified")) {
        console.warn("Throttled edit failed:", e.message);
      }
    }
  }
}
