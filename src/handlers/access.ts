import { Context, NextFunction, InlineKeyboard } from "grammy";
import { CONFIG } from "../config";
import { registerOrUpdateUser, checkAndConsumeQuota, canUserUseCommands, isUserBanned, isUserMuted, isGroupApproved } from "../db";

const NOTIFIED_USERS = new Set<number>();

export async function accessControlMiddleware(ctx: Context, next: NextFunction) {
  const user = ctx.from;
  if (!user) return await next();
  if (ctx.myChatMember) return await next();

  const userId = user.id;
  const isAdmin = CONFIG.ADMIN_IDS.includes(userId);
  const chatType = ctx.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup";

  // Allow approval/rejection callbacks without quota checks
  if (
    ctx.callbackQuery?.data?.startsWith("appr:") ||
    ctx.callbackQuery?.data?.startsWith("rejc:") ||
    ctx.callbackQuery?.data?.startsWith("grp_")
  ) {
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

  // 1.0 بررسی تایید گروه توسط مدیر اصلی
  if (isGroup && !isGroupApproved(ctx.chat!.id)) {
    const text = ctx.message?.text || "";
    const isBotCalled =
      ctx.message?.reply_to_message?.from?.id === ctx.me?.id ||
      text.includes(`@${ctx.me?.username?.toLowerCase()}`) ||
      /^(?:(?:سلام|درود|هی|الو|چطوری)\s+)?(?:مزمز|mazmaz)/i.test(text.trim());

    if (isBotCalled) {
      await ctx.reply(
        `⚠️ <b>گروه در انتظار تایید مدیریت:</b>\n\n` +
        `فعالیت مزمز در این گروه نیازمند تایید سازنده و مدیر اصلی (@${CONFIG.CREATOR_USERNAME}) است. درخواست عضویت ثبت شده و پس از بررسی و تایید رئیس، ربات در خدمت شما خواهد بود ☕️`,
        {
          parse_mode: "HTML",
          reply_parameters: ctx.message?.message_id
            ? { message_id: ctx.message.message_id, allow_sending_without_reply: true }
            : undefined,
        }
      ).catch(() => {});
    }
    return;
  }


  // 1.1 بررسی مسدودسازی دائم (Ban)
  if (isUserBanned(userId)) {
    if (!isGroup) {
      await ctx.reply(
        "🚫 <b>دسترسی شما مسدود شده است:</b>\n\nشما به دستور مدیریت از استفاده از ربات به طور کامل مسدود شده‌اید.",
        { parse_mode: "HTML" }
      );
    }
    return;
  }

  // 1.2 بررسی میوت موقت (Mute)
  const muteStatus = isUserMuted(userId);
  if (muteStatus.isMuted) {
    const text = ctx.message?.text || "";
    const isBotCalled =
      !isGroup ||
      ctx.message?.reply_to_message?.from?.id === ctx.me?.id ||
      text.includes(`@${ctx.me?.username?.toLowerCase()}`) ||
      /^(?:(?:سلام|درود|هی|الو|چطوری)\s+)?(?:مزمز|mazmaz)/i.test(text.trim());

    if (isBotCalled) {
      await ctx.reply(
        `⏳ <b>دسترسی شما موقتاً مسدود است!</b>\n\n` +
          `به دلیل: <b>${muteStatus.reason}</b>\n` +
          `مهلت محرومیت تا: <code>${muteStatus.untilStr}</code>\n\n` +
          `تا پایان این مهلت، ربات به درخواست‌های شما پاسخی نخواهد داد. 🤫`,
        {
          parse_mode: "HTML",
          reply_parameters: ctx.message?.message_id
            ? { message_id: ctx.message.message_id, allow_sending_without_reply: true }
            : undefined,
        }
      );
    }
    return;
  }

  // 2. محافظت سفت و سخت از دستورات اسلش و تنظیمات ربات
  // دستورات فقط مختص رئیس مهدی هستند مگر اینکه خودش صراحتاً اجازه داده باشد
  const text = ctx.message?.text || "";
  if (text.startsWith("/")) {
    const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, "");
    // کامند استارت برای عضویت و دریافت خوشامدگویی در پی‌وی مجاز است
    if (cmd !== "/start") {
      if (!canUserUseCommands(userId)) {
        if (!isGroup) {
          await ctx.reply(
            "⛔ <b>عدم دسترسی به دستورات سیستمی:</b>\n\n" +
            "اجرای دستورات اسلش و تغییر تنظیمات ربات منحصراً متعلق به سازنده و مدیر اصلی (مهدی) است و برای سایر کاربران غیرفعال می‌باشد.",
            { parse_mode: "HTML" }
          );
        }
        return;
      }
    }
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
