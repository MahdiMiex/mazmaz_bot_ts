import { Context, InlineKeyboard } from "grammy";
import { CONFIG } from "../config";
import { saveFeedbackReport } from "../db";

export const ADMIN_REPLY_TARGET = new Map<number, number>();

export function isBugReport(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /(?:باگ\s*داره|باگ\s*خورد|این\s*باگه|باگ\s*شده|باگ\s*توشه|بات\s*خرابه|ربات\s*خرابه|بات\s*کار\s*نمیکنه|ربات\s*کار\s*نمیکنه|ارور\s*میده|ارور\s*داد|ارور\s*داره|ارور\s*میخوره|چرارور|چرا\s*ارور|چرا\s*کار\s*نمیکنه|پاسخ\s*نمیده|جواب\s*نمیده|هنگ\s*کرده|قطع\s*شده|مشکل\s*داره|خطا\s*میده|چرا\s*خرابه|این\s*چه\s*اروریه|ارور\s*چیه|باگ\s*هات|فیکس\s*کن|باگ\s*داری)/i.test(
      t
    ) ||
    (/\b(?:bug|error|crash|broken)\b/i.test(t) &&
      !/(?:دیباگ|debug)/i.test(t))
  );
}

export function isFeedbackOrCriticism(text: string): boolean {
  const t = text.toLowerCase();
  return /(?:پیشنهاد\s*میدم|پیشنهاد\s*دارم|انتقاد\s*دارم|انتقادم|پیشنهادم|خیلی\s*کنده|چرا\s*اینقدر\s*کنده|چرا\s*انقدر\s*کنده|سرعتش\s*پایینه|خیلی\s*طول\s*میکشه|کاش\s*میشد|کاش\s*میتونست|ای\s*کاش|بهتر\s*نیست|اگه\s*میشه\s*اضافه|اضافه\s*کنید|قابلیت\s*جدید|خیلی\s*ضعیفه|فیدبک|feedback)/i.test(
    t
  );
}

function getSenderInfo(ctx: Context) {
  const user = ctx.from!;
  const senderName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "کاربر ناشناس";
  const senderUser = user.username ? `@${user.username}` : "بدون یوزرنیم";
  const chatType = ctx.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup";
  const where = isGroup ? `گروه «${ctx.chat?.title || "گروه"}»` : "پی‌وی ربات";

  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "full",
    timeZone: "Asia/Tehran",
  }).format(now);
  const timeStr = new Intl.DateTimeFormat("fa-IR", {
    timeStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(now);

  return {
    userId: user.id,
    senderName,
    senderUser,
    isGroup,
    where,
    dateStr,
    timeStr,
  };
}

/**
 * Handles bug reports:
 * - In groups: Mentions Mehdi (@mmahdiz44) and notifies him in DM with details and exact time.
 * - In private chat: Directly notifies Mehdi with full details and exact time.
 */
export async function handleBugReport(ctx: Context, text: string) {
  const info = getSenderInfo(ctx);
  const replyOpts = {
    reply_parameters: {
      message_id: ctx.message!.message_id,
      allow_sending_without_reply: true,
    },
  };

  saveFeedbackReport(info.userId, "bug", text, ctx.chat?.title || "پی‌وی", ctx.chat!.id);

  // Group reply mentioning Mehdi
  if (info.isGroup) {
    await ctx.reply(
      `🔍 <b>گزارش باگ ثبت شد!</b>\n\n` +
        `رئیس و سازنده‌ام @${CONFIG.CREATOR_USERNAME} رو منشن کردم و هم‌زمان جزئیات دقیق گزارش رو با زمان ثبت به پی‌وی‌ش فرستادم تا سریعاً بررسی و فیکس کنه! 🛠️🫡`,
      { ...replyOpts, parse_mode: "HTML" }
    );
  } else {
    await ctx.reply(
      `🔍 <b>گزارش مشکل به دست مدیریت رسید!</b>\n\n` +
        `پیام و گزارش شما در ساعت <code>${info.timeStr}</code> مستقیماً به پی‌وی رئیس مهدی ارسال شد. ممنون از همراهیت رفیق! 🛠️`,
      { ...replyOpts, parse_mode: "HTML" }
    );
  }

  // Send detailed alert to Mehdi
  const adminKb = new InlineKeyboard()
    .text("💬 ارسال پاسخ به کاربر", `reply_u:${info.userId}`)
    .text("👁️ دیدم / بررسی شد", "ack_report");

  const alertText = (
    `🚨 <b>گزارش باگ / ارور جدید در سیستم:</b>\n\n` +
    `👤 <b>فرستنده:</b> <b>${info.senderName}</b> (${info.senderUser})\n` +
    `🔢 <b>آیدی عددی:</b> <code>${info.userId}</code>\n` +
    `📍 <b>محل گزارش:</b> <b>${info.where}</b>\n` +
    `📅 <b>تاریخ:</b> ${info.dateStr}\n` +
    `⏰ <b>ساعت دقیق ثبت:</b> <code>${info.timeStr}</code>\n\n` +
    `💬 <b>متن گزارش کاربر:</b>\n` +
    `<blockquote>${text.slice(0, 1000)}</blockquote>`
  );

  for (const adminId of CONFIG.ADMIN_IDS) {
    ctx.api
      .sendMessage(adminId, alertText, { reply_markup: adminKb, parse_mode: "HTML" })
      .catch((e) => console.warn("Could not notify admin of bug:", e?.message));
  }
}

/**
 * Handles suggestions and criticism:
 * - Acknowledges user politely.
 * - Forwards to Mehdi with full context, exact date, and time.
 */
export async function handleFeedbackOrCriticism(ctx: Context, text: string) {
  const info = getSenderInfo(ctx);
  const replyOpts = {
    reply_parameters: {
      message_id: ctx.message!.message_id,
      allow_sending_without_reply: true,
    },
  };

  saveFeedbackReport(
    info.userId,
    "suggestion",
    text,
    ctx.chat?.title || "پی‌وی",
    ctx.chat!.id
  );

  await ctx.reply(
    `💡 <b>پیشنهاد / انتقاد شما دریافت شد!</b>\n\n` +
      `نظرت خیلی برامون ارزشمنده رفیق. متن پیامت در ساعت <code>${info.timeStr}</code> مستقیماً به گوش سازنده‌ام مهدی رسید تا برای ارتقای بات بررسیش کنه! 🤝✨`,
    { ...replyOpts, parse_mode: "HTML" }
  );

  const adminKb = new InlineKeyboard().text(
    "💬 ارسال پاسخ به کاربر",
    `reply_u:${info.userId}`
  );

  const alertText = (
    `💡 <b>پیشنهاد / انتقاد جدید کاربر:</b>\n\n` +
    `👤 <b>فرستنده:</b> <b>${info.senderName}</b> (${info.senderUser})\n` +
    `🔢 <b>آیدی عددی:</b> <code>${info.userId}</code>\n` +
    `📍 <b>محل ارسال:</b> <b>${info.where}</b>\n` +
    `📅 <b>تاریخ:</b> ${info.dateStr}\n` +
    `⏰ <b>ساعت دقیق:</b> <code>${info.timeStr}</code>\n\n` +
    `💬 <b>متن پیشنهاد / انتقاد:</b>\n` +
    `<blockquote>${text.slice(0, 1000)}</blockquote>`
  );

  for (const adminId of CONFIG.ADMIN_IDS) {
    ctx.api
      .sendMessage(adminId, alertText, { reply_markup: adminKb, parse_mode: "HTML" })
      .catch((e) => console.warn("Could not notify admin of feedback:", e?.message));
  }
}

/**
 * Handles profanity:
 * - Roasts user in chat.
 * - Sends alert to Mehdi offering 6-hour mute, 24-hour mute, or permanent ban!
 */
export async function handleProfanityAlert(
  ctx: Context,
  text: string,
  roastMessage: string
) {
  const info = getSenderInfo(ctx);
  const replyOpts = {
    reply_parameters: {
      message_id: ctx.message!.message_id,
      allow_sending_without_reply: true,
    },
  };

  saveFeedbackReport(
    info.userId,
    "profanity",
    text,
    ctx.chat?.title || "پی‌وی",
    ctx.chat!.id
  );

  // Send funny roast to the toxic user
  await ctx.reply(roastMessage, replyOpts);

  // Send action decision to Mehdi
  const adminKb = new InlineKeyboard()
    .text("⏳ میوت ۶ ساعته", `mute_u:6:${info.userId}`)
    .text("⏳ میوت ۲۴ ساعته", `mute_u:24:${info.userId}`)
    .row()
    .text("🚫 مسدودسازی کامل", `ban_u:${info.userId}`)
    .text("👁️ بخشش / نادیده گرفتن", "ignore_alert");

  const alertText = (
    `⚠️ <b>گزارش استفاده از کلمات نامناسب / بی‌احترامی:</b>\n\n` +
    `👤 <b>فرستنده:</b> <b>${info.senderName}</b> (${info.senderUser})\n` +
    `🔢 <b>آیدی عددی:</b> <code>${info.userId}</code>\n` +
    `📍 <b>مکان:</b> <b>${info.where}</b>\n` +
    `⏰ <b>ساعت:</b> <code>${info.timeStr}</code>\n\n` +
    `💬 <b>متن پیام:</b>\n` +
    `<code>${text.slice(0, 300)}</code>\n\n` +
    `❓ <b>دستور شما چیست رئیس؟ آیا کاربر را محدود یا میوت کنم؟</b>`
  );

  for (const adminId of CONFIG.ADMIN_IDS) {
    ctx.api
      .sendMessage(adminId, alertText, { reply_markup: adminKb, parse_mode: "HTML" })
      .catch((e) => console.warn("Could not notify admin of profanity:", e?.message));
  }
}
