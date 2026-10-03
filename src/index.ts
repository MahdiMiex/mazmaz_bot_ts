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
  muteUser,
  unmuteUser,
  isUserMuted,
  banUser,
  unbanUser,
  isUserBanned,
  setUserQuota,
  addQuota,
} from "./db";
import { ADMIN_REPLY_TARGET } from "./services/feedback";
import { sendSafeMessage, withTyping } from "./utils/chunker";
import { downloadMedia, cleanupFile } from "./services/mediaDownloader";
import { getWeather } from "./services/weather";
import { getCryptoPrices } from "./services/crypto";
import { getDollarAndGoldReport } from "./services/currency";
import { LMSYS_ARENA_SUMMARY, TOP_HARDWARE_BENCHMARKS } from "./services/benchmarks";
import { testGeminiKey, clearUserHistory } from "./services/ai";
import { fetchAndAnalyzeLink } from "./services/linkReader";

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
  const statusMsg = await ctx.reply(`🌤️ <i>در حال دریافت وضعیت آب و هوای ${city}... ⏳</i>`, {
    parse_mode: "HTML",
    reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
  });
  const res = await withTyping(ctx, () => getWeather(city));
  const finalMsg = `${res}${formatQuotaFooter(ctx.from!.id)}`;
  try {
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalMsg, { parse_mode: "HTML" });
  } catch {
    await ctx.reply(finalMsg, {
      parse_mode: "HTML",
      reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
    });
  }
});

bot.command(["dollar", "dollar@mazmazAgentBot", "arz", "tala"], async (ctx) => {
  const statusMsg = await ctx.reply("💵 <i>در حال استعلام لحظه‌ای قیمت دلار، طلا و نرخ آزاد... ⏳</i>", {
    parse_mode: "HTML",
    reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
  });
  const report = await withTyping(ctx, () => getDollarAndGoldReport());
  const dollarKb = new InlineKeyboard()
    .text("📈 نمودار گرافیکی پیشرفته", "dlr_chart")
    .text("🔄 به‌روزرسانی", "dlr_refresh");
  try {
    await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, report.text, {
      reply_markup: dollarKb,
      parse_mode: "HTML",
    });
  } catch {
    await ctx.reply(report.text, {
      reply_markup: dollarKb,
      parse_mode: "HTML",
      reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
    });
  }
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

bot.command(["browse", "browse@mazmazAgentBot", "link"], async (ctx) => {
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const url = parts.slice(1).join(" ").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return ctx.reply(
      "💡 <b>راهنمای مرورگر وب هوشمند:</b>\n\nبرای مرور و تحلیل صفحات وب، لینک را همراه با دستور ارسال کنید:\n<code>/browse https://example.com</code>\n\nهمچنین می‌توانی هر لینکی را مستقیماً داخل چت بفرستی تا ربات خودکار آن را باز و خلاصه کند! 🌐",
      { parse_mode: "HTML" }
    );
  }
  const statusMsg = await ctx.reply("🌐 <b>در حال باز کردن و مرور صفحه وب... ⏳</b>", {
    parse_mode: "HTML",
    reply_parameters: { message_id: ctx.message!.message_id, allow_sending_without_reply: true },
  });
  const analysis = await withTyping(ctx, () => fetchAndAnalyzeLink(ctx.from!.id, url));
  await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, analysis, { parse_mode: "HTML" }).catch(() => {
    ctx.reply(analysis, { parse_mode: "HTML" });
  });
});

bot.command(["set_quota", "set_quota@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  const quota = parseInt(parts[2], 10);
  if (!targetId || isNaN(targetId) || isNaN(quota)) {
    return ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/set_quota USER_ID QUOTA</code>\nمثال:\n<code>/set_quota 8288566582 50</code>", { parse_mode: "HTML" });
  }
  setUserQuota(targetId, quota);
  await ctx.reply(`✅ سهمیه روزانه کاربر <code>${targetId}</code> به <b>${quota}</b> پیام تغییر یافت.`, { parse_mode: "HTML" });
});

bot.command(["add_quota", "add_quota@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  const amount = parseInt(parts[2], 10);
  if (!targetId || isNaN(targetId) || isNaN(amount)) {
    return ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/add_quota USER_ID AMOUNT</code>\nمثال:\n<code>/add_quota 8288566582 20</code>", { parse_mode: "HTML" });
  }
  const newQuota = addQuota(targetId, amount);
  await ctx.reply(`✅ سهمیه کاربر <code>${targetId}</code> به میزان <b>${amount}</b> افزایش یافت. (سهمیه جدید: <b>${newQuota}</b>)`, { parse_mode: "HTML" });
});

bot.command(["mute", "mute@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  const hours = parseInt(parts[2], 10) || 6;
  const reason = parts.slice(3).join(" ") || "دستور مستقیم مدیریت";
  if (!targetId || isNaN(targetId)) {
    return ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/mute USER_ID [HOURS] [REASON]</code>\nمثال:\n<code>/mute 8288566582 6 بی احترامی</code>", { parse_mode: "HTML" });
  }
  const res = muteUser(targetId, hours, reason);
  await ctx.reply(`⏳ کاربر <code>${targetId}</code> به مدت <b>${hours} ساعت</b> (تا <code>${res.untilStr}</code>) میوت شد.\nدلیل: <i>${reason}</i>`, { parse_mode: "HTML" });
});

bot.command(["unmute", "unmute@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  if (!targetId || isNaN(targetId)) {
    return ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/unmute USER_ID</code>", { parse_mode: "HTML" });
  }
  unmuteUser(targetId);
  await ctx.reply(`✅ محدودیت میوت کاربر <code>${targetId}</code> لغو شد.`, { parse_mode: "HTML" });
});

bot.command(["ban", "ban@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  if (!targetId || isNaN(targetId)) {
    return ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/ban USER_ID</code>", { parse_mode: "HTML" });
  }
  banUser(targetId);
  await ctx.reply(`🚫 کاربر <code>${targetId}</code> برای همیشه مسدود (بن) شد.`, { parse_mode: "HTML" });
});

bot.command(["unban", "unban@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  if (!targetId || isNaN(targetId)) {
    return ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/unban USER_ID</code>", { parse_mode: "HTML" });
  }
  unbanUser(targetId);
  await ctx.reply(`✅ کاربر <code>${targetId}</code> از حالت مسدودسازی خارج شد.`, { parse_mode: "HTML" });
});

bot.command(["reply_user", "reply_user@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  const msgText = parts.slice(2).join(" ");
  if (!targetId || isNaN(targetId)) {
    return ctx.reply("💡 <b>نحوه استفاده:</b>\n<code>/reply_user USER_ID متن پیام</code>", { parse_mode: "HTML" });
  }
  if (!msgText) {
    ADMIN_REPLY_TARGET.set(ctx.from!.id, targetId);
    return ctx.reply(`✍️ لطفاً پیام خود را برای کاربر <code>${targetId}</code> ارسال کنید تا فوراً برایش ارسال شود.`, { parse_mode: "HTML" });
  }
  try {
    await ctx.api.sendMessage(targetId, `📩 <b>پیام از طرف مدیریت:</b>\n\n${msgText}`, { parse_mode: "HTML" });
    await ctx.reply(`✅ پیام به کاربر <code>${targetId}</code> ارسال شد!`, { parse_mode: "HTML" });
  } catch (e: any) {
    await ctx.reply(`❌ خطا در ارسال پیام به کاربر: ${e?.message || e}`);
  }
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

bot.callbackQuery(/^mute_u:(\d+):(\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const hours = parseInt(ctx.match[1], 10);
  const targetId = parseInt(ctx.match[2], 10);
  const res = muteUser(targetId, hours, "استفاده از الفاظ نامناسب و نقض قوانین");
  await ctx.editMessageText(
    `⏳ <b>کاربر <code>${targetId}</code> به مدت ${hours} ساعت با موفقیت میوت شد!</b>\n` +
      `📅 مهلت محرومیت تا: <code>${res.untilStr}</code>\n` +
      `👤 ثبت کننده: <b>مهدی</b>`,
    { parse_mode: "HTML" }
  ).catch(() => {});
  await ctx.answerCallbackQuery({ text: `کاربر ${hours} ساعت میوت شد.` }).catch(() => {});
});

bot.callbackQuery(/^unmute_u:(\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const targetId = parseInt(ctx.match[1], 10);
  unmuteUser(targetId);
  await ctx.editMessageText(`✅ <b>کاربر <code>${targetId}</code> با موفقیت آن‌میوت شد.</b>`, {
    parse_mode: "HTML",
  }).catch(() => {});
  await ctx.answerCallbackQuery({ text: "محدودیت کاربر لغو شد." }).catch(() => {});
});

bot.callbackQuery(/^ban_u:(\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const targetId = parseInt(ctx.match[1], 10);
  banUser(targetId);
  await ctx.editMessageText(
    `🚫 <b>کاربر <code>${targetId}</code> برای همیشه مسدود (بن) شد.</b>\nدیگر اجازه هیچ‌گونه استفاده از ربات را ندارد.`,
    { parse_mode: "HTML" }
  ).catch(() => {});
  await ctx.answerCallbackQuery({ text: "کاربر مسدود شد." }).catch(() => {});
});

bot.callbackQuery(/^unban_u:(\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const targetId = parseInt(ctx.match[1], 10);
  unbanUser(targetId);
  await ctx.editMessageText(`✅ <b>کاربر <code>${targetId}</code> از مسدودسازی خارج شد.</b>`, {
    parse_mode: "HTML",
  }).catch(() => {});
  await ctx.answerCallbackQuery({ text: "کاربر آن‌بن شد." }).catch(() => {});
});

bot.callbackQuery(/^reply_u:(\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const targetId = parseInt(ctx.match[1], 10);
  ADMIN_REPLY_TARGET.set(ctx.from!.id, targetId);
  await ctx.reply(
    `✍️ <b>حالت ارسال پاسخ به کاربر <code>${targetId}</code> فعال شد:</b>\n\n` +
      `متن پاسخ خود را به عنوان پیام بعدی در همین چت ارسال کنید تا مستقیماً به پی‌وی کاربر فرستاده شود.`,
    { parse_mode: "HTML" }
  );
  await ctx.answerCallbackQuery({ text: "آماده دریافت پیام شما..." }).catch(() => {});
});

bot.callbackQuery("ack_report", async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const originalText = ctx.callbackQuery.message?.text || "";
  await ctx.editMessageText(`${originalText}\n\n✅ <i>گزارش توسط رئیس مهدی بررسی شد.</i>`, {
    parse_mode: "HTML",
  }).catch(() => {});
  await ctx.answerCallbackQuery({ text: "بررسی شد." }).catch(() => {});
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


bot.callbackQuery("menu_dollar", async (ctx) => {
  const report = await getDollarAndGoldReport();
  const dollarKb = new InlineKeyboard()
    .text("📈 نمودار گرافیکی پیشرفته", "dlr_chart")
    .text("🔄 به‌روزرسانی", "dlr_refresh")
    .row()
    .text("🔙 بازگشت به منو", "menu_home");
  await ctx.editMessageText(report.text, { reply_markup: dollarKb, parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("dlr_chart", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "در حال بارگذاری نمودار نوسان..." });
  const report = await getDollarAndGoldReport();
  if (report.chartUrl) {
    const dollarKb = new InlineKeyboard().text("🔄 به‌روزرسانی زنده", "dlr_refresh");
    await ctx.replyWithPhoto(report.chartUrl, {
      caption: `📈 <b>نمودار نوسان روزانه دلار بازار آزاد (تومان)</b>\n\n${report.text.slice(0, 800)}`,
      reply_markup: dollarKb,
      parse_mode: "HTML",
    }).catch(async () => {
      await ctx.reply("❌ خطا در ارسال تصویر نمودار.", { parse_mode: "HTML" });
    });
  }
});

bot.callbackQuery("dlr_refresh", async (ctx) => {
  const report = await getDollarAndGoldReport();
  const dollarKb = new InlineKeyboard()
    .text("📈 نمودار گرافیکی پیشرفته", "dlr_chart")
    .text("🔄 به‌روزرسانی", "dlr_refresh")
    .row()
    .text("🔙 بازگشت به منو", "menu_home");
  await ctx.editMessageText(report.text, { reply_markup: dollarKb, parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery({ text: "نرخ دلار و طلا به‌روز شد." });
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

  const lines = [
    "👥 <b>مدیریت کاربران و سهمیه‌ها:</b>\nبرای ویرایش سهمیه، میوت یا بن کردن، کاربر مورد نظر را انتخاب کنید:\n",
  ];
  const kb = new InlineKeyboard();

  for (const u of users.slice(0, 12)) {
    const appr = u.is_approved ? "✅" : "⏳";
    const banned = u.is_banned ? "🚫" : "";
    const name = `${u.first_name || ""} ${u.username ? `(@${u.username})` : ""}`.trim() || String(u.user_id);
    lines.push(`• ${banned}${appr} <b>${name}</b> (سهمیه: ${u.daily_quota} | امروز: ${u.used_today})`);
    kb.text(`${banned}${appr} ${name.slice(0, 20)}`, `u_detail:${u.user_id}`).row();
  }

  kb.text("🔙 بازگشت به پنل ادمین", "menu_admin");
  await ctx.editMessageText(lines.join("\n"), { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^u_detail:(\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const targetId = parseInt(ctx.match[1], 10);
  const u = getUserById(targetId);
  if (!u) {
    return ctx.answerCallbackQuery({ text: "کاربر یافت نشد!" });
  }

  const muteStatus = isUserMuted(targetId);
  const banned = isUserBanned(targetId);
  const uname = u.username ? `@${u.username}` : "ندارد";

  const text = (
    `👤 <b>پروفایل مدیریتی کاربر:</b>\n\n` +
    `• نام: <b>${u.first_name} ${u.last_name || ""}</b>\n` +
    `• یوزرنیم: <b>${uname}</b>\n` +
    `• آیدی عددی: <code>${u.user_id}</code>\n` +
    `• وضعیت تایید: ${u.is_approved ? "✅ تایید شده" : "⏳ در انتظار"}\n` +
    `• وضعیت محدودیت: ${banned ? "🚫 مسدود (بن دائم)" : (muteStatus.isMuted ? `⏳ میوت تا ${muteStatus.untilStr}` : "🟢 فعال")}\n` +
    `• سهمیه روزانه: <b>${u.daily_quota}</b> پیام\n` +
    `• مصرف امروز: <b>${u.used_today}</b> پیام\n` +
    `• آخرین فعالیت: <code>${u.last_active}</code>\n`
  );

  const kb = new InlineKeyboard()
    .text("➕ ۱۰ سهمیه", `q_add:${targetId}:10`)
    .text("➕ ۵۰ سهمیه", `q_add:${targetId}:50`)
    .row()
    .text("⏳ میوت ۶ ساعته", `mute_u:6:${targetId}`)
    .text("⏳ میوت ۲۴ ساعته", `mute_u:24:${targetId}`)
    .row()
    .text(muteStatus.isMuted ? "🔊 رفع میوت" : "🔊 آن‌میوت", `unmute_u:${targetId}`)
    .text(banned ? "🟢 رفع بن" : "🚫 بن کامل", banned ? `unban_u:${targetId}` : `ban_u:${targetId}`)
    .row()
    .text("💬 ارسال پیام اختصاصی", `reply_u:${targetId}`)
    .text("🔙 بازگشت به لیست", "admin_users");

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^q_add:(\d+):(\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const targetId = parseInt(ctx.match[1], 10);
  const amount = parseInt(ctx.match[2], 10);
  const newQuota = addQuota(targetId, amount);
  await ctx.answerCallbackQuery({ text: `✅ سهمیه به ${newQuota} افزایش یافت.` }).catch(() => {});

  const u = getUserById(targetId);
  if (!u) return;
  const muteStatus = isUserMuted(targetId);
  const banned = isUserBanned(targetId);
  const uname = u.username ? `@${u.username}` : "ندارد";

  const text = (
    `👤 <b>پروفایل مدیریتی کاربر:</b>\n\n` +
    `• نام: <b>${u.first_name} ${u.last_name || ""}</b>\n` +
    `• یوزرنیم: <b>${uname}</b>\n` +
    `• آیدی عددی: <code>${u.user_id}</code>\n` +
    `• وضعیت تایید: ${u.is_approved ? "✅ تایید شده" : "⏳ در انتظار"}\n` +
    `• وضعیت محدودیت: ${banned ? "🚫 مسدود (بن دائم)" : (muteStatus.isMuted ? `⏳ میوت تا ${muteStatus.untilStr}` : "🟢 فعال")}\n` +
    `• سهمیه روزانه: <b>${u.daily_quota}</b> پیام\n` +
    `• مصرف امروز: <b>${u.used_today}</b> پیام\n` +
    `• آخرین فعالیت: <code>${u.last_active}</code>\n`
  );

  const kb = new InlineKeyboard()
    .text("➕ ۱۰ سهمیه", `q_add:${targetId}:10`)
    .text("➕ ۵۰ سهمیه", `q_add:${targetId}:50`)
    .row()
    .text("⏳ میوت ۶ ساعته", `mute_u:6:${targetId}`)
    .text("⏳ میوت ۲۴ ساعته", `mute_u:24:${targetId}`)
    .row()
    .text(muteStatus.isMuted ? "🔊 رفع میوت" : "🔊 آن‌میوت", `unmute_u:${targetId}`)
    .text(banned ? "🟢 رفع بن" : "🚫 بن کامل", banned ? `unban_u:${targetId}` : `ban_u:${targetId}`)
    .row()
    .text("💬 ارسال پیام اختصاصی", `reply_u:${targetId}`)
    .text("🔙 بازگشت به لیست", "admin_users");

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
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
            { command: "set_quota", description: "🔢 تنظیم سهمیه روزانه کاربر" },
            { command: "add_quota", description: "➕ افزایش سهمیه کاربر" },
            { command: "mute", description: "⏳ میوت کردن کاربر (با ساعت و دلیل)" },
            { command: "unmute", description: "🔊 رفع میوت کاربر" },
            { command: "ban", description: "🚫 مسدودسازی کامل (بن) کاربر" },
            { command: "unban", description: "🟢 رفع مسدودسازی کاربر" },
            { command: "reply_user", description: "💬 ارسال پیام مستقیم به کاربر" },
            { command: "setkey", description: "🔑 تنظیم کلید هوش مصنوعی" },
            { command: "broadcast", description: "📢 ارسال پیام همگانی" },
            { command: "grant_cmd", description: "🔓 اعطای دسترسی اسلش به کاربر" },
            { command: "revoke_cmd", description: "🔒 لغو دسترسی اسلش کاربر" },
            { command: "dollar", description: "💵 قیمت دلار، ارز و طلا با نمودار" },
            { command: "browse", description: "🌐 مرورگر هوشمند وب و خواندن لینک" },
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
