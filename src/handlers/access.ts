import { Context, NextFunction, InlineKeyboard } from "grammy";
import { CONFIG } from "../config";
import { registerOrUpdateUser, checkAndConsumeQuota } from "../db";

const NOTIFIED_USERS = new Set<number>();

export async function accessControlMiddleware(ctx: Context, next: NextFunction) {
  const user = ctx.from;
  if (!user) return await next();

  const userId = user.id;
  const isAdmin = CONFIG.ADMIN_IDS.includes(userId);
  const chatType = ctx.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup";

  // Allow approval/rejection callbacks without quota checks
  if (ctx.callbackQuery?.data?.startsWith("appr:") || ctx.callbackQuery?.data?.startsWith("rejc:")) {
    return await next();
  }

  const userState = registerOrUpdateUser(
    userId,
    user.username || "",
    user.first_name,
    user.last_name || ""
  );

  // 1. Admin always has unlimited access
  if (isAdmin) {
    return await next();
  }

  // 2. Private chat approval check
  if (!isGroup && !userState.isApproved) {
    if (!NOTIFIED_USERS.has(userId)) {
      NOTIFIED_USERS.add(userId);

      const adminKb = new InlineKeyboard()
        .text("✅ تایید عضویت (۲۴ سهمیه)", `appr:${userId}`)
        .text("❌ رد درخواست", `rejc:${userId}`);

      const adminText = (
        `🔔 <b>درخواست عضویت کاربر جدید:</b>\n\n` +
        `👤 نام: <b>${user.first_name} ${user.last_name || ""}</b>\n` +
        `🆔 یوزرنیم: @${user.username || "ندارد"}\n` +
        `🔢 آیدی عددی: <code>${userId}</code>\n\n` +
        `آیا دسترسی این کاربر را تایید می‌کنید؟`
      );

      for (const adminId of CONFIG.ADMIN_IDS) {
        try {
          await ctx.api.sendMessage(adminId, adminText, {
            reply_markup: adminKb,
            parse_mode: "HTML",
          });
        } catch (e) {
          console.error("Failed to notify admin:", e);
        }
      }
    }

    const pendingText = (
      `🔒 <b>ربات اختصاصی mazmaz</b>\n\n` +
      `درخواست عضویت شما برای مدیر ارسال شده و در صف بررسی است. ⏳\n` +
      `به محض اینکه مدیر دسترسی شما را تایید کند، اعلان آن برای شما ارسال خواهد شد.`
    );

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "دسترسی شما هنوز تایید نشده است.", show_alert: true }).catch(() => {});
    } else {
      await ctx.reply(pendingText, { parse_mode: "HTML" });
    }
    return;
  }

  // 3. Quota check for approved users in private chats
  if (!isGroup) {
    const text = ctx.message?.text || "";
    const isFree = text === "/start" || text === "/help" || ctx.callbackQuery?.data === "menu_home";

    if (!isFree) {
      const quota = checkAndConsumeQuota(userId);
      if (!quota.allowed) {
        const limitText = (
          `⚠️ <b>سهمیه پیام امروز شما به پایان رسیده است!</b>\n\n` +
          `شما از سهمیه ۲۴ پیام/درخواست روزانه خود استفاده کرده‌اید.\n` +
          `سهمیه شما بامداد فردا مجدداً ریست و شارژ خواهد شد. 🌙`
        );
        if (ctx.callbackQuery) {
          await ctx.answerCallbackQuery({ text: "سهمیه پیام امروز شما تمام شده است.", show_alert: true }).catch(() => {});
        } else {
          await ctx.reply(limitText, { parse_mode: "HTML" });
        }
        return;
      }
    }
  }


  return await next();
}
