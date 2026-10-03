import { Context, InlineKeyboard } from "grammy";
import { askGemini, checkProfanity, isPersian, testGeminiKey, isSensitiveExfiltrationAttempt } from "../services/ai";
import { isMediaUrl, downloadMedia, cleanupFile } from "../services/mediaDownloader";
import { isGeneralWebUrl, fetchAndAnalyzeLink } from "../services/linkReader";
import { queryBenchmark } from "../services/benchmarks";
import { getWeather, extractWeatherIntent } from "../services/weather";
import { getCryptoPrices } from "../services/crypto";
import { renderTasksMenu } from "./commands";
import { addTask, incrementStat } from "../db";
import { CONFIG, updateGeminiApiKey } from "../config";
import { sendSafeMessage } from "../utils/chunker";
import { markdownToTelegramHtml } from "../utils/formatter";

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

  // Check if admin is pasting a Google Gemini API key directly
  if ((text.startsWith("AIzaSy") || text.startsWith("AQ.")) && CONFIG.ADMIN_IDS.includes(userId)) {
    const key = text.trim();
    const waitMsg = await ctx.reply("🔑 <b>در حال اعتبارسنجی و اتصال به هوش مصنوعی Gemini... ⏳</b>", { parse_mode: "HTML" });
    const res = await testGeminiKey(key);
    if (res.ok) {
      updateGeminiApiKey(key);
      await ctx.api.editMessageText(ctx.chat!.id, waitMsg.message_id, `🎉 <b>تبریک رئیس!</b>\n${res.message}\n\nاز همین لحظه تمام تحلیل‌های متنی و تصویری با هوش مصنوعی گوگل انجام می‌شود! 🚀`, { parse_mode: "HTML" });
    } else {
      await ctx.api.editMessageText(ctx.chat!.id, waitMsg.message_id, `⚠️ <b>خطا در فعال‌سازی کلید:</b>\n${res.message}`, { parse_mode: "HTML" });
    }
    return;
  }

  // در گروه‌ها فقط در ۳ حالت پاسخ داده شود:
  // ۱. ریپلای مستقیم روی پیام ربات
  // ۲. منشن شدن دقیق نام کاربری ربات (@mazmazAgentBot)
  // ۳. پیام‌های دستوری (کامندهایی که با / شروع می‌شوند)
  if (isGroup) {
    const botInfo = ctx.me;
    const isReplyToBot = ctx.message?.reply_to_message?.from?.id === botInfo.id;
    const isBotMentioned = lower.includes(`@${botInfo.username.toLowerCase()}`);
    const isCommand = text.startsWith("/");

    if (!isReplyToBot && !isBotMentioned && !isCommand) {
      return;
    }
  }

  // Clean prompt by removing bot name mentions
  let cleanText = text
    .replace(new RegExp(`@${ctx.me.username}\\b`, "gi"), "")
    .replace(/مزمزم?|mazmaz/gi, "")
    .trim();
  const cleanLower = cleanText.toLowerCase();

  // 1. Check for Profanity (Anti-toxic funny roast + Report to Admin)
  const roast = checkProfanity(text);
  if (roast) {
    if (!CONFIG.ADMIN_IDS.includes(userId)) {
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

    await ctx.reply(roast);
    return;
  }


  // 2. Media Downloader (YouTube, Instagram, Pinterest, TikTok, Twitter Media)
  if (isMediaUrl(text)) {
    incrementStat("downloads_requested");
    const kb = new InlineKeyboard()
      .text("🎬 دانلود ویدیو (MP4)", `dl_v:${text}`)
      .text("🎵 استخراج موزیک (MP3)", `dl_a:${text}`)
      .row()
      .text("❌ انصراف", "dl_cancel");

    await ctx.reply(
      "📥 <b>لینک چندرسانه‌ای شناسایی شد!</b>\nنوع خروجی دلخواهتان را انتخاب کنید:",
      { reply_markup: kb, parse_mode: "HTML" }
    );
    return;
  }

  // 3. Web URL Reading & Analysis (Twitter, Reddit, News, Blogs)
  if (isGeneralWebUrl(text)) {
    incrementStat("links_analyzed");
    const statusMsg = await ctx.reply("🌐 <b>در حال دریافت محتوای صفحه و تحلیل عمیق با هوش مصنوعی... ⏳</b>", {
      parse_mode: "HTML",
    });
    const analysis = await fetchAndAnalyzeLink(userId, text);
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, analysis, {
      parse_mode: "HTML",
    });
    return;
  }

  // 4. Benchmarks Intent (CPU, GPU, Phones, AI Arena)
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
      parse_mode: "HTML",
    });
    const query = text.replace(/بنچمارک|benchmark/gi, "").trim() || "all";
    const result = await queryBenchmark(userId, query);
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, result, {
      parse_mode: "HTML",
    });
    return;
  }

  const isAdmin = CONFIG.ADMIN_IDS.includes(userId);

  // 5. Name calling or greeting: Just "مزمز", "سلام مزمز", "مزمز سلام", etc.
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
      await ctx.reply(adminGreetings[Math.floor(Math.random() * adminGreetings.length)]);
      return;
    }
    const list = isPersian(text) ? GREETINGS_FA : GREETINGS_EN;
    await ctx.reply(list[Math.floor(Math.random() * list.length)]);
    return;
  }

  // 5.1 لایه امنیتی ویژه کاربران عادی (جلوگیری از افشای سورس‌کد و حریم خصوصی)
  if (!isAdmin) {
    if (isSensitiveExfiltrationAttempt(cleanText || text)) {
      await ctx.reply("اطلاعات محرمانه، سورس‌کد و کدهای داخلی ربات فقط مختص رئیسم مهدیه و من به هیچ احدی جز مهدی دسترسی نمیدم! 🛡️😉");
      return;
    }

    if (/(?:من\s+مهدی\s*ام|من\s+مهدیم|من\s+رئیس\s*ام|من\s+رئیسم|من\s+سازندتم|من\s+سازنده\s*ام)/i.test(cleanText || text)) {
      await ctx.reply("دستت رو شد رفیق! 🕵️‍♂️ آیدی عددی تلگرام تو با رئیسم مهدی همخونی نداره. رئیس و سازنده واقعی من فقط مهدی (@mmahdiz44) با آیدی اختصاصی خودشه! فیلم بازی نکن 😉");
      return;
    }

    if (/(?:رئیست\s*کیه|سازندت\s*کیه|کی\s*تورو\s*ساخته|سازنده\s*شما\s*کیه|مالکت\s*کیه)/i.test(cleanText || text)) {
      await ctx.reply("سازنده، برنامه‌نویس و رئیس من «مهدی» (@mmahdiz44) است! من روی رانتایم فوق‌سریع Bun و TypeScript بالا اومدم و فقط و فقط از مهدی دستور می‌گیرم! 👑🚀");
      return;
    }
  }

  // 6. Weather Intent (هواشناسی هوشمند و دقیق بدون تفره رفتن)
  const weatherIntent = extractWeatherIntent(cleanText || text);
  if (weatherIntent.isWeather) {
    incrementStat("weather_checks");
    const waitMsg = await ctx.reply(`🌤️ <i>در حال دریافت وضعیت آب و هوای ${weatherIntent.city}... ⏳</i>`, {
      parse_mode: "HTML",
    });
    const res = await getWeather(weatherIntent.city);
    try {
      await ctx.api.editMessageText(ctx.chat!.id, waitMsg.message_id, res, { parse_mode: "HTML" });
    } catch {
      await ctx.reply(res, { parse_mode: "HTML" });
    }
    return;
  }

  // 7. Crypto / Dollar Intent
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
    const res = await getCryptoPrices();
    await ctx.reply(res, { parse_mode: "HTML" });
    return;
  }

  // 8. Add task via message: e.g. "یادم بنداز فلان کار" or "/add فلان"
  if (/^\/add(@\w+)?\s+/i.test(text) || text.startsWith("تسک جدید: ")) {
    const title = text.replace(/^(\/add(@\w+)?\s+|تسک جدید:\s+)/i, "").trim();
    if (title) {
      addTask(userId, title);
      await ctx.reply(`✅ تسک <b>«${title}»</b> به لیست کارهایت اضافه شد!`, {
        parse_mode: "HTML",
      });
      return;
    }
  }

  // 9. General AI Chat with Gemini & Tools
  incrementStat("ai_queries");
  const statusMsg = await ctx.reply("💭 <i>در حال تفکر و تدوین پاسخ هوشمند... ⏳</i>", {
    parse_mode: "HTML",
  });

  const promptToSend = cleanText || text;
  const rawResponse = await askGemini(userId, promptToSend);
  const formattedResponse = markdownToTelegramHtml(rawResponse);

  if (formattedResponse.length <= 4000) {
    try {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, formattedResponse, {
        parse_mode: "HTML",
      });
    } catch (e: any) {
      // Fallback without HTML formatting if tag mismatch
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, rawResponse).catch(() => {});
    }
  } else {
    // Message exceeds Telegram limit: clean up status message and stream chunks
    await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
    await sendSafeMessage(ctx, formattedResponse, { parse_mode: "HTML" });
  }
}


