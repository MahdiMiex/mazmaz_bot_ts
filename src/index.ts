import { Bot, InlineKeyboard, InputFile } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { CONFIG, updateGeminiApiKey } from "./config";
import { accessControlMiddleware } from "./handlers/access";
import {
  handleStart,
  handleHelp,
  renderTasksMenu,
  getMainMenu,
} from "./handlers/commands";
import { handlePhotoMessage } from "./handlers/photo";
import { handleTextMessage } from "./handlers/message";
import {
  getUserCount,
  getAllUsers,
  getAllUserIds,
  approveUser,
  rejectUser,
  getUserById,
  toggleTask,
  deleteTask,
  getStats,
  setCommandAccess,
  formatQuotaFooter,
} from "./db";
import { sendSafeMessage, withTyping } from "./utils/chunker";
import { downloadMedia, cleanupFile } from "./services/mediaDownloader";
import { getWeather } from "./services/weather";
import { getCryptoPrices } from "./services/crypto";
import { LMSYS_ARENA_SUMMARY, TOP_HARDWARE_BENCHMARKS } from "./services/benchmarks";
import { testGeminiKey, clearUserHistory } from "./services/ai";

console.log("🚀 Initializing mazmaz Telegram Bot with Bun & grammY...");

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

export const bot = new Bot(CONFIG.BOT_TOKEN, {
  client: {
    baseFetchConfig: {
      // @ts-ignore
      agent,
    },
  },
});

// 1. Register Global Access Control & Quota Middleware
bot.use(accessControlMiddleware);

// Global Error Handler to prevent bot crash on Telegram network errors or expired queries
bot.catch((err) => {
  const ctx = err.ctx;
  console.warn(`[GLOBAL SAFEGUARD] Handled error in update ${ctx.update?.update_id}:`, (err.error as any)?.message || err.error);
});

// 2. Register Commands
// هندل کردن کامند stop (با پشتیبانی از اسم کاربری ربات در گروه)
bot.command(["stop", "stop@mazmazAgentBot"], async (ctx) => {
  if (ctx.from) {
    clearUserHistory(ctx.from.id);
  }
  await ctx.reply("باشه بابا، قطع کردم! هر وقت خواستی برگرد.", {
    reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
  });
});

// هندل کردن کامند start
bot.command(["start", "start@mazmazAgentBot"], async (ctx) => {
  await handleStart(ctx);
});

// هندل کردن کامند history و clear
bot.command(
  ["history", "history@mazmazAgentBot", "clear", "clear@mazmazAgentBot"],
  async (ctx) => {
    if (ctx.from) {
      clearUserHistory(ctx.from.id);
    }
    await ctx.reply(
      "🧹 <b>حافظه مکالمه با موفقیت پاک شد!</b>\nاکنون می‌توانید گفتگوی جدیدی را بدون پیش‌زمینه قبلی آغاز کنید.",
      {
        parse_mode: "HTML",
        reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
      }
    );
  }
);

bot.command(["help", "help@mazmazAgentBot"], handleHelp);
bot.command(["tasks", "tasks@mazmazAgentBot"], (ctx) => renderTasksMenu(ctx, ctx.from!.id));
bot.command(["weather", "weather@mazmazAgentBot", "hava"], async (ctx) => {
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const city = parts.slice(1).join(" ").trim() || "تهران";
  const res = await withTyping(ctx, () => getWeather(city));
  const finalMsg = `${res}${formatQuotaFooter(ctx.from!.id)}`;
  await sendSafeMessage(ctx, finalMsg, {
    parse_mode: "HTML",
    reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
  });
});

bot.command(["setkey", "setkey@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    return ctx.reply("⛔ فقط ادمین ربات مجاز به تنظیم کلید هوش مصنوعی است.");
  }

  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  if (parts.length < 2) {
    return ctx.reply(
      "💡 <b>راهنمای تنظیم کلید هوش مصنوعی:</b>\n\n" +
        "کافیه دستور رو به این شکل بفرستی:\n" +
        "<code>/setkey YOUR_GEMINI_API_KEY</code>\n\n" +
        "یا حتی خیلی راحت فقط کلیدت رو توی چت پیست کن تا خودکار شناسایی و فعال بشه! 🚀",
      { parse_mode: "HTML" }
    );
  }

  const key = parts[1].trim();
  const waitMsg = await ctx.reply("🔑 <b>در حال اعتبارسنجی و تست کلید با Gemini... ⏳</b>", {
    parse_mode: "HTML",
  });

  const res = await testGeminiKey(key);
  if (res.ok) {
    updateGeminiApiKey(key);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      waitMsg.message_id,
      `🎉 <b>تبریک رئیس!</b>\n${res.message}\n\nاز همین لحظه تمام تحلیل‌های متنی و تصویری با مدل هوشمند <code>${CONFIG.AI_MODEL}</code> انجام می‌شود! 🚀`,
      { parse_mode: "HTML" }
    );
  } else {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      waitMsg.message_id,
      `⚠️ <b>خطا در فعال‌سازی کلید:</b>\n${res.message}`,
      { parse_mode: "HTML" }
    );
  }
});

bot.command(["broadcast", "broadcast@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    return ctx.reply("⛔ شما دسترسی به این دستور را ندارید.");
  }

  const text = ctx.message?.text?.replace(/^\/broadcast(@\w+)?\s*/i, "").trim();
  if (!text) {
    return ctx.reply("💡 لطفاً متن پیام همگانی را بعد از دستور وارد کنید:\n<code>/broadcast متن پیام</code>", {
      parse_mode: "HTML",
    });
  }

  const userIds = getAllUserIds();
  let sentCount = 0;
  for (const uid of userIds) {
    try {
      await ctx.api.sendMessage(uid, `📢 <b>پیام همگانی از طرف مدیریت:</b>\n\n${text}`, {
        parse_mode: "HTML",
      });
      sentCount++;
    } catch (e) {
      // Ignore blocked or invalid
    }
  }

  await ctx.reply(`✅ پیام همگانی با موفقیت برای <b>${sentCount}</b> کاربر ارسال شد!`, {
    parse_mode: "HTML",
  });
});

bot.command(["admin", "admin@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    return ctx.reply("⛔ شما دسترسی به پنل مدیریت ندارید.");
  }
  const kb = new InlineKeyboard()
    .text("📊 آمار و ارقام ربات", "admin_stats")
    .text("👥 مدیریت کاربران و سهمیه‌ها", "admin_users")
    .row()
    .text("🔙 بازگشت به منوی اصلی", "menu_home");

  await ctx.reply("👑 <b>پنل مدیریت اختصاصی ربات mazmaz:</b>", {
    reply_markup: kb,
    parse_mode: "HTML",
  });
});

bot.command(["grant_cmd", "grant_cmd@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  if (!targetId || isNaN(targetId)) {
    return ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/grant_cmd USER_ID</code>", { parse_mode: "HTML" });
  }
  setCommandAccess(targetId, true);
  await ctx.reply(`✅ دسترسی اجرای دستورات اسلش برای کاربر <code>${targetId}</code> فعال شد.`, { parse_mode: "HTML" });
});

bot.command(["revoke_cmd", "revoke_cmd@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  if (!targetId || isNaN(targetId)) {
    return ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/revoke_cmd USER_ID</code>", { parse_mode: "HTML" });
  }
  setCommandAccess(targetId, false);
  await ctx.reply(`🚫 دسترسی اجرای دستورات اسلش برای کاربر <code>${targetId}</code> لغو شد.`, { parse_mode: "HTML" });
});


// 3. Register Photo & Vision Handler
bot.on("message:photo", handlePhotoMessage);

// 4. Register Text & NLP Message Handler
bot.on("message:text", handleTextMessage);

// 5. Register Callback Queries
// Approval & Rejection
bot.callbackQuery(/^appr:(\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const targetId = parseInt(ctx.match[1], 10);
  approveUser(targetId);
  const u = getUserById(targetId);
  const name = u ? u.first_name : targetId;

  try {
    await ctx.api.sendMessage(
      targetId,
      "🎉 <b>تبریک! دسترسی شما به ربات mazmaz تایید شد!</b>\n\n" +
        "سهمیه روزانه شما: <b>۲۴ پیام</b>\n" +
        "اکنون می‌توانید با زدن دستور /start از تمام امکانات استفاده کنید. 🚀",
      { parse_mode: "HTML" }
    );
  } catch (e) {
    console.warn("Could not notify user:", e);
  }

  await ctx.editMessageText(
    `✅ <b>دسترسی کاربر ${name} (<code>${targetId}</code>) با موفقیت تایید شد!</b>`,
    { parse_mode: "HTML" }
  ).catch(() => {});
  await ctx.answerCallbackQuery({ text: "کاربر با موفقیت تایید شد." }).catch(() => {});
});

bot.callbackQuery(/^rejc:(\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const targetId = parseInt(ctx.match[1], 10);
  rejectUser(targetId);
  await ctx.editMessageText(`❌ <b>دسترسی کاربر <code>${targetId}</code> مسدود / لغو شد.</b>`, {
    parse_mode: "HTML",
  }).catch(() => {});
  await ctx.answerCallbackQuery({ text: "دسترسی کاربر مسدود شد." }).catch(() => {});
});

bot.callbackQuery("ignore_alert", async (ctx) => {
  await ctx.editMessageText("👁️ <i>گزارش تخلف نادیده گرفته شد.</i>", {
    parse_mode: "HTML",
  }).catch(() => {});
  await ctx.answerCallbackQuery({ text: "گزارش نادیده گرفته شد." }).catch(() => {});
});



// Downloader callbacks
bot.callbackQuery(/^dl_v:(.+)$/, async (ctx) => {
  const url = ctx.match[1];
  await ctx.editMessageText("⏳ <b>در حال دانلود ویدیو، لطفاً کمی صبور باشید...</b>", {
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery({ text: "شروع دانلود ویدیو..." });

  const { filePath, error } = await downloadMedia(url, false);
  if (filePath) {
    try {
      await ctx.replyWithVideo(new InputFile(filePath), {
        caption: "✅ دانلود شده توسط <b>@mazmazAgentBot</b>",
        parse_mode: "HTML",
      });
      await ctx.deleteMessage();
    } catch (e: any) {
      await ctx.reply(`❌ خطا در ارسال ویدیو: ${e.message || e}`);
    } finally {
      cleanupFile(filePath);
    }
  } else {
    await ctx.editMessageText(`❌ ${error || "خطا در دانلود."}`);
  }
});

bot.callbackQuery(/^dl_a:(.+)$/, async (ctx) => {
  const url = ctx.match[1];
  await ctx.editMessageText("⏳ <b>در حال تبدیل و دانلود فایل صوتی MP3...</b>", {
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery({ text: "شروع استخراج صوت..." });

  const { filePath, error } = await downloadMedia(url, true);
  if (filePath) {
    try {
      await ctx.replyWithAudio(new InputFile(filePath), {
        caption: "🎵 استخراج شده توسط <b>@mazmazAgentBot</b>",
        parse_mode: "HTML",
      });
      await ctx.deleteMessage();
    } catch (e: any) {
      await ctx.reply(`❌ خطا در ارسال موزیک: ${e.message || e}`);
    } finally {
      cleanupFile(filePath);
    }
  } else {
    await ctx.editMessageText(`❌ ${error || "خطا در دانلود."}`);
  }
});

bot.callbackQuery("dl_cancel", async (ctx) => {
  await ctx.deleteMessage();
  await ctx.answerCallbackQuery({ text: "دانلود لغو شد." });
});

// Task callbacks
bot.callbackQuery(/^task_tog:(\d+)$/, async (ctx) => {
  const taskId = parseInt(ctx.match[1], 10);
  toggleTask(taskId, ctx.from!.id);
  await renderTasksMenu(ctx, ctx.from!.id, true);
  await ctx.answerCallbackQuery({ text: "وضعیت تغییر کرد." });
});

bot.callbackQuery(/^task_del:(\d+)$/, async (ctx) => {
  const taskId = parseInt(ctx.match[1], 10);
  deleteTask(taskId, ctx.from!.id);
  await renderTasksMenu(ctx, ctx.from!.id, true);
  await ctx.answerCallbackQuery({ text: "تسک حذف شد." });
});

// Navigation Menu Callbacks
bot.callbackQuery("menu_home", async (ctx) => {
  await ctx.editMessageText("🏠 <b>منوی اصلی ربات mazmaz:</b>\nچطور می‌تونم کمکت کنم؟", {
    reply_markup: getMainMenu(ctx.from!.id),
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("menu_tasks", async (ctx) => {
  await renderTasksMenu(ctx, ctx.from!.id, true);
  await ctx.answerCallbackQuery();
});

function getWeatherKeyboard(currentCity = "تهران"): InlineKeyboard {
  return new InlineKeyboard()
    .text(currentCity === "تهران" ? "🔘 تهران" : "تهران", "w_city:تهران")
    .text(currentCity === "مشهد" ? "🔘 مشهد" : "مشهد", "w_city:مشهد")
    .text(currentCity === "اصفهان" ? "🔘 اصفهان" : "اصفهان", "w_city:اصفهان")
    .row()
    .text(currentCity === "شیراز" ? "🔘 شیراز" : "شیراز", "w_city:شیراز")
    .text(currentCity === "تبریز" ? "🔘 تبریز" : "تبریز", "w_city:تبریز")
    .text(currentCity === "رشت" ? "🔘 رشت" : "رشت", "w_city:رشت")
    .row()
    .text(currentCity === "اهواز" ? "🔘 اهواز" : "اهواز", "w_city:اهواز")
    .text(currentCity === "کیش" ? "🔘 کیش" : "کیش", "w_city:کیش")
    .text("🔄 به‌روزرسانی", `w_city:${currentCity}`)
    .row()
    .text("🔙 بازگشت به منوی اصلی", "menu_home");
}

bot.callbackQuery("menu_weather", async (ctx) => {
  const res = await getWeather("تهران");
  const fullText = `${res}\n\n💡 <i>می‌توانید شهر را انتخاب کنید یا در چت بنویسید: «هواشناسی شیراز»</i>`;
  await ctx.editMessageText(fullText, { reply_markup: getWeatherKeyboard("تهران"), parse_mode: "HTML" });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^w_city:(.+)$/, async (ctx) => {
  const city = ctx.match[1];
  const res = await getWeather(city);
  const fullText = `${res}\n\n💡 <i>می‌توانید شهر را انتخاب کنید یا در چت بنویسید: «هواشناسی شیراز»</i>`;
  await ctx.editMessageText(fullText, { reply_markup: getWeatherKeyboard(city), parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery({ text: `آب و هوای ${city} به‌روز شد.` });
});


bot.callbackQuery("menu_crypto", async (ctx) => {
  const res = await getCryptoPrices();
  const kb = new InlineKeyboard()
    .text("🔄 به‌روزرسانی", "menu_crypto")
    .text("🔙 بازگشت", "menu_home");
  await ctx.editMessageText(res, { reply_markup: kb, parse_mode: "HTML" });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("menu_bench", async (ctx) => {
  const kb = new InlineKeyboard()
    .text("🏆 رده‌بندی Chatbot Arena", "bench_arena")
    .text("💻 بنچمارک سخت‌افزار (CPU/GPU)", "bench_hw")
    .row()
    .text("🔙 بازگشت به منو", "menu_home");

  await ctx.editMessageText(
    "⚡ <b>مرکز بنچمارک و اخبار تخصصی سخت‌افزار و هوش مصنوعی:</b>\nیکی از گزینه‌ها را انتخاب کنید یا نام مدل را در چت بفرستید:",
    { reply_markup: kb, parse_mode: "HTML" }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("bench_arena", async (ctx) => {
  const kb = new InlineKeyboard().text("🔙 بازگشت به بخش بنچمارک", "menu_bench");
  await ctx.editMessageText(LMSYS_ARENA_SUMMARY, { reply_markup: kb, parse_mode: "HTML" });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("bench_hw", async (ctx) => {
  const kb = new InlineKeyboard().text("🔙 بازگشت به بخش بنچمارک", "menu_bench");
  await ctx.editMessageText(TOP_HARDWARE_BENCHMARKS, { reply_markup: kb, parse_mode: "HTML" });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("menu_admin", async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const kb = new InlineKeyboard()
    .text("📊 آمار و ارقام ربات", "admin_stats")
    .text("👥 مدیریت کاربران و سهمیه‌ها", "admin_users")
    .row()
    .text("🔙 بازگشت به منوی اصلی", "menu_home");

  await ctx.editMessageText("👑 <b>پنل مدیریت اختصاصی ربات mazmaz:</b>", {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("admin_stats", async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const totalUsers = getUserCount();
  const stats = getStats();

  const text = (
    `📊 <b>آمار تفکیکی عملکرد ربات mazmaz (Bun + TS):</b>\n\n` +
    `👥 تعداد کل کاربران: <b>${totalUsers}</b>\n` +
    `📥 لینک‌های مدیا: <b>${stats.downloads_requested || 0}</b>\n` +
    `🌐 لینک‌های خوانده شده: <b>${stats.links_analyzed || 0}</b>\n` +
    `⚡ استعلام بنچمارک‌ها: <b>${stats.benchmarks_queried || 0}</b>\n` +
    `🧠 سوالات هوش مصنوعی: <b>${stats.ai_queries || 0}</b>\n` +
    `🌤️ استعلام آب و هوا: <b>${stats.weather_checks || 0}</b>\n` +
    `📊 استعلام کریپتو: <b>${stats.crypto_checks || 0}</b>\n`
  );

  const kb = new InlineKeyboard()
    .text("🔄 به‌روزرسانی", "admin_stats")
    .text("🔙 بازگشت به پنل ادمین", "menu_admin");

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("admin_users", async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const users = getAllUsers();

  const lines = ["👥 <b>لیست کاربران ربات و وضعیت سهمیه:</b>\n"];
  for (const u of users.slice(0, 15)) {
    const appr = u.is_approved ? "✅ مجاز" : "⏳ در انتظار";
    const uname = u.username ? `@${u.username}` : "بدون یوزرنیم";
    lines.push(
      `• <b>${u.first_name}</b> (${uname}) - <code>${u.user_id}</code>\n  وضعیت: ${appr} | مصرف امروز: ${u.used_today}/${u.daily_quota}\n`
    );
  }

  const kb = new InlineKeyboard().text("🔙 بازگشت به پنل ادمین", "menu_admin");
  await ctx.editMessageText(lines.join("\n"), { reply_markup: kb, parse_mode: "HTML" });
  await ctx.answerCallbackQuery();
});

// Launch bot!
bot.start({
  onStart: async (info) => {
    console.log(`\n==========================================`);
    console.log(`  🤖 mazmaz is RUNNING on Bun + TypeScript!`);
    console.log(`  Username: @${info.username} (ID: ${info.id})`);
    console.log(`==========================================\n`);

    try {
      // لیست کامل و انحصاری دستورات فقط برای رئیس مهدی در تلگرام نمایش داده می‌شود
      for (const adminId of CONFIG.ADMIN_IDS) {
        await bot.api.setMyCommands(
          [
            { command: "admin", description: "👑 پنل مدیریت و آمار سیستم" },
            { command: "setkey", description: "🔑 تنظیم کلید هوش مصنوعی" },
            { command: "broadcast", description: "📢 ارسال پیام همگانی" },
            { command: "grant_cmd", description: "🔓 اعطای دسترسی اسلش به کاربر" },
            { command: "revoke_cmd", description: "🔒 لغو دسترسی اسلش کاربر" },
            { command: "weather", description: "🌤️ وضعیت زنده و پیش‌بینی آب و هوا" },
            { command: "tasks", description: "📋 مدیریت لیست کارها" },
            { command: "stop", description: "🛑 توقف گفتگو و پاکسازی" },
            { command: "history", description: "🧹 پاک کردن حافظه چت" },
          ],
          { scope: { type: "chat", chat_id: adminId } }
        ).catch(() => {});
      }

      // مخفی کردن منوی دستورات در تمام گروه‌ها و برای سایر کاربران عادی
      await bot.api.deleteMyCommands({ scope: { type: "all_group_chats" } }).catch(() => {});
      await bot.api.setMyCommands([], { scope: { type: "default" } }).catch(() => {});
      console.log("✅ Exclusive Admin Telegram Commands registered for Mehdi only!");
    } catch (e: any) {
      console.warn("⚠️ Could not set bot commands automatically:", e?.message || e);
    }
  },
});
