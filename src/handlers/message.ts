import { Context, InlineKeyboard } from "grammy";
import { askGemini, checkProfanity, isPersian, testGeminiKey, isSensitiveExfiltrationAttempt } from "../services/ai";
import { isMediaUrl } from "../services/mediaDownloader";
import { isGeneralWebUrl, fetchAndAnalyzeLink } from "../services/linkReader";
import { queryBenchmark } from "../services/benchmarks";
import { getWeather, extractWeatherIntent } from "../services/weather";
import { getCryptoPrices } from "../services/crypto";
import { addTask, incrementStat, checkAndConsumeQuota, formatQuotaFooter } from "../db";
import { CONFIG, updateGeminiApiKey } from "../config";
import { sendSafeMessage, withTyping } from "../utils/chunker";
import { markdownToTelegramHtml } from "../utils/formatter";
import { getSmartReaction } from "../utils/reactions";

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

  // در گروه‌های شلوغ، ربات فقط در موارد زیر پاسخ می‌دهد:
  // ۱. ریپلای مستقیم روی پیام خود ربات
  // ۲. منشن شدن رسمی با آیدی (@mazmazAgentBot)
  // ۳. خطاب مستقیم در ابتدای پیام (مثلاً: «مزمز این کد چیه؟» یا «سلام مزمز هوا چطوره؟»)
  // ۴. دستورات با اسلش (/)
  // ⛔ اگر اسم مزمز وسط جمله باشد (مثل «نظرتون راجع به مزمز چیه؟» یا «چیپس مزمز»)، ربات کاملاً سکوت می‌کند.
  if (isGroup) {
    const botInfo = ctx.me;
    const isReplyToBot = ctx.message?.reply_to_message?.from?.id === botInfo.id;
    const isBotMentioned = lower.includes(`@${botInfo.username.toLowerCase()}`);
    const isDirectCallAtStart = /^(?:(?:سلام|درود|هی|الو|چطوری|ey|hi|hello)\s+)?(?:مزمز|mazmaz)(?:[،,:.!؟?\s]|$)/i.test(text.trim());
    const isCommand = text.startsWith("/");

    if (!isReplyToBot && !isBotMentioned && !isDirectCallAtStart && !isCommand) {
      return;
    }
  }

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

  // 2. بررسی الفاظ نامناسب (پاسخ کوبنده طنز + ارسال گزارش به رئیس)
  const roast = checkProfanity(text);
  if (roast) {
    if (!isAdmin) {
      const senderName = ctx.from?.first_name ? `${ctx.from.first_name} ${ctx.from.last_name || ""}`.trim() : "کاربر";
      const senderUser = ctx.from?.username ? `@${ctx.from.username}` : "بدون یوزرنیم";
      const where = isGroup ? `گروه «${ctx.chat?.title || "گروه"}»` : "پی‌وی ربات";

      const reportText = (
        `⚠️ <b>گزارش استفاده از کلمات نامناسب / توهین:</b>\n\n` +
        `👤 فرستنده: <b>${senderName}</b> (${senderUser})\n` +
        `🔢 آیدی عددی: <code>${userId}</code>\n` +
        `📍 مکان: <b>${where}</b>\n` +
        `💬 متن پیام: <code>${text.slice(0, 200)}</code>\n\n` +
        `💡 <i>جهت اطلاع شما رئیس مهدی. اگر نیاز به محدودسازی هست اقدام کنید.</i>`
      );

      const alertKb = new InlineKeyboard()
        .text("🚫 لغو دسترسی کاربر", `rejc:${userId}`)
        .text("👁️ نادیده گرفتن", "ignore_alert");

      for (const adminId of CONFIG.ADMIN_IDS) {
        ctx.api.sendMessage(adminId, reportText, { reply_markup: alertKb, parse_mode: "HTML" }).catch(() => {});
      }
    }

    await ctx.reply(roast, replyOpts);
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
    const analysis = await withTyping(ctx, () => fetchAndAnalyzeLink(userId, text));
    const finalMsg = `${analysis}${formatQuotaFooter(userId)}`;
    await sendSafeMessage(ctx, finalMsg, {
      ...replyOpts,
      parse_mode: "HTML",
    });
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
    const query = text.replace(/بنچمارک|benchmark/gi, "").trim() || "all";
    const result = await withTyping(ctx, () => queryBenchmark(userId, query));
    const finalMsg = `${result}${formatQuotaFooter(userId)}`;
    await sendSafeMessage(ctx, finalMsg, {
      ...replyOpts,
      parse_mode: "HTML",
    });
    return;
  }

  // 10. آب و هواشناسی هوشمند
  const weatherIntent = extractWeatherIntent(cleanText || text);
  if (weatherIntent.isWeather) {
    incrementStat("weather_checks");
    const res = await withTyping(ctx, () => getWeather(weatherIntent.city));
    const finalMsg = `${res}${formatQuotaFooter(userId)}`;
    await sendSafeMessage(ctx, finalMsg, {
      ...replyOpts,
      parse_mode: "HTML",
    });
    return;
  }

  // 11. نرخ ارز و کریپتو
  if (
    lower.includes("دلار") ||
    lower.includes("قیمت دلار") ||
    lower.includes("کریپتو") ||
    lower.includes("بیت کوین") ||
    lower.includes("بیت‌کوین") ||
    lower.includes("تتر") ||
    lower.includes("crypto") ||
    lower.includes("bitcoin")
  ) {
    incrementStat("crypto_checks");
    const res = await withTyping(ctx, () => getCryptoPrices());
    const finalMsg = `${res}${formatQuotaFooter(userId)}`;
    await sendSafeMessage(ctx, finalMsg, {
      ...replyOpts,
      parse_mode: "HTML",
    });
    return;
  }

  // 12. چت عمومی هوش مصنوعی با Gemini و سیستم تایپینگ زنده
  incrementStat("ai_queries");
  const promptToSend = cleanText || text;
  const rawResponse = await withTyping(ctx, () => askGemini(userId, promptToSend));
  const formattedResponse = markdownToTelegramHtml(rawResponse);
  const finalResponse = `${formattedResponse}${formatQuotaFooter(userId)}`;

  await sendSafeMessage(ctx, finalResponse, {
    ...replyOpts,
    parse_mode: "HTML",
  });
}
