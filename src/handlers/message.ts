import { Context, InlineKeyboard } from "grammy";
import { askGemini, checkProfanity, isPersian, testGeminiKey, isSensitiveExfiltrationAttempt } from "../services/ai";
import { isMediaUrl } from "../services/mediaDownloader";
import { isGeneralWebUrl, fetchAndAnalyzeLink } from "../services/linkReader";
import { queryBenchmark } from "../services/benchmarks";
import { getWeather, extractWeatherIntent } from "../services/weather";
import { getCryptoPrices } from "../services/crypto";
import { getDollarAndGoldReport } from "../services/currency";
import { addTask, incrementStat, checkAndConsumeQuota, formatQuotaFooter, getAllGroups, db } from "../db";
import { CONFIG, updateGeminiApiKey } from "../config";
import { sendSafeMessage, withTyping } from "../utils/chunker";
import { markdownToTelegramHtml, escapeHtml } from "../utils/formatter";
import { getSmartReaction } from "../utils/reactions";
import {
  isBugReport,
  isFeedbackOrCriticism,
  handleBugReport,
  handleFeedbackOrCriticism,
  handleProfanityAlert,
  ADMIN_REPLY_TARGET,
} from "../services/feedback";

const GREETINGS_FA = [
  "جانم رفیق! مزمز دربست در خدمتته 👂 بگو چی برات ردیف کنم؟",
  "به‌به سلام رئیس! مزمز روی رانتایم پرسرعت Bun آنلاینه ⚡ چه خبری؟",
  "جون دلم رفیق! گوشم کاملاً با توئه، بفرما 😎",
  "سلام و ارادت! بگو ببینم امروز چه کار خفنی رو با هم استارت بزنیم؟ 🚀",
];

const GREETINGS_EN = [
  "Hey there buddy! mazmaz is right here, powered by Bun ⚡ How can I help?",
  "At your service! What's on your mind today? 😎",
  "Always happy to hear from you! What do you need? ✨",
];

export async function handleTextMessage(ctx: Context) {
  const text = ctx.message?.text?.trim();
  if (!text) return;

  const userId = ctx.from!.id;
  const lower = text.toLowerCase();
  const chatType = ctx.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup";
  const isAdmin = CONFIG.ADMIN_IDS.includes(userId);

  const replyOpts = {
    reply_parameters: {
      message_id: ctx.message!.message_id,
      allow_sending_without_reply: true,
    },
  };

  // پاسخ مستقیم ادمین (مهدی) به گزارش یا پیام کاربر
  if (isAdmin && !isGroup && ADMIN_REPLY_TARGET.has(userId)) {
    const targetUserId = ADMIN_REPLY_TARGET.get(userId)!;
    ADMIN_REPLY_TARGET.delete(userId);
    try {
      await ctx.api.sendMessage(
        targetUserId,
        `📩 <b>پاسخ مدیریت (مهدی) به گزارش / پیام شما:</b>\n\n${text}`,
        { parse_mode: "HTML" }
      );
      await ctx.reply(`✅ پاسخ شما با موفقیت برای کاربر <code>${targetUserId}</code> ارسال شد!`, {
        ...replyOpts,
        parse_mode: "HTML",
      });
    } catch (e: any) {
      await ctx.reply(`❌ خطا در ارسال پاسخ به کاربر: ${e?.message || e}`, replyOpts);
    }
    return;
  }

  // Check if admin is pasting a Google Gemini API key directly
  if ((text.startsWith("AIzaSy") || text.startsWith("AQ.")) && isAdmin) {
    const key = text.trim();
    const res = await withTyping(ctx, () => testGeminiKey(key));
    if (res.ok) {
      updateGeminiApiKey(key);
      await ctx.reply(
        `🎉 <b>تبریک رئیس!</b>\n${res.message}\n\nاز همین لحظه تمام تحلیل‌های متنی و تصویری با هوش مصنوعی گوگل انجام می‌شود! 🚀`,
        { ...replyOpts, parse_mode: "HTML" }
      );
    } else {
      await ctx.reply(
        `⚠️ <b>خطا در فعال‌سازی کلید:</b>\n${res.message}`,
        { ...replyOpts, parse_mode: "HTML" }
      );
    }
    return;
  }

  // دسترسی مستقیم ادمین به لیست و مدیریت گروه‌ها با پیام متنی فارسی
  if (
    isAdmin &&
    !isGroup &&
    /^(?:مدیریت\s*گروه‌?ها?|لیست\s*گروه‌?ها?|گروه‌?های?\s*(?:من|ربات)|گروه‌?ها(?:\s*رو\s*(?:نشون\s*بده|ببینم))?)$/i.test(text.trim())
  ) {
    const groups = getAllGroups();
    let replyText = "👥 <b>لیست و نظارت بر گروه‌های مزمز:</b>\n\n";

    if (groups.length === 0) {
      replyText += (
        `<i>هنوز گروهی در دیتابیس ثبت نشده است.</i>\n\n` +
        `💡 <b>برای ثبت فوری گروه:</b>\n` +
        `۱️⃣ یک پیام از گروه را به پی‌وی من فوروارد کنید تا درجا شناسایی و فعال شود!\n` +
        `۲️⃣ با ارسال یک پیام در گروه یا صدا زدن <code>مزمز</code>، ربات آن را خودکار ثبت می‌کند.\n` +
        `۳️⃣ با دستور <code>/addgroup &lt;chat_id&gt;</code> گروه را بر اساس آیدی عددی ثبت کنید.`
      );
    } else {
      for (const g of groups.slice(0, 10)) {
        const statusIcon = g.status === "approved" ? "✅ تایید شده" : g.status === "pending" ? "⏳ در انتظار تایید" : "🚪 خارج شده";
        replyText += `• <b>${g.title}</b>\n  آیدی: <code>${g.chat_id}</code> | وضعیت: <b>${statusIcon}</b>\n`;
        if (g.added_by_name) {
          replyText += `  ثبت‌کننده: ${g.added_by_name} (${g.added_by_username ? `@${g.added_by_username}` : `<code>${g.added_by_id}</code>`})\n`;
        }
        replyText += "\n";
      }
    }

    const kb = new InlineKeyboard();
    for (const g of groups.slice(0, 8)) {
      const icon = g.status === "approved" ? "✅" : g.status === "pending" ? "⏳" : "🚪";
      kb.text(`${icon} ${g.title.slice(0, 20)}`, `grp_detail:${g.chat_id}`).row();
    }
    kb.text("🔄 به‌روزرسانی لیست", "admin_groups");
    kb.text("🔙 بازگشت به پنل ادمین", "menu_admin");

    await ctx.reply(replyText, { reply_markup: kb, parse_mode: "HTML" });
    return;
  }

  // در گروه‌های شلوغ، ربات فقط در موارد زیر پاسخ می‌دهد:
  // ۱. ریپلای مستقیم روی پیام خود ربات
  // ۲. منشن شدن رسمی با آیدی (@mazmazAgentBot)
  // ۳. خطاب مستقیم در ابتدای پیام (مثلاً: «مزمز این کد چیه؟» یا «سلام مزمز هوا چطوره؟»)
  // ۴. دستورات با اسلش (/)
  // ۵. دستورات و مکالمات ادمین (مهدی) به ویژه دستورات مدیریتی یا ریپلای به پیام‌ها
  // ⛔ اگر اسم مزمز وسط جمله کاربران عادی باشد، ربات کاملاً سکوت می‌کند.
  if (isGroup) {
    const botInfo = ctx.me;
    const isReplyToBot = ctx.message?.reply_to_message?.from?.id === botInfo.id;
    const isBotMentioned = lower.includes(`@${botInfo.username.toLowerCase()}`);
    const isDirectCallAtStart = /^(?:(?:سلام|درود|هی|الو|چطوری|ey|hi|hello)\s+)?(?:مزمز|mazmaz)(?:[،,:.!؟?\s]|$)/i.test(text.trim());
    const isCommand = text.startsWith("/");

    // اجازه فوری به دستورات ادمین (مهدی) در صورت ریپلای به پیام یا عبارات مدیریتی و نظارتی
    const isAdminGroupAction = isAdmin && (
      Boolean(ctx.message?.reply_to_message) ||
      /(?:خلاصه|بن|اخراج|میوت|سکوت|آنبن|آنمیوت|آن‌میوت|حذف|پاکسازی|سهمیه|تسک|استعلام)/i.test(text)
    );

    if (!isReplyToBot && !isBotMentioned && !isDirectCallAtStart && !isCommand && !isAdminGroupAction) {
      return;
    }
  }

  // ارسال فوری اکشن تایپینگ بالای چت تلگرام
  ctx.replyWithChatAction("typing").catch(() => {});

  // تمیز کردن پرامپت با حذف خطاب مستقیم و نام ربات
  let cleanText = text
    .replace(new RegExp(`@${ctx.me.username}\\b`, "gi"), "")
    .replace(/^(?:(?:سلام|درود|هی|الو|چطوری|ey|hi|hello)\s+)?(?:مزمز|mazmaz)[،,:.!؟?\s]*/i, "")
    .replace(/مزمزم?|mazmaz/gi, "")
    .replace(/^[\s،,:!؟?]+|[\s،,:!؟?]+$/g, "")
    .trim();
  const cleanLower = cleanText.toLowerCase();

  // اگر کاربر فقط اسم ربات را صدا زده بود (مثلاً «مزمز» یا «سلام مزمز»)
  if (!cleanText || cleanLower === "سلام" || cleanLower === "درود") {
    const greetings = [
      "جانم داداش؟ گوشم کاملاً با توئه، بگو ببینم چی می‌خوای! 👂😎",
      "جون دلم رفیق! مزمز اینجاست، امر بفرما 🚀",
      "سلام و ارادت! بگو ببینم چه کار فنی یا سوالی داری تا با هم ردیفش کنیم؟ ⚡",
    ];
    const picked = greetings[Math.floor(Math.random() * greetings.length)];
    await ctx.reply(picked, replyOpts);
    return;
  }

  const replyMsg = ctx.message?.reply_to_message;
  const replyUser = replyMsg?.from;

  // دستورات مستقیم و پرسرعت مدیریتی ادمین (مهدی) در گروه روی پیام‌های ریپلای‌شده
  if (isAdmin && isGroup && replyUser) {
    // ۱. دستور بن / اخراج دائم از گروه
    const isBanIntent = /^(?:(?:مزمز|mazmaz)[،,:\s]+)?(?:\/ban|بن\s*کن|بنش\s*کن|اخراج\s*کن|اخراجش\s*کن|بن|اخراج)$/i.test(cleanText || text);
    if (isBanIntent) {
      if (replyUser.id === ctx.me.id) {
        await ctx.reply("😅 داداش من ربات خودتم، منو بن نکن!", replyOpts);
        return;
      }
      if (CONFIG.ADMIN_IDS.includes(replyUser.id)) {
        await ctx.reply("👑 رئیس، نمی‌تونید خودتون یا سایر ادمین‌ها رو بن کنید!", replyOpts);
        return;
      }
      try {
        await ctx.api.banChatMember(ctx.chat!.id, replyUser.id);
        const nameEsc = escapeHtml(replyUser.first_name || "کاربر");
        await ctx.reply(
          `🔨 <b>کاربر <a href="tg://user?id=${replyUser.id}">${nameEsc}</a> (<code>${replyUser.id}</code>) با موفقیت از گروه اخراج و بن دائم شد.</b>`,
          { ...replyOpts, parse_mode: "HTML" }
        );
      } catch (err: any) {
        await ctx.reply(`❌ خطا در اخراج کاربر: ${err?.description || err?.message || err}`, replyOpts);
      }
      return;
    }

    // ۲. دستور میوت / سکوت
    const isMuteIntent = /^(?:(?:مزمز|mazmaz)[،,:\s]+)?(?:\/mute|میوت\s*کن|میوتش\s*کن|سکوت|بی‌?صدا)(?:\s+(.+))?$/i.test(cleanText || text);
    if (isMuteIntent) {
      if (replyUser.id === ctx.me.id || CONFIG.ADMIN_IDS.includes(replyUser.id)) {
        await ctx.reply("👑 اعمال محدودیت روی ربات یا ادمین‌ها مجاز نیست.", replyOpts);
        return;
      }
      const match = (cleanText || text).match(/^(?:(?:مزمز|mazmaz)[،,:\s]+)?(?:\/mute|میوت\s*کن|میوتش\s*کن|سکوت|بی‌?صدا)(?:\s+(.+))?$/i);
      const durationArg = match?.[1]?.trim() || "";
      let durationSeconds = 3600;
      let durationLabel = "۱ ساعت";

      if (/(\d+)\s*(?:روز|day|d)/i.test(durationArg)) {
        const d = parseInt(durationArg.match(/(\d+)/)![1], 10);
        durationSeconds = d * 86400;
        durationLabel = `${d} روز`;
      } else if (/(\d+)\s*(?:ساعت|hour|h)/i.test(durationArg)) {
        const h = parseInt(durationArg.match(/(\d+)/)![1], 10);
        durationSeconds = h * 3600;
        durationLabel = `${h} ساعت`;
      } else if (/(\d+)\s*(?:دقیقه|min|m)/i.test(durationArg)) {
        const m = parseInt(durationArg.match(/(\d+)/)![1], 10);
        durationSeconds = m * 60;
        durationLabel = `${m} دقیقه`;
      }

      const untilDate = Math.floor(Date.now() / 1000) + durationSeconds;
      try {
        await ctx.api.restrictChatMember(ctx.chat!.id, replyUser.id, {
          can_send_messages: false,
          can_send_photos: false,
          can_send_videos: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
        }, {
          until_date: untilDate,
        });
        const nameEsc = escapeHtml(replyUser.first_name || "کاربر");
        await ctx.reply(
          `🔇 <b>کاربر <a href="tg://user?id=${replyUser.id}">${nameEsc}</a> (<code>${replyUser.id}</code>) به مدت ${durationLabel} بی‌صدا (Mute) شد.</b>`,
          { ...replyOpts, parse_mode: "HTML" }
        );
      } catch (err: any) {
        await ctx.reply(`❌ خطا در میوت کردن کاربر: ${err?.description || err?.message || err}`, replyOpts);
      }
      return;
    }

    // ۳. دستور آن‌میوت / رفع سکوت
    const isUnmuteIntent = /^(?:(?:مزمز|mazmaz)[،,:\s]+)?(?:\/unmute|آن‌?میوت\s*کن|آن‌?میوتش\s*کن|رفع\s*سکوت|حذف\s*میوت|آن‌?میوت)$/i.test(cleanText || text);
    if (isUnmuteIntent) {
      try {
        await ctx.api.restrictChatMember(ctx.chat!.id, replyUser.id, {
          can_send_messages: true,
          can_send_photos: true,
          can_send_videos: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
        });
        const nameEsc = escapeHtml(replyUser.first_name || "کاربر");
        await ctx.reply(
          `🔊 <b>محدودیت چت کاربر <a href="tg://user?id=${replyUser.id}">${nameEsc}</a> برداشته شد و می‌تواند پیام بفرستد.</b>`,
          { ...replyOpts, parse_mode: "HTML" }
        );
      } catch (err: any) {
        await ctx.reply(`❌ خطا در رفع میوت کاربر: ${err?.description || err?.message || err}`, replyOpts);
      }
      return;
    }
  }

  // خلاصه پیام‌های اخیر گروه
  const isSummaryIntent = /^(?:(?:سلام|درود|هی|الو|چطوری)\s+)?(?:(?:مزمز|mazmaz)[،,:\s]+)?(?:خلاصه(?:\s*ی)?\s*(?:پیام‌?ها?|چت|گروه)|پیام‌?ها?ی?\s*گروه\s*رو\s*خلاصه\s*کن|چت\s*رو\s*خلاصه\s*کن|خلاصه\s*بده|خلاصه\s*کن)(?:\s.*)?$/i.test(text.trim());
  if (isSummaryIntent && isGroup && ctx.chat) {
    const rows = db.query(`
      SELECT user_id, text FROM messages 
      WHERE chat_id = ? AND text != '' 
      ORDER BY id DESC LIMIT 50
    `).all(ctx.chat.id) as { user_id: number; text: string }[];

    if (rows.length === 0) {
      await ctx.reply(
        `📝 <b>خلاصه‌سازی گفتگوی گروه:</b>\n\n` +
        `⚠️ هنوز پیامی از سایر اعضا در حافظه ثبت نشده است.\n\n` +
        `💡 <b>راهنمای فعال‌سازی خواندن پیام‌ها:</b>\n` +
        `تلگرام به صورت پیش‌فرض دسترسی ربات‌ها به پیام‌های عادی گروه را فیلتر می‌کند. برای اینکه ربات تمام پیام‌های گروه را برای خلاصه‌سازی بخواند:\n` +
        `۱️⃣ در @BotFather دستور <code>/setprivacy</code> را ارسال کرده، ربات را انتخاب و گزینه <b>Disable</b> را بزنید.\n` +
        `۲️⃣ اطمینان حاصل کنید ربات دسترسی ادمین برای دیدن پیام‌ها را دارد.`,
        { ...replyOpts, parse_mode: "HTML" }
      );
      return;
    }

    const historyFormatted = rows.reverse().map((r, i) => `${i + 1}. [کاربر ${r.user_id}]: ${r.text}`).join("\n");
    const summaryPrompt = `این ۵۰ پیام اخیر ارسالی در گروه است:\n\n${historyFormatted}\n\nلطفاً یک خلاصه جذاب، فوق‌العاده مرتب، دسته‌بندی‌شده و خوانا از موضوعات مطرح‌شده، سوالات و تصمیمات به زبان فارسی ارائه بده.`;

    const statusMsg = await ctx.reply("📋 <i>در حال مطالعه و خلاصه‌سازی پیام‌های اخیر گروه... ⏳</i>", {
      ...replyOpts,
      parse_mode: "HTML",
    });

    const rawSummary = await withTyping(ctx, () => askGemini(userId, summaryPrompt, undefined, ctx));
    const formattedSummary = markdownToTelegramHtml(rawSummary);

    try {
      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `📑 <b>خلاصه پیام‌های اخیر گروه:</b>\n\n${formattedSummary}`, {
        parse_mode: "HTML",
      });
    } catch {
      await ctx.reply(`📑 <b>خلاصه پیام‌های اخیر گروه:</b>\n\n${formattedSummary}`, { ...replyOpts, parse_mode: "HTML" });
    }
    return;
  }

  // 1. ری‌اکشن هوشمند به پیام‌های تشکر، خنده، تأیید و خداحافظی جهت کاهش ۱۰۰ درصدی مصرف توکن
  const smartReaction = getSmartReaction(text);
  if (smartReaction) {
    try {
      await ctx.react(smartReaction);
      return;
    } catch (e) {
      // اگر در گروه ری‌اکشن غیرفعال بود، ربات وارد روال عادی پیام‌ها می‌شود
    }
  }

  // 2. بررسی الفاظ نامناسب (پاسخ کوبنده طنز + ارسال دکمه‌های میوت ۶ ساعته/۲۴ ساعته به رئیس مهدی)
  const roast = checkProfanity(text);
  if (roast) {
    if (!isAdmin) {
      await handleProfanityAlert(ctx, text, roast);
      return;
    }
    await ctx.reply(roast, replyOpts);
    return;
  }

  // 2.1 بررسی گزارش باگ توسط کاربران (ارسال به پی‌وی مهدی + منشن در گروه)
  if (!isAdmin && isBugReport(cleanText || text)) {
    await handleBugReport(ctx, cleanText || text);
    return;
  }

  // 2.2 بررسی پیشنهاد و انتقادات کاربران (ارسال مستقیم به مهدی با تاریخ و ساعت دقیق)
  if (!isAdmin && isFeedbackOrCriticism(cleanText || text)) {
    await handleFeedbackOrCriticism(ctx, cleanText || text);
    return;
  }

  // 3. دانلودر مدیا (YouTube, Instagram, Pinterest, TikTok, Twitter Media)
  if (isMediaUrl(text)) {
    incrementStat("downloads_requested");
    const kb = new InlineKeyboard()
      .text("🎬 دانلود ویدیو (MP4)", `dl_v:${text}`)
      .text("🎵 استخراج موزیک (MP3)", `dl_a:${text}`)
      .row()
      .text("❌ انصراف", "dl_cancel");

    await ctx.reply(
      "📥 <b>لینک چندرسانه‌ای شناسایی شد!</b>\nنوع خروجی دلخواهتان را انتخاب کنید:",
      { ...replyOpts, reply_markup: kb, parse_mode: "HTML" }
    );
    return;
  }

  // 4. احوال‌پرسی‌های روزمره (صبح بخیر، شب بخیر، ...)
  const isGreetingOnly =
    !cleanText ||
    ["سلام", "درود", "صبح بخیر", "عصر بخیر", "شب بخیر", "hi", "hello", "hey"].includes(cleanLower);

  if (isGreetingOnly) {
    if (isAdmin) {
      const adminGreetings = [
        "به‌به سلام رئیس مهدی عزیز! مزمز دربست در خدمتته 👑 بگو چی برات ردیف کنم؟",
        "سلام و ارادت خدمت رئیس و سازنده گلم مهدی جان! مزمز سرحال روی رانتایم Bun آنلاینه ⚡ امر بفرمایید!",
        "جانم رئیس مهدی! گوشم کاملاً با توئه، بگو چه کار خفنی رو استارت بزنیم؟ 🚀",
        "مخلصم مهدی جان! رفیق پایه و کدت اینجاست، چی تو برنامه‌ست؟ 😎",
      ];
      await ctx.reply(adminGreetings[Math.floor(Math.random() * adminGreetings.length)], replyOpts);
      return;
    }
    const list = isPersian(text) ? GREETINGS_FA : GREETINGS_EN;
    await ctx.reply(list[Math.floor(Math.random() * list.length)], replyOpts);
    return;
  }

  // 5. لایه امنیتی ویژه کاربران عادی (جلوگیری از افشای سورس‌کد و حریم خصوصی)
  if (!isAdmin) {
    if (isSensitiveExfiltrationAttempt(cleanText || text)) {
      await ctx.reply(
        "اطلاعات محرمانه، سورس‌کد و کدهای داخلی ربات فقط مختص رئیسم مهدیه و من به هیچ احدی جز مهدی دسترسی نمیدم! 🛡️😉",
        replyOpts
      );
      return;
    }

    if (/(?:من\s+مهدی\s*ام|من\s+مهدیم|من\s+رئیس\s*ام|من\s+رئیسم|من\s+سازندتم|من\s+سازنده\s*ام)/i.test(cleanText || text)) {
      await ctx.reply(
        "دستت رو شد رفیق! 🕵️‍♂️ آیدی عددی تلگرام تو با رئیسم مهدی همخونی نداره. رئیس و سازنده واقعی من فقط مهدی (@mmahdiz44) با آیدی اختصاصی خودشه! فیلم بازی نکن 😉",
        replyOpts
      );
      return;
    }

    if (/(?:رئیست\s*کیه|سازندت\s*کیه|کی\s*تورو\s*ساخته|سازنده\s*شما\s*کیه|مالکت\s*کیه)/i.test(cleanText || text)) {
      await ctx.reply(
        "سازنده، برنامه‌نویس و رئیس من «مهدی» (@mmahdiz44) است! من روی رانتایم فوق‌سریع Bun و TypeScript بالا اومدم و فقط و فقط از مهدی دستور می‌گیرم! 👑🚀",
        replyOpts
      );
      return;
    }
  }

  // 6. اضافه کردن تسک به لیست کارها (مثلاً «تسک جدید: خرید نان» یا «/add مطالعه»)
  if (/^\/add(@\w+)?\s+/i.test(text) || text.startsWith("تسک جدید: ")) {
    const title = text.replace(/^(\/add(@\w+)?\s+|تسک جدید:\s+)/i, "").trim();
    if (title) {
      addTask(userId, title);
      await ctx.reply(`✅ تسک <b>«${title}»</b> به لیست کارهایت اضافه شد!`, {
        ...replyOpts,
        parse_mode: "HTML",
      });
      return;
    }
  }

  // 7. اعمال سهمیه روزانه برای کاربران در گروه‌ها
  if (isGroup && !isAdmin) {
    const quota = checkAndConsumeQuota(userId, true);
    if (!quota.allowed) {
      await ctx.reply(
        "⚠️ <b>سهمیه پیام امروز شما به پایان رسیده است!</b>\n\n" +
        "شما از سهمیه ۲۴ درخواست روزانه خود استفاده کرده‌اید.\n" +
        "سهمیه شما بامداد فردا مجدداً شارژ خواهد شد. 🌙",
        {
          ...replyOpts,
          parse_mode: "HTML",
        }
      );
      return;
    }
  }

  // 8. خواندن و تحلیل لینک‌های اینترنتی
  if (isGeneralWebUrl(text)) {
    incrementStat("links_analyzed");
    const statusMsg = await ctx.reply("🌐 <b>در حال دریافت محتوای صفحه و تحلیل عمیق با هوش مصنوعی... ⏳</b>", {
      ...replyOpts,
      parse_mode: "HTML",
    });
    const analysis = await withTyping(ctx, () => fetchAndAnalyzeLink(userId, text));
    const finalMsg = `${analysis}${formatQuotaFooter(userId)}`;
    if (finalMsg.length <= 4000) {
      try {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalMsg, { parse_mode: "HTML" });
      } catch {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalMsg).catch(() => {});
      }
    } else {
      await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
      await sendSafeMessage(ctx, finalMsg, { ...replyOpts, parse_mode: "HTML" });
    }
    return;
  }

  // 9. استعلام بنچمارک‌های سخت‌افزار و هوش مصنوعی
  if (
    lower.includes("بنچمارک") ||
    lower.includes("benchmark") ||
    lower.includes("آرنا") ||
    lower.includes("arena") ||
    lower.includes("lmsys") ||
    lower.includes("geekbench") ||
    lower.includes("antutu")
  ) {
    incrementStat("benchmarks_queried");
    const statusMsg = await ctx.reply("⚡ <b>در حال استعلام جدیدترین داده‌های بنچمارک... ⏳</b>", {
      ...replyOpts,
      parse_mode: "HTML",
    });
    const query = text.replace(/بنچمارک|benchmark/gi, "").trim() || "all";
    const result = await withTyping(ctx, () => queryBenchmark(userId, query));
    const finalMsg = `${result}${formatQuotaFooter(userId)}`;
    if (finalMsg.length <= 4000) {
      try {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalMsg, { parse_mode: "HTML" });
      } catch {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalMsg).catch(() => {});
      }
    } else {
      await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
      await sendSafeMessage(ctx, finalMsg, { ...replyOpts, parse_mode: "HTML" });
    }
    return;
  }

  // 10. آب و هواشناسی هوشمند
  const weatherIntent = extractWeatherIntent(cleanText || text);
  if (weatherIntent.isWeather) {
    incrementStat("weather_checks");
    const statusMsg = await ctx.reply(`🌤️ <i>در حال دریافت وضعیت آب و هوای ${weatherIntent.city}... ⏳</i>`, {
      ...replyOpts,
      parse_mode: "HTML",
    });
    const res = await withTyping(ctx, () => getWeather(weatherIntent.city));
    const finalMsg = `${res}${formatQuotaFooter(userId)}`;
    try {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalMsg, { parse_mode: "HTML" });
    } catch {
      await ctx.reply(finalMsg, { ...replyOpts, parse_mode: "HTML" });
    }
    return;
  }

  // 11. نرخ دلار بازار آزاد، طلا، سکه و ارزها (با تاریخ، ساعت دقیق و نمودار نوسان)
  const isDollarIntent =
    lower.includes("دلار") ||
    lower.includes("قیمت دلار") ||
    lower.includes("نرخ دلار") ||
    lower.includes("قیمت طلا") ||
    lower.includes("قیمت سکه") ||
    lower.includes("ارز") ||
    lower.includes("قیمت ارز") ||
    lower.includes("یورو") ||
    lower.includes("درهم");

  if (isDollarIntent) {
    incrementStat("crypto_checks");
    const statusMsg = await ctx.reply("💵 <i>در حال استعلام لحظه‌ای قیمت دلار، طلا و نرخ آزاد بازار... ⏳</i>", {
      ...replyOpts,
      parse_mode: "HTML",
    });

    const report = await withTyping(ctx, () => getDollarAndGoldReport());
    const quotaFooter = formatQuotaFooter(userId);
    const finalMsg = `${report.text}${quotaFooter}`;

    const dollarKb = new InlineKeyboard()
      .text("📈 نمودار گرافیکی پیشرفته", "dlr_chart")
      .text("🔄 به‌روزرسانی", "dlr_refresh");

    // اگر کاربر صراحتاً نمودار یا چارت خواسته بود
    if ((lower.includes("نمودار") || lower.includes("چارت")) && report.chartUrl) {
      await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
      try {
        await ctx.replyWithPhoto(report.chartUrl, {
          caption: finalMsg.slice(0, 1000),
          reply_markup: dollarKb,
          parse_mode: "HTML",
          reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
        });
        return;
      } catch {
        // Fallback to text if photo delivery fails
      }
    }

    try {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalMsg, {
        reply_markup: dollarKb,
        parse_mode: "HTML",
      });
    } catch {
      await ctx.reply(finalMsg, { ...replyOpts, reply_markup: dollarKb, parse_mode: "HTML" });
    }
    return;
  }

  // 11.1 نرخ ارز دیجیتال و کریپتو (بیت‌کوین، اتریوم، تتر و ...)
  if (
    lower.includes("کریپتو") ||
    lower.includes("بیت کوین") ||
    lower.includes("بیت‌کوین") ||
    lower.includes("تتر") ||
    lower.includes("اتریوم") ||
    lower.includes("سولانا") ||
    lower.includes("تون کوین") ||
    lower.includes("crypto") ||
    lower.includes("bitcoin")
  ) {
    incrementStat("crypto_checks");
    const statusMsg = await ctx.reply("📊 <i>در حال استعلام نرخ لحظه‌ای بازار ارز دیجیتال... ⏳</i>", {
      ...replyOpts,
      parse_mode: "HTML",
    });
    const res = await withTyping(ctx, () => getCryptoPrices());
    const finalMsg = `${res}${formatQuotaFooter(userId)}`;
    try {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalMsg, { parse_mode: "HTML" });
    } catch {
      await ctx.reply(finalMsg, { ...replyOpts, parse_mode: "HTML" });
    }
    return;
  }

  // 12. چت عمومی هوش مصنوعی با Gemini و سیستم پیش‌نمایش و تایپینگ زنده
  incrementStat("ai_queries");
  const statusMsg = await ctx.reply("💭 <i>در حال تفکر و تدوین پاسخ هوشمند... ⏳</i>", {
    ...replyOpts,
    parse_mode: "HTML",
  });

  let replyContext = "";
  if (replyMsg && replyUser) {
    const sender = `${replyUser.first_name || ""} ${replyUser.last_name || ""}`.trim() || "نامشخص";
    replyContext += `\n[کانتکست پیام ریپلای‌شده: فرستنده="${sender}" | شناسه عددی (user_id)=${replyUser.id} | متن="${replyMsg.text || replyMsg.caption || "[رسانه/عکس]"}" | شناسه پیام=${replyMsg.message_id}]`;
  }
  if (isGroup && ctx.chat) {
    replyContext += `\n[کانتکست گروه: عنوان="${ctx.chat.title || "گروه"}" | شناسه عددی چت (chat_id)=${ctx.chat.id}]`;
  }

  const promptToSend = (cleanText || text) + replyContext;
  const rawResponse = await withTyping(ctx, () => askGemini(userId, promptToSend, undefined, ctx));
  const formattedResponse = markdownToTelegramHtml(rawResponse);
  const finalResponse = `${formattedResponse}${formatQuotaFooter(userId)}`;

  if (finalResponse.length <= 4000) {
    try {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalResponse, {
        parse_mode: "HTML",
      });
    } catch (e: any) {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `${rawResponse}${formatQuotaFooter(userId)}`).catch(() => {});
    }
  } else {
    await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
    await sendSafeMessage(ctx, finalResponse, {
      ...replyOpts,
      parse_mode: "HTML",
    });
  }
}
