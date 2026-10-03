/**
 * Smart Reaction Matcher for Telegram Messages.
 * Detects short conversational intents (gratitude, laughter, approval, praise, farewell)
 * and reacts with an emoji directly on the message instead of invoking the LLM,
 * achieving 100% token savings and zero-latency human-like response.
 */

export type TelegramReactionEmoji =
  | "👍"
  | "👎"
  | "❤️"
  | "🔥"
  | "🥰"
  | "👏"
  | "😁"
  | "🤔"
  | "🤯"
  | "😱"
  | "🎉"
  | "🤩"
  | "🙏"
  | "👌"
  | "💯"
  | "🤣"
  | "⚡"
  | "🤝"
  | "🫡"
  | "😎";

export function getSmartReaction(text: string): TelegramReactionEmoji | null {
  if (!text) return null;

  const t = text
    .replace(/^(?:(?:سلام|درود|هی|الو|چطوری|ey|hi|hello)\s+)?(?:مزمز|mazmaz)[،,:.!؟?\s]*/i, "")
    .replace(/مزمزم?|mazmaz/gi, "")
    .trim()
    .toLowerCase();

  // 1. تشکر و قدردانی (Gratitude) -> ❤️ یا 🙏 یا 🤝 یا 🥰
  if (
    /^(?:مرسی|ممنون|ممنونم|دمت\s*گرم|دستت\s*درد\s*نکنه|عشقی|سپاس|تشکر|تشکر\s*میکنم|thanks|thank\s*you|thx|ty)(?:$|\s|[،,:.!؟?])/i.test(
      t
    )
  ) {
    const list: TelegramReactionEmoji[] = ["❤️", "🙏", "🤝", "🥰"];
    return list[Math.floor(Math.random() * list.length)];
  }

  // 2. خنده و شوخی (Laughter) -> 🤣 یا 🔥 یا 👏
  if (/^(?:[😂🤣]+|خ+|ها+|هه+|جر\s*خوردم|پاره\s*شدم|lol|lmao|rofl)(?:$|\s|[،,:.!؟?])/i.test(t)) {
    const list: TelegramReactionEmoji[] = ["🤣", "🔥", "👏"];
    return list[Math.floor(Math.random() * list.length)];
  }

  // 3. تأیید و رضایت (Approval / Agreement) -> 👍 یا 👌 یا ⚡ یا 💯
  if (
    /^(?:اوکی|اوکیه|حله|باشه|باش|عالیه|ایول|فوق\s*العاده|اوکی\s*شد|خیلی\s*خوب|خوبه|دمت\s*گرم|ok|okay|cool|nice|perfect|done)(?:$|\s|[،,:.!؟?])/i.test(
      t
    )
  ) {
    const list: TelegramReactionEmoji[] = ["👍", "👌", "⚡", "💯"];
    return list[Math.floor(Math.random() * list.length)];
  }

  // 4. ابراز محبت و تعریف (Praise / Affection) -> ❤️ یا 🥰 یا 🔥 یا 😎
  if (/^(?:عشقی\s*تو|دوست\s*دارم|عالی\s*هستی|پرچمت\s*بالاست|خیلی\s*باحالی|بهترینی|love\s*you)(?:$|\s|[،,:.!؟?])/i.test(t)) {
    const list: TelegramReactionEmoji[] = ["❤️", "🥰", "🔥", "😎"];
    return list[Math.floor(Math.random() * list.length)];
  }

  // 5. خداحافظی و احترام (Farewell / Respect) -> 🫡 یا 🤝
  if (/^(?:فعلا|خداحافظ|خدافظ|شب\s*بخیر|روز\s*خوش|بای|bye|goodbye|gn)(?:$|\s|[،,:.!؟?])/i.test(t)) {
    const list: TelegramReactionEmoji[] = ["🫡", "🤝"];
    return list[Math.floor(Math.random() * list.length)];
  }

  return null;
}
