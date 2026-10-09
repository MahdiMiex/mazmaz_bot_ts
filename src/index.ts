import { Bot, InlineKeyboard, InputFile } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { CONFIG, updateGeminiApiKey, validateStartupConfig } from "./config";
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
  getUserDetailedLogs,
  getRecentGlobalLogs,
  getUsersWithRecentChat,
  getUserMessageCount,
  registerOrUpdateGroup,
  getGroupById,
  getAllGroups,
  setGroupStatus,
  isGroupApproved,
  clearChatContext,
  getApprovedRules,
  approveRule,
  rejectRule,
  getRuleById,
  getSetting,
  setSetting,
  deleteSetting,
} from "./db";
import { ADMIN_REPLY_TARGET } from "./services/feedback";
import { sendSafeMessage, withTyping } from "./utils/chunker";
import { escapeHtml } from "./utils/formatter";
import { downloadMedia, cleanupFile } from "./services/mediaDownloader";
import { sendMusicToTelegram } from "./services/musicService";
import { generateChatDigest } from "./services/digestService";
import { getWeather } from "./services/weather";
import { getCryptoPrices } from "./services/crypto";
import { getDollarAndGoldReport } from "./services/currency";
import { LMSYS_ARENA_SUMMARY, TOP_HARDWARE_BENCHMARKS } from "./services/benchmarks";
import {
  testGeminiKey,
  clearUserHistory,
  getResolvedActiveModel,
  isDeadModel,
  checkAvailableGeminiModels,
  getActivePowerLevel,
  getThinkingBudget,
  type PowerLevel,
  type ModelResolution,
} from "./services/ai";
import { fetchAndAnalyzeLink } from "./services/linkReader";
import { setupTrackingMiddleware } from "./tools/adminTools";

console.log("🚀 Initializing mazmaz Telegram Bot with Bun & grammY...");

validateStartupConfig();

if (!CONFIG.BOT_TOKEN) {
  console.error("❌ خطای اساسی: توکن ربات تلگرام (BOT_TOKEN) در متغیرهای محیطی (.env) تعریف نشده است!");
  process.exit(1);
}

// Clean up any legacy dead models in stored settings
const storedStartupModel = getSetting("ai_model");
if (storedStartupModel && isDeadModel(storedStartupModel)) {
  deleteSetting("ai_model");
}

const startupModelRes = getResolvedActiveModel();
console.log(`🤖 [CONFIG] Active AI model: "${startupModelRes.model}" (Source: ${startupModelRes.source})`);
console.log(`📦 [CONFIG] Database storage path (DB_PATH): "${CONFIG.DB_PATH}"`);
checkAvailableGeminiModels(CONFIG.GEMINI_API_KEY).catch(() => {});

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

export const bot = new Bot(CONFIG.BOT_TOKEN, {
  client: {
    baseFetchConfig: {
      // @ts-ignore
      agent,
    },
  },
});

// 0.5 Register Telegram Group Tracking Middleware (ذخیره تاریخچه پیام‌ها برای هوش مصنوعی)
setupTrackingMiddleware(bot);

// 1. Register Global Access Control & Quota Middleware
bot.use(accessControlMiddleware);

// Global Error Handler to prevent bot crash on Telegram network errors or expired queries
bot.catch((err) => {
  const ctx = err.ctx;
  console.warn(`[GLOBAL SAFEGUARD] Handled error in update ${ctx.update?.update_id}:`, (err.error as any)?.message || err.error);
});

// 1.5 مدیریت دعوت ربات به گروه‌ها (تایید رسمی ادمین و ثبت هویت اد کننده)
bot.on("my_chat_member", async (ctx) => {
  const update = ctx.myChatMember;
  const status = update.new_chat_member.status;
  const oldStatus = update.old_chat_member.status;
  const chat = ctx.chat;
  const addedBy = update.from;

  // ربات به عنوان عضو یا ادمین وارد گروه شد
  if (
    (status === "member" || status === "administrator") &&
    oldStatus !== "member" &&
    oldStatus !== "administrator"
  ) {
    const isGroup = chat.type === "group" || chat.type === "supergroup";
    if (!isGroup) return;

    const isAdmin = CONFIG.ADMIN_IDS.includes(addedBy.id);
    const addedByName = `${addedBy.first_name || ""} ${addedBy.last_name || ""}`.trim() || "ناشناس";
    const addedByUname = addedBy.username || "";

    if (isAdmin) {
      // اضافه شده توسط خود مهدی: تایید فوری
      registerOrUpdateGroup(chat.id, chat.title || "گروه", chat.type, addedBy.id, addedByName, addedByUname, "approved");
      await ctx.reply(
        `👑 <b>سلام به اعضای محترم گروه «${escapeHtml(chat.title || "گروه")}»!</b>\n` +
        `من «مزمز» هستم، دستیار هوشمند شما. توسط رئیس مهدی به این گروه اضافه شدم و آماده فعالیتم! 🚀`,
        { parse_mode: "HTML" }
      ).catch(() => {});
      return;
    }

    // اضافه شده توسط کاربر عادی: وضعیت در انتظار تایید (pending)
    registerOrUpdateGroup(chat.id, chat.title || "گروه", chat.type, addedBy.id, addedByName, addedByUname, "pending");

    // ارسال اعلان محترمانه به گروه
    await ctx.reply(
      `⏳ <b>درود به اعضای محترم گروه «${escapeHtml(chat.title || "گروه")}»!</b>\n\n` +
      `من «مزمز» هستم؛ ربات اختصاصی هوش مصنوعی.\n` +
      `⚠️ برای رعایت امنیت و مدیریت منابع سرور، فعالیت من در گروه‌ها نیازمند تایید مستقیم سازنده‌ام (رئیس مهدی) است.\n` +
      `درخواست عضویت به همراه مشخصات برای مهدی جان ارسال شد. به محض تایید در خدمتتون خواهم بود! ☕️`,
      { parse_mode: "HTML" }
    ).catch(() => {});

    // ارسال آلارم اختصاصی برای رئیس مهدی به همراه اطلاعات اد کننده و دکمه‌های تایید/خروج
    for (const adminId of CONFIG.ADMIN_IDS) {
      const kb = new InlineKeyboard()
        .text("✅ تایید و ماندن در گروه", `grp_accept:${chat.id}`)
        .text("🚪 رد و خروج از گروه", `grp_leave:${chat.id}`);

      const alertText = (
        `🚨 <b>درخواست عضویت ربات در گروه جدید!</b>\n\n` +
        `یکی از کاربران ربات را به یک گروه اضافه کرده است:\n\n` +
        `👥 <b>مشخصات گروه:</b>\n` +
        `• عنوان گروه: <b>${escapeHtml(chat.title || "بدون عنوان")}</b>\n` +
        `• آیدی گروه: <code>${chat.id}</code>\n` +
        `• نوع چت: <code>${chat.type}</code>\n\n` +
        `👤 <b>مشخصات فرد اضافه کننده:</b>\n` +
        `• نام: <b>${escapeHtml(addedByName)}</b>\n` +
        `• یوزرنیم: ${addedByUname ? `@${addedByUname}` : "<i>ندارد</i>"}\n` +
        `• آیدی عددی: <code>${addedBy.id}</code>\n\n` +
        `رئیس مهدی عزیز، آیا اجازه فعالیت ربات در این گروه را می‌دهید؟`
      );

      await ctx.api.sendMessage(adminId, alertText, {
        reply_markup: kb,
        parse_mode: "HTML",
      }).catch((e) => console.warn("Failed to notify admin of group invite:", e?.message));
    }
  } else if (status === "left" || status === "kicked") {
    setGroupStatus(chat.id, "left");
  }
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

bot.command(["music", "song", "ahang", "music@mazmazAgentBot"], async (ctx) => {
  const query = ctx.match?.trim();
  if (!query) {
    return ctx.reply(
      "🎵 <b>راهنمای دریافت موزیک:</b>\n\n" +
      "کافیه نام آهنگ، خواننده یا لینک را بعد از دستور وارد کنی:\n" +
      "• <code>/music شادمهر تقدیر</code>\n" +
      "• <code>/music Shape of You Ed Sheeran</code>\n" +
      "• <code>/music https://soundcloud.com/...</code>\n\n" +
      "⚡ فایل صوتی مستقیماً تا سقف ۵۰ مگابایت با بالاترین کیفیت در چت ارسال می‌شود.",
      { parse_mode: "HTML" }
    );
  }
  await sendMusicToTelegram(ctx, query);
});

// 1.1 دستور پاکسازی حافظه چت (/clear)
bot.command(["clear", "clear@mazmazAgentBot", "reset"], async (ctx) => {
  const chatId = ctx.chat.id;
  const userId = ctx.from?.id;

  clearChatContext(chatId);
  if (userId) {
    clearUserHistory(userId);
  }

  await ctx.reply(
    "🧹 <b>حافظه و زمینه گفتگو برای این چت با موفقیت پاکسازی شد!</b>\n\n" +
      "از این لحظه، هوش مصنوعی بدون پیش‌زمینه و سابقه قبلی پاسخ خواهد داد. 🚀",
    { parse_mode: "HTML" }
  );
});

// 1.2 دستور مشاهده لاگ تاریخچه گفتگو (/history)
bot.command(["history", "history@mazmazAgentBot"], async (ctx) => {
  const chatId = ctx.chat.id;
  const isGroup = chatId < 0;

  const kb = new InlineKeyboard()
    .text("📊 تولید دایجست و خلاصه گفتگو", `act_digest:${chatId}`)
    .row()
    .text("🧹 پاکسازی زمینه گفتگو (/clear)", "act_clear");

  if (isGroup) {
    const countRow = db.query("SELECT COUNT(*) as cnt FROM messages WHERE chat_id = ?").get(chatId) as any;
    const count = countRow?.cnt || 0;
    return ctx.reply(
      `📜 <b>تاریخچه پیام‌های ثبت‌شده گروه:</b>\n\n` +
        `• تعداد پیام‌های اخیر: <b>${count}</b> پیام\n\n` +
        `💡 جهت دریافت خلاصه تمیز و تحلیل تصمیمات چت، روی دکمه دایجست کلیک کنید:`,
      { reply_markup: kb, parse_mode: "HTML" }
    );
  } else {
    const userId = ctx.from!.id;
    const history = db
      .query("SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT 6")
      .all(userId) as any[];

    if (history.length === 0) {
      return ctx.reply("📜 تاریخچه گفتگوی شما در حال حاضر خالی است.", { reply_markup: kb });
    }

    const lines = history
      .reverse()
      .map(
        (h) =>
          `• <b>${h.role === "user" ? "شما" : "مزمز"}:</b> ${escapeHtml(h.content.slice(0, 120))}${
            h.content.length > 120 ? "..." : ""
          }`
      );

    return ctx.reply(`📜 <b>آخرین پیام‌های تبادل‌شده در گفتگو:</b>\n\n${lines.join("\n\n")}`, {
      reply_markup: kb,
      parse_mode: "HTML",
    });
  }
});

export const MODEL_DESCRIPTIONS: Record<string, { label: string; desc: string; icon: string }> = {
  "gemini-3.7-flash": { label: "3.7 Flash", desc: "مدل پرچمدار، تفکر تطبیقی و استدلال عمیق", icon: "💎" },
  "gemini-3.8-flash": { label: "3.8 Flash", desc: "جدیدترین مدل هوشمند با محاسبات پیشرفته", icon: "👑" },
  "gemini-3.5-flash": { label: "3.5 Flash", desc: "مدل همه‌کاره با پشتیبانی قوی از ابزارها و وب", icon: "🌟" },
  "gemini-3.5-flash-lite": { label: "3.5 Flash Lite", desc: "نسخه بسیار سبک، کم‌مصرف و سریع", icon: "⚡" },
  "gemini-3.6-flash": { label: "3.6 Flash", desc: "مدل نسل ۳.۶ پایدار و پرسرعت", icon: "🚀" },
  "gemini-flash-lite-latest": { label: "Flash Lite Latest", desc: "آخرین بیلد لایت با پینگ زیر ۱ ثانیه", icon: "🔥" },
  "gemini-3.1-flash-lite": { label: "3.1 Flash Lite", desc: "نسخه بهینه‌شده فوق‌سبک", icon: "💡" },
};

export const POWER_LEVELS: Record<string, { label: string; desc: string; icon: string; budget: number; speed: string }> = {
  low: {
    label: "کم / سرعتی (Low)",
    desc: "پاسخ فوری و آنی بدون تاخیر تفکر (بودجه تفکر ۰)",
    icon: "⚡",
    budget: 0,
    speed: "زیر ۱ ثانیه (~700ms)",
  },
  medium: {
    label: "متعادل (Medium)",
    desc: "تفکر متعادل، تحلیل و کیفیت پاسخ بالا (بودجه تفکر ۲۰۴۸)",
    icon: "⚖️",
    budget: 2048,
    speed: "۲ الی ۴ ثانیه",
  },
  high: {
    label: "عمیق / تحلیلی (High)",
    desc: "حداکثر قدرت استدلال، CoT و حل مسائل سخت (بودجه تفکر ۸۱۹۲)",
    icon: "🧠",
    budget: 8192,
    speed: "۱۰ الی ۲۰ ثانیه",
  },
};

export function buildModelAndPowerKeyboard(currentModel: string, currentPower: string): InlineKeyboard {
  const kb = new InlineKeyboard();

  // ۱. دکمه‌های انتخاب مدل (دو ستونه)
  const models = CONFIG.ALLOWED_MODELS.filter((m) => !isDeadModel(m));
  for (let i = 0; i < models.length; i += 2) {
    const m1 = models[i];
    const m2 = models[i + 1];

    const info1 = MODEL_DESCRIPTIONS[m1] || { label: m1, icon: "🤖" };
    const isCur1 = m1 === currentModel;
    kb.text(`${isCur1 ? "🔘 " : ""}${info1.icon} ${info1.label}`, `set_model:${m1}`);

    if (m2) {
      const info2 = MODEL_DESCRIPTIONS[m2] || { label: m2, icon: "🤖" };
      const isCur2 = m2 === currentModel;
      kb.text(`${isCur2 ? "🔘 " : ""}${info2.icon} ${info2.label}`, `set_model:${m2}`);
    }
    kb.row();
  }

  // ۲. سطح قدرت تفکر مدل (Thinking Level)
  kb.text("─── ⚡ سطح قدرت تفکر مدل (Thinking) ───", "noop_header").row();
  for (const [pKey, pInfo] of Object.entries(POWER_LEVELS)) {
    const isCurP = pKey === currentPower;
    kb.text(`${isCurP ? "🔘 " : ""}${pInfo.icon} ${pInfo.label.split("(")[0].trim()}`, `set_power:${pKey}`);
  }
  kb.row();

  // ۳. بازنشانی به پیش‌فرض
  kb.text("🔄 بازنشانی به پیش‌فرض (Reset)", "reset_model_override");

  return kb;
}

export function renderModelDashboardText(resolved: ModelResolution, power: string): string {
  const modelInfo = MODEL_DESCRIPTIONS[resolved.model] || { label: resolved.model, desc: "مدل سفارشی", icon: "🤖" };
  const powerInfo = POWER_LEVELS[power] || POWER_LEVELS.low;

  return (
    `🧠 <b>داشبورد انتخاب مدل و سطح قدرت تفکر هوش مصنوعی:</b>\n\n` +
    `• <b>مدل فعال:</b> ${modelInfo.icon} <code>${resolved.model}</code>\n` +
    `  ↳ <i>${modelInfo.desc}</i>\n` +
    `• <b>میزان تفکر و استدلال (Thinking):</b> ${powerInfo.icon} <b>${powerInfo.label}</b>\n` +
    `  ↳ <i>${powerInfo.desc}</i>\n` +
    `• <b>سرعت تخمینی پاسخ:</b> <code>${powerInfo.speed}</code>\n` +
    `• <b>منبع تعیین مدل:</b> <b>${resolved.source}</b>\n\n` +
    `💡 <i>می‌توانید مدل مورد نظر و میزان قدرت تفکر (Low / Medium / High) آن را از دکمه‌های زیر انتخاب کنید:</i>`
  );
}

export function matchModelName(input: string): string | null {
  const clean = input.trim().toLowerCase();
  for (const m of CONFIG.ALLOWED_MODELS) {
    if (m.toLowerCase() === clean) return m;
  }
  if (clean === "3.7" || clean === "3.7-flash" || clean === "flash-3.7") return "gemini-3.7-flash";
  if (clean === "3.8" || clean === "3.8-flash" || clean === "flash-3.8") return "gemini-3.8-flash";
  if (clean === "3.5" || clean === "3.5-flash" || clean === "flash-3.5") return "gemini-3.5-flash";
  if (clean === "3.5-lite" || clean === "lite" || clean === "flash-lite") return "gemini-3.5-flash-lite";
  if (clean === "3.6" || clean === "3.6-flash") return "gemini-3.6-flash";
  if (clean === "latest" || clean === "lite-latest") return "gemini-flash-lite-latest";
  if (clean === "3.1" || clean === "3.1-lite") return "gemini-3.1-flash-lite";
  return null;
}

// 1.3 دستور مشاهده و تغییر مدل هوش مصنوعی (/model)
bot.command(["model", "model@mazmazAgentBot"], async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) {
    return;
  }

  const rawArg = ctx.message?.text?.replace(/^\/model(@\w+)?/i, "").trim() || "";
  const resolved = getResolvedActiveModel();
  const currentPower = getActivePowerLevel();

  // الف: بازنشانی تنظیمات
  if (rawArg.toLowerCase() === "reset") {
    const oldModel = resolved.model;
    deleteSetting("ai_model");
    deleteSetting("ai_power_level");
    const newRes = getResolvedActiveModel();
    const newPower = getActivePowerLevel();
    console.log(`[ADMIN MODEL RESET] Admin ${fromId} reset model override at ${new Date().toISOString()} (was: ${oldModel}, now: ${newRes.model} from ${newRes.source})`);
    return ctx.reply(
      `🔄 <b>تنظیمات مدل و قدرت تفکر به حالت پیش‌فرض بازگشت:</b>\n\n` +
      `• مدل فعال جدید: <code>${newRes.model}</code>\n` +
      `• سطح تفکر: <code>${newPower}</code>\n` +
      `• منبع تعیین: <b>${newRes.source}</b>`,
      { parse_mode: "HTML" }
    );
  }

  // ب: ارسال آرگومان (مثلاً /model gemini-3.7-flash low یا /model 3.7 high یا /model med)
  if (rawArg) {
    const parts = rawArg.split(/\s+/).filter(Boolean);
    let matchedModel: string | null = null;
    let matchedPower: string | null = null;

    for (const p of parts) {
      const pLower = p.toLowerCase();
      if (pLower === "low" || pLower === "lite" || pLower === "turbo" || pLower === "1") {
        matchedPower = "low";
      } else if (pLower === "med" || pLower === "medium" || pLower === "normal" || pLower === "2") {
        matchedPower = "medium";
      } else if (pLower === "high" || pLower === "deep" || pLower === "pro" || pLower === "3") {
        matchedPower = "high";
      } else {
        const candidateModel = matchModelName(p);
        if (candidateModel) {
          matchedModel = candidateModel;
        }
      }
    }

    if (matchedModel || matchedPower) {
      if (matchedModel) {
        setSetting("ai_model", matchedModel);
      }
      if (matchedPower) {
        setSetting("ai_power_level", matchedPower);
      }
      const updatedRes = getResolvedActiveModel();
      const updatedPower = getActivePowerLevel();
      const pInfo = POWER_LEVELS[updatedPower];
      const mInfo = MODEL_DESCRIPTIONS[updatedRes.model] || { label: updatedRes.model, icon: "🤖" };

      console.log(`[ADMIN MODEL CHANGE] Admin ${fromId} set model to ${updatedRes.model} and power to ${updatedPower}`);
      return ctx.reply(
        `✅ <b>تنظیمات هوش مصنوعی با موفقیت به‌روز شد:</b>\n\n` +
        `• <b>مدل فعال:</b> ${mInfo.icon} <code>${updatedRes.model}</code>\n` +
        `• <b>سطح تفکر:</b> ${pInfo.icon} <b>${pInfo.label}</b>\n` +
        `• <b>سرعت تخمینی:</b> <code>${pInfo.speed}</code>\n` +
        `• <b>منبع:</b> <b>stored override</b>`,
        { parse_mode: "HTML" }
      );
    } else {
      return ctx.reply(
        `❌ <b>دستور یا نام مدل نامعتبر است!</b>\n\n` +
        `💡 <b>مثال‌های استفاده:</b>\n` +
        `• <code>/model 3.7 low</code> (مدل ۳.۷ با پاسخ فوری ⚡)\n` +
        `• <code>/model 3.7 high</code> (مدل ۳.۷ با استدلال عمیق 🧠)\n` +
        `• <code>/model low</code> یا <code>/model med</code> یا <code>/model high</code>\n` +
        `• <code>/model reset</code> (بازگشت به پیش‌فرض)`,
        { parse_mode: "HTML" }
      );
    }
  }

  // ج: بدون آرگومان -> نمایش داشبورد تعاملی کامل با دکمه‌ها
  const kb = buildModelAndPowerKeyboard(resolved.model, currentPower);
  const text = renderModelDashboardText(resolved, currentPower);
  await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
});

// 1.3.1 دستور اختصاصی تنظیم سطح قدرت تفکر و استدلال (/power یا /thinking)
bot.command(["power", "power@mazmazAgentBot", "thinking", "reasoning"], async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) return;

  const rawArg = ctx.message?.text?.replace(/^\/(power|thinking|reasoning)(@\w+)?/i, "").trim().toLowerCase() || "";
  if (rawArg === "low" || rawArg === "lite" || rawArg === "turbo" || rawArg === "1") {
    setSetting("ai_power_level", "low");
    return ctx.reply(`✅ سطح قدرت تفکر روی ⚡ <b>Low (کم / فوق‌سریع)</b> تنظیم شد.`, { parse_mode: "HTML" });
  }
  if (rawArg === "med" || rawArg === "medium" || rawArg === "normal" || rawArg === "2") {
    setSetting("ai_power_level", "medium");
    return ctx.reply(`✅ سطح قدرت تفکر روی ⚖️ <b>Medium (متعادل)</b> تنظیم شد.`, { parse_mode: "HTML" });
  }
  if (rawArg === "high" || rawArg === "deep" || rawArg === "pro" || rawArg === "3") {
    setSetting("ai_power_level", "high");
    return ctx.reply(`✅ سطح قدرت تفکر روی 🧠 <b>High (عمیق و تحلیلی)</b> تنظیم شد.`, { parse_mode: "HTML" });
  }

  const currentPower = getActivePowerLevel();
  const kb = new InlineKeyboard()
    .text(`${currentPower === "low" ? "🔘 " : ""}⚡ Low (فوق‌سریع - بودجه ۰)`, "set_power:low").row()
    .text(`${currentPower === "medium" ? "🔘 " : ""}⚖️ Medium (متعادل - بودجه ۲۰۴۸)`, "set_power:medium").row()
    .text(`${currentPower === "high" ? "🔘 " : ""}🧠 High (عمیق - بودجه ۸۱۹۲)`, "set_power:high");

  const pInfo = POWER_LEVELS[currentPower];
  await ctx.reply(
    `⚡ <b>تنظیم میزان قدرت تفکر و استدلال (Thinking Level):</b>\n\n` +
    `• سطح فعلی: ${pInfo.icon} <b>${pInfo.label}</b>\n` +
    `• سرعت تخمینی: <code>${pInfo.speed}</code>\n` +
    `• توضیح: <i>${pInfo.desc}</i>\n\n` +
    `سطح مورد نظر را انتخاب کنید:`,
    { reply_markup: kb, parse_mode: "HTML" }
  );
});

// 1.4 دستور تنظیم میزان خلاقیت پاسخ‌ها (/temp)
bot.command(["temp", "temp@mazmazAgentBot", "temperature"], async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) {
    return;
  }

  const rawArg = ctx.message?.text?.replace(/^\/temp(erature)?(@\w+)?/i, "").trim() || "";
  if (rawArg) {
    const val = parseFloat(rawArg);
    if (isNaN(val) || val < 0.0 || val > 2.0) {
      return ctx.reply("❌ مقدار دما باید یک عدد معتبر بین <code>0.0</code> تا <code>2.0</code> باشد.", { parse_mode: "HTML" });
    }
    const oldTemp = getSetting("ai_temperature", "0.7");
    setSetting("ai_temperature", String(val));
    console.log(`[ADMIN TEMP CHANGE] Admin ${fromId} changed temperature from ${oldTemp} to ${val} at ${new Date().toISOString()}`);
    return ctx.reply(`✅ <b>دمای خلاقیت روی <code>${val}</code> تنظیم شد.</b>`, { parse_mode: "HTML" });
  }

  const currentTemp = getSetting("ai_temperature", "0.7");
  const kb = new InlineKeyboard()
    .text("🎯 دقیق و فنی (0.2)", "set_temp:0.2")
    .row()
    .text("⚖️ متعادل و استاندارد (0.7)", "set_temp:0.7")
    .row()
    .text("🎭 خلاقانه و منعطف (1.0)", "set_temp:1.0");

  await ctx.reply(
    `🌡️ <b>تنظیم دمای خلاقیت (Creativity Temperature):</b>\n\n` +
    `• مقدار فعلی: <code>${currentTemp}</code>\n\n` +
    `بازه مجاز: <code>0.0</code> (کاملاً قطعی و فنی) تا <code>2.0</code> (نهایت خلاقیت و تصادفی):`,
    { reply_markup: kb, parse_mode: "HTML" }
  );
});

// 1.5 دستور تغییر زبان ربات (/lang)
bot.command(["lang", "lang@mazmazAgentBot", "language"], async (ctx) => {
  const currentLang = getSetting("bot_language", "fa");
  const kb = new InlineKeyboard()
    .text("🇮🇷 فارسی (پیش‌فرض)", "set_lang:fa")
    .text("🇬🇧 English", "set_lang:en");

  await ctx.reply(
    `🌐 <b>انتخاب زبان کاری ربات (Language):</b>\n\n` +
      `• زبان فعلی: <b>${currentLang === "fa" ? "فارسی 🇮🇷" : "English 🇬🇧"}</b>`,
    { reply_markup: kb, parse_mode: "HTML" }
  );
});

// 1.6 دستور مشاهده و تنظیم پرامپت سیستمی و قوانین پویا (/system)
bot.command(["system", "system@mazmazAgentBot", "prompt"], async (ctx) => {
  const customPrompt = getSetting("custom_instruction", "");
  const approvedRules = getApprovedRules();

  let text = `⚙️ <b>دستورالعمل سیستمی و قوانین حافظه زنده:</b>\n\n`;
  text += `📝 <b>دستورالعمل اختصاصی ادمین:</b>\n${
    customPrompt ? `<code>${escapeHtml(customPrompt)}</code>` : "<i>تنظیم نشده (پیش‌فرض سیستم)</i>"
  }\n\n`;

  text += `📋 <b>قوانین تاییدشده حافظه پویا (${approvedRules.length} قانون فعال):</b>\n`;
  if (approvedRules.length === 0) {
    text += "<i>هنوز قانون پویایی تایید نشده است.</i>\n";
  } else {
    for (const r of approvedRules) {
      text += `• <b>${escapeHtml(r.key)}:</b> <code>${escapeHtml(r.value.slice(0, 100))}</code>\n`;
    }
  }

  const kb = new InlineKeyboard();
  if (customPrompt) {
    kb.text("🗑️ بازنشانی پرامپت ادمین", "reset_sysprompt");
  }

  await ctx.reply(text, {
    reply_markup: kb.inline_keyboard.length > 0 ? kb : undefined,
    parse_mode: "HTML",
  });
});

// 1.7 منوی تعاملی تنظیمات (/settings)
bot.command(["settings", "settings@mazmazAgentBot"], async (ctx) => {
  const resolved = getResolvedActiveModel();
  const power = getActivePowerLevel();
  const temp = getSetting("ai_temperature", "0.7");
  const lang = getSetting("bot_language", "fa");
  const rulesCount = getApprovedRules().length;

  const powerInfo = POWER_LEVELS[power] || POWER_LEVELS.low;
  const modelInfo = MODEL_DESCRIPTIONS[resolved.model] || { label: resolved.model, icon: "🤖" };

  const kb = new InlineKeyboard()
    .text("🧠 تغییر مدل", "cmd_menu_model")
    .text("⚡ قدرت تفکر", "cmd_menu_power")
    .row()
    .text("🌡️ دمای خلاقیت", "cmd_menu_temp")
    .text("🌐 انتخاب زبان", "cmd_menu_lang")
    .row()
    .text("📋 قوانین حافظه", "cmd_menu_system")
    .text("🧹 پاکسازی کانتکست چت", "act_clear");

  await ctx.reply(
    `🛠️ <b>داشبورد تنظیمات تعاملی ربات مزمز:</b>\n\n` +
      `• <b>مدل هوش مصنوعی:</b> ${modelInfo.icon} <code>${resolved.model}</code>\n` +
      `• <b>سطح تفکر و استدلال:</b> ${powerInfo.icon} <b>${powerInfo.label}</b>\n` +
      `• <b>دمای خلاقیت:</b> <code>${temp}</code>\n` +
      `• <b>زبان پاسخگویی:</b> <code>${lang === "fa" ? "فارسی 🇮🇷" : "English 🇬🇧"}</code>\n` +
      `• <b>قوانین حافظه زنده:</b> <code>${rulesCount} قانون فعال</code>\n\n` +
      `جهت ویرایش هر بخش، روی دکمه مربوطه کلیک کنید:`,
    { reply_markup: kb, parse_mode: "HTML" }
  );
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

async function renderLogsOverview(ctx: any, isEdit = false) {
  const recentUsers = getUsersWithRecentChat(8);
  const recentMsgs = getRecentGlobalLogs(5);

  let text = "📜 <b>مرکز پایش لاگ گفتگوهای کاربران:</b>\n\n";

  if (recentUsers.length === 0) {
    text += "<i>هنوز هیچ پیامی در تاریخچه گفتگوها ثبت نشده است.</i>\n";
  } else {
    text += "👥 <b>کاربران با آخرین تعاملات:</b>\n";
    for (const u of recentUsers) {
      const uname = u.username ? `@${u.username}` : "بدون یوزرنیم";
      text += `• <b>${escapeHtml(u.first_name || "کاربر")}</b> (${uname}) | آیدی: <code>${u.user_id}</code> | پیام‌ها: <b>${u.msg_count}</b>\n`;
    }

    text += "\n⚡ <b>۵ پیام اخیر در کل سیستم:</b>\n";
    for (const m of recentMsgs) {
      const sender = m.role === "user" ? `👤 ${escapeHtml(m.first_name || String(m.user_id))}` : "🤖 بات";
      const snippet = escapeHtml(m.content.length > 50 ? m.content.slice(0, 50) + "..." : m.content);
      text += `• <b>${sender}</b>: <i>${snippet}</i>\n`;
    }
  }

  text += "\n💡 <i>می‌توانید برای مشاهده لاگ یک کاربر خاص دستور زیر را بفرستید:</i>\n" +
          "<code>/logs USER_ID [تعداد]</code>\n" +
          "یا از دکمه‌های زیر برای انتخاب سریع استفاده کنید:";

  const kb = new InlineKeyboard();
  for (const u of recentUsers.slice(0, 6)) {
    const name = `${u.first_name || ""} ${u.username ? `(@${u.username})` : ""}`.trim() || String(u.user_id);
    kb.text(`📜 ${name.slice(0, 22)}`, `u_logs:${u.user_id}:15`).row();
  }
  kb.text("🔄 مشاهده ۱۵ پیام اخیر عمومی", "logs_recent").row();
  kb.text("🔙 بازگشت به پنل مدیریت", "menu_admin");

  if (isEdit) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

async function renderUserLogsView(ctx: any, targetId: number, count = 15, isEdit = false) {
  const user = getUserById(targetId);
  const logs = getUserDetailedLogs(targetId, count);
  const totalCount = getUserMessageCount(targetId);

  const uname = user?.username ? `@${user.username}` : "ندارد";
  const name = user ? `${user.first_name} ${user.last_name || ""}`.trim() : `کاربر ${targetId}`;

  if (logs.length === 0) {
    const emptyText = `📜 <b>لاگ گفتگوی کاربر:</b>\n\n` +
      `• نام: <b>${escapeHtml(name)}</b> (<code>${targetId}</code>)\n` +
      `• یوزرنیم: <b>${uname}</b>\n\n` +
      `<i>هیچ پیامی برای این کاربر در پایگاه‌داده یافت نشد.</i>`;

    const kb = new InlineKeyboard()
      .text("💬 ارسال پیام به کاربر", `reply_u:${targetId}`)
      .row()
      .text("🔙 بازگشت به لیست کاربران", "admin_users");

    if (isEdit) {
      await ctx.editMessageText(emptyText, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
    } else {
      await ctx.reply(emptyText, { reply_markup: kb, parse_mode: "HTML" });
    }
    return;
  }

  // Format messages chronologically (logs query returns ORDER BY id DESC, so reverse for natural reading)
  const chronoLogs = [...logs].reverse();

  let text = `📜 <b>لاگ گفتگوی کاربر:</b> <b>${escapeHtml(name)}</b>\n` +
    `• آیدی: <code>${targetId}</code> | یوزرنیم: <b>${uname}</b>\n` +
    `• نمایش <b>${chronoLogs.length}</b> پیام از کل <b>${totalCount}</b> پیام ثبت شده:\n\n` +
    `────────────────────\n`;

  for (const item of chronoLogs) {
    const isUser = item.role === "user";
    const icon = isUser ? "👤 <b>کاربر:</b>" : "🤖 <b>مزمز:</b>";
    const timeStr = item.created_at ? ` <i>(${item.created_at})</i>` : "";
    const cleanContent = escapeHtml(item.content.length > 500 ? item.content.slice(0, 500) + "..." : item.content);
    text += `${icon}${timeStr}\n${cleanContent}\n\n`;
  }
  text += `────────────────────`;

  const kb = new InlineKeyboard()
    .text("➕ ۱۰ سهمیه", `q_add:${targetId}:10`)
    .text("💬 ارسال پیام", `reply_u:${targetId}`)
    .row()
    .text("🔄 به‌روزرسانی لاگ", `u_logs:${targetId}:${count}`)
    .text("👤 پروفایل کاربر", `u_detail:${targetId}`)
    .row()
    .text("📜 مرکز لاگ‌ها", "admin_logs_menu")
    .text("🔙 پنل ادمین", "menu_admin");

  if (text.length <= 4000) {
    if (isEdit) {
      await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(async () => {
        await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
      });
    } else {
      await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
    }
  } else {
    if (isEdit) {
      await ctx.deleteMessage().catch(() => {});
    }
    await sendSafeMessage(ctx, text, { parse_mode: "HTML" });
    await ctx.reply("🛠️ <b>عملیات مدیریتی برای این کاربر:</b>", { reply_markup: kb, parse_mode: "HTML" });
  }
}

async function renderAdminGroups(ctx: any, isEdit = false) {
  const groups = getAllGroups();
  let text = "👥 <b>لیست و نظارت بر گروه‌های مزمز:</b>\n\n";

  if (groups.length === 0) {
    text += (
      `<i>هنوز گروهی در دیتابیس ثبت نشده است.</i>\n\n` +
      `💡 <b>چرا گروه‌های قبلی هنوز در لیست نیستند؟</b>\n` +
      `طبق معماری امنیتی تلگرام، ربات‌ها (برعکس کاربران عادی) متدی برای خواندن یک‌جای لیست گروه‌های گذشته خود ندارند (Telegram Bot API فاقد متد <code>getChats</code> است).\n\n` +
      `🚀 <b>۳ روش فوق‌العاده سریع برای ثبت و دیدن گروه‌ها:</b>\n` +
      `۱️⃣ <b>سریع‌ترین راه (فوروارد):</b> کافیست یک پیام از گروه موردنظر را به همین پی‌وی ربات فوروارد کنید تا درجا شناسایی و فعال شود!\n` +
      `۲️⃣ <b>ارسال پیام در گروه:</b> با ارسال یک پیام، صدا زدن <code>مزمز</code> یا یک دستور در گروه، ربات آن را خودکار ثبت می‌کند.\n` +
      `۳️⃣ <b>دستور دستی:</b> با دستور <code>/addgroup &lt;chat_id&gt;</code> گروه را بر اساس آیدی عددی ثبت کنید.`
    );
  } else {
    for (const g of groups.slice(0, 10)) {
      const statusIcon = g.status === "approved" ? "✅ تایید شده" : g.status === "pending" ? "⏳ در انتظار تایید" : "🚪 خارج شده";
      text += `• <b>${escapeHtml(g.title)}</b>\n  آیدی: <code>${g.chat_id}</code> | وضعیت: <b>${statusIcon}</b>\n`;
      if (g.added_by_name) {
        text += `  ثبت‌کننده: ${escapeHtml(g.added_by_name)} (${g.added_by_username ? `@${g.added_by_username}` : `<code>${g.added_by_id}</code>`})\n`;
      }
      text += "\n";
    }
  }

  const kb = new InlineKeyboard();
  for (const g of groups.slice(0, 8)) {
    const icon = g.status === "approved" ? "✅" : g.status === "pending" ? "⏳" : "🚪";
    kb.text(`${icon} ${g.title.slice(0, 20)}`, `grp_detail:${g.chat_id}`).row();
  }
  kb.text("🔄 به‌روزرسانی لیست", "admin_groups");
  kb.text("🔙 بازگشت به پنل ادمین", "menu_admin");

  if (isEdit) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}

bot.command(["admin", "admin@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    return ctx.reply("⛔ شما دسترسی به پنل مدیریت ندارید.");
  }
  const kb = new InlineKeyboard()
    .text("📊 آمار و ارقام ربات", "admin_stats")
    .text("👥 مدیریت کاربران و سهمیه‌ها", "admin_users")
    .row()
    .text("👥 مدیریت گروه‌ها", "admin_groups")
    .text("📜 لاگ گفتگوهای کاربران", "admin_logs_menu")
    .row()
    .text("🔙 بازگشت به منوی اصلی", "menu_home");

  await ctx.reply("👑 <b>پنل مدیریت اختصاصی ربات mazmaz:</b>", {
    reply_markup: kb,
    parse_mode: "HTML",
  });
});

bot.command(["groups", "groups@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    return ctx.reply("⛔ دسترسی غیرمجاز. این بخش فقط مختص رئیس مهدی است.");
  }
  return await renderAdminGroups(ctx);
});

bot.command(["addgroup", "addgroup@mazmazAgentBot"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    return ctx.reply("⛔ این دستور منحصراً متعلق به رئیس مهدی است.");
  }

  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetIdStr = parts[1];
  const customTitle = parts.slice(2).join(" ");

  if (!targetIdStr) {
    return ctx.reply(
      `💡 <b>راهنمای ثبت دستی گروه:</b>\n\n` +
      `کافیست آیدی عددی گروه (معمولاً با <code>-100</code> شروع می‌شود) را وارد کنید:\n` +
      `<code>/addgroup -1001234567890 [عنوان دلخواه]</code>\n\n` +
      `<i>نکته: سریع‌ترین راه اینه که یه پیام از گروه رو به پی‌وی من فوروارد کنی تا درجا ثبت بشه!</i>`,
      { parse_mode: "HTML" }
    );
  }

  const chatId = parseInt(targetIdStr, 10);
  if (isNaN(chatId)) {
    return ctx.reply("⚠️ آیدی عددی گروه نامعتبر است. آیدی گروه‌ها معمولاً عددی منفی هستند.", { parse_mode: "HTML" });
  }

  let finalTitle = customTitle;
  let chatType = "supergroup";

  // استعلام زنده مشخصات گروه از API تلگرام
  try {
    const chatInfo = (await ctx.api.getChat(chatId)) as any;
    if (chatInfo.title && !customTitle) {
      finalTitle = chatInfo.title;
    }
    if (chatInfo.type) {
      chatType = chatInfo.type;
    }
  } catch (e: any) {
    console.warn(`Could not fetch chat info for ${chatId}:`, e?.message);
  }

  registerOrUpdateGroup(
    chatId,
    finalTitle || `گروه ${chatId}`,
    chatType,
    ctx.from!.id,
    "رئیس مهدی (ثبت دستی)",
    ctx.from?.username || "",
    "approved"
  );

  const kb = new InlineKeyboard()
    .text("👥 لیست گروه‌ها", "admin_groups")
    .text("🔍 جزئیات این گروه", `grp_detail:${chatId}`);

  await ctx.reply(
    `✅ <b>گروه با موفقیت ثبت و تایید شد!</b>\n\n` +
    `• عنوان گروه: <b>${escapeHtml(finalTitle || String(chatId))}</b>\n` +
    `• آیدی عددی: <code>${chatId}</code>\n` +
    `• نوع چت: <code>${chatType}</code>\n` +
    `• وضعیت: ✅ <b>فعال و تایید شده</b>`,
    { reply_markup: kb, parse_mode: "HTML" }
  );
});

bot.command(["logs", "logs@mazmazAgentBot", "userlogs"], async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    return ctx.reply("⛔ دسترسی غیرمجاز. این بخش فقط مختص رئیس مهدی است.");
  }

  const parts = ctx.message?.text?.trim().split(/\s+/) || [];
  const targetId = parseInt(parts[1], 10);
  const count = parseInt(parts[2], 10) || 15;

  if (targetId && !isNaN(targetId)) {
    return await renderUserLogsView(ctx, targetId, count);
  }

  return await renderLogsOverview(ctx);
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



// 2.5 تشخیص هوشمند فوروارد پیام از گروه به پی‌وی توسط رئیس مهدی جهت ثبت و فعال‌سازی فوری گروه
bot.on("message", async (ctx, next) => {
  const isPrivate = ctx.chat?.type === "private";
  const userId = ctx.from?.id;
  const isAdmin = userId && CONFIG.ADMIN_IDS.includes(userId);

  if (isAdmin && isPrivate && ctx.message) {
    const msg = ctx.message as any;
    let forwardChat = msg.forward_from_chat;
    if (!forwardChat && msg.forward_origin && typeof msg.forward_origin === "object") {
      if (msg.forward_origin.type === "chat" || msg.forward_origin.type === "channel") {
        forwardChat = msg.forward_origin.chat;
      }
    }

    if (forwardChat && (forwardChat.type === "group" || forwardChat.type === "supergroup" || forwardChat.type === "channel")) {
      const chatId = forwardChat.id;
      const title = forwardChat.title || "گروه بدون عنوان";

      registerOrUpdateGroup(
        chatId,
        title,
        forwardChat.type,
        userId,
        "رئیس مهدی (ثبت با فوروارد)",
        ctx.from?.username || "",
        "approved"
      );

      const kb = new InlineKeyboard()
        .text("👥 مشاهده در لیست گروه‌ها", "admin_groups")
        .row()
        .text("🔍 جزئیات این گروه", `grp_detail:${chatId}`)
        .text("🚪 خروج از این گروه", `grp_leave:${chatId}`);

      await ctx.reply(
        `🎉 <b>گروه با موفقیت شناسایی و ثبت شد!</b>\n\n` +
        `• عنوان گروه: <b>${escapeHtml(title)}</b>\n` +
        `• آیدی عددی: <code>${chatId}</code>\n` +
        `• نوع چت: <code>${forwardChat.type}</code>\n` +
        `• وضعیت: ✅ <b>تایید شده و فعال</b>\n\n` +
        `این گروه به دیتابیس افزوده شد و اکنون در منوی /groups قابل مدیریت است! 🚀`,
        { reply_markup: kb, parse_mode: "HTML" }
      );
      return;
    }
  }

  await next();
});

// 3. Register Photo & Vision Handler
bot.on("message:photo", handlePhotoMessage);

// 3.5 هندلر ریاکشن خودکار برای پیام‌های خداحافظی و درود
bot.hears(/(?:^|\s|[،.؟!])(خداحافظ|خدافظ|بای|بای\s?بای|فعلا|فعلاً|شب\s?بخیر|شبخیر|شب\s?خوش|درود|بدرود)(?:$|\s|[،.؟!])/ui, async (ctx, next) => {
  try {
    await ctx.react("👋");
  } catch (err) {
    // نادیده گرفتن خطاهای عدم دسترسی ریاکشن در گروه
  }
  return next();
});

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

// هندلرهای قوانین حافظه پویا (Human-in-the-Loop)
bot.callbackQuery(/^approve_rule:(\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    return ctx.answerCallbackQuery({ text: "فقط ادمین ربات مجاز به تایید قوانین است.", show_alert: true });
  }
  const ruleId = parseInt(ctx.match[1], 10);
  const rule = getRuleById(ruleId);
  approveRule(ruleId);

  await ctx.editMessageText(
    `✅ <b>قانون رفتاری با موفقیت تایید و فعال شد!</b>\n\n` +
      `🔑 <b>شناسه:</b> <code>${rule?.key || ruleId}</code>\n` +
      `📝 <b>دستورالعمل:</b>\n${rule?.value || ""}\n\n` +
      `<i>از این پس این دستورالعمل به تمام پرامپت‌های بعدی هوش مصنوعی تزریق خواهد شد.</i>`,
    { parse_mode: "HTML" }
  ).catch(() => {});
  await ctx.answerCallbackQuery({ text: "قانون تایید و به حافظه هوش مصنوعی اضافه شد! ✅" });
});

bot.callbackQuery(/^reject_rule:(\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) {
    return ctx.answerCallbackQuery({ text: "فقط ادمین ربات مجاز به لغو قوانین است.", show_alert: true });
  }
  const ruleId = parseInt(ctx.match[1], 10);
  const rule = getRuleById(ruleId);
  rejectRule(ruleId);

  await ctx.editMessageText(
    `❌ <b>پیشنهاد قانون «${rule?.key || ruleId}» رد و از پایگاه داده حذف گردید.</b>`,
    { parse_mode: "HTML" }
  ).catch(() => {});
  await ctx.answerCallbackQuery({ text: "پیشنهاد قانون لغو شد. ❌" });
});

// دایجست چت و خلاصه سریع
bot.callbackQuery(/^act_digest:(-?\d+)$/, async (ctx) => {
  const chatId = parseInt(ctx.match[1], 10);
  await ctx.answerCallbackQuery({ text: "در حال تولید دایجست و خلاصه گفتگو... ⏳" });
  await ctx.reply("📊 <i>در حال استخراج پیام‌های کلیدی و تولید دایجست با هوش مصنوعی... ⏳</i>", { parse_mode: "HTML" });
  const digest = await generateChatDigest(chatId, 100);
  await ctx.reply(`📊 <b>دایجست پیام‌های اخیر گفتگو:</b>\n\n${digest}`, { parse_mode: "HTML" });
});

// اکشن پاکسازی سریع (/clear)
bot.callbackQuery("act_clear", async (ctx) => {
  const chatId = ctx.chat?.id || ctx.from!.id;
  clearChatContext(chatId);
  clearUserHistory(ctx.from!.id);
  await ctx.answerCallbackQuery({ text: "حافظه چت پاکسازی شد! 🧹" });
  await ctx.reply("🧹 <b>حافظه و زمینه گفتگو برای این چت با موفقیت ریست شد!</b>", { parse_mode: "HTML" });
});

// دکمه‌های منوی تنظیمات
// دکمه‌های منوی تنظیمات مدل، سطح قدرت تفکر و دما
bot.callbackQuery(/^set_model:(.+)$/, async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) {
    return ctx.answerCallbackQuery({ text: "تنظیم مدل فقط توسط ادمین امکان‌پذیر است.", show_alert: true });
  }
  const newModel = ctx.match[1].trim();
  if (!CONFIG.ALLOWED_MODELS.includes(newModel) || isDeadModel(newModel)) {
    return ctx.answerCallbackQuery({ text: "این مدل در لیست مجاز تعریف نشده است.", show_alert: true });
  }
  const oldModel = getResolvedActiveModel().model;
  setSetting("ai_model", newModel);
  const updatedRes = getResolvedActiveModel();
  const currentPower = getActivePowerLevel();
  const mInfo = MODEL_DESCRIPTIONS[newModel] || { label: newModel, icon: "🤖" };
  console.log(`[ADMIN MODEL CHANGE] Admin ${fromId} changed model from ${oldModel} to ${newModel} at ${new Date().toISOString()}`);

  const kb = buildModelAndPowerKeyboard(updatedRes.model, currentPower);
  const text = renderModelDashboardText(updatedRes, currentPower);

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery({ text: `مدل فعال به ${mInfo.label} تغییر یافت.` });
});

bot.callbackQuery(/^set_power:(low|medium|high)$/, async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) {
    return ctx.answerCallbackQuery({ text: "تنظیم سطح تفکر فقط توسط ادمین امکان‌پذیر است.", show_alert: true });
  }
  const newPower = ctx.match[1].trim();
  setSetting("ai_power_level", newPower);
  const updatedRes = getResolvedActiveModel();
  const pInfo = POWER_LEVELS[newPower] || POWER_LEVELS.low;
  console.log(`[ADMIN POWER CHANGE] Admin ${fromId} changed power level to ${newPower} at ${new Date().toISOString()}`);

  const kb = buildModelAndPowerKeyboard(updatedRes.model, newPower);
  const text = renderModelDashboardText(updatedRes, newPower);

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery({ text: `سطح تفکر به ${pInfo.label} تنظیم شد.` });
});

bot.callbackQuery("reset_model_override", async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) return;
  const oldModel = getResolvedActiveModel().model;
  deleteSetting("ai_model");
  deleteSetting("ai_power_level");
  const newRes = getResolvedActiveModel();
  const newPower = getActivePowerLevel();
  console.log(`[ADMIN MODEL RESET] Admin ${fromId} reset model override at ${new Date().toISOString()} (was: ${oldModel}, now: ${newRes.model} from ${newRes.source})`);

  const kb = buildModelAndPowerKeyboard(newRes.model, newPower);
  const text = renderModelDashboardText(newRes, newPower);

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery({ text: "تنظیمات مدل و قدرت تفکر ریست شد." });
});

bot.callbackQuery("noop_header", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "از دکمه‌های زیر برای تعیین سطح قدرت تفکر مدل استفاده کنید." });
});

// B5: تایید یا رد پیشنهاد تغییر مدل توسط ابزار هوش مصنوعی
bot.callbackQuery(/^approve_model:(.+)$/, async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) {
    return ctx.answerCallbackQuery({ text: "فقط ادمین ربات مجاز به تایید تغییر مدل است.", show_alert: true });
  }
  const targetModel = ctx.match[1].trim();
  if (!CONFIG.ALLOWED_MODELS.includes(targetModel) || isDeadModel(targetModel)) {
    return ctx.answerCallbackQuery({ text: "مدل پیشنهادی در لیست مجاز قرار ندارد.", show_alert: true });
  }
  const oldModel = getResolvedActiveModel().model;
  setSetting("ai_model", targetModel);
  console.log(`[ADMIN MODEL APPROVED] Admin ${fromId} approved model change from ${oldModel} to ${targetModel} at ${new Date().toISOString()}`);
  await ctx.editMessageText(`✅ <b>تغییر مدل به <code>${targetModel}</code> تایید و ذخیره شد.</b>\nمنبع: <b>stored override</b>`, { parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery({ text: `مدل به ${targetModel} تغییر یافت.` });
});

bot.callbackQuery("reject_model", async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) return;
  await ctx.editMessageText("❌ <b>پیشنهاد تغییر مدل توسط ادمین لغو شد.</b>", { parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery({ text: "پیشنهاد تغییر مدل رد شد." });
});

bot.callbackQuery(/^set_temp:([0-9.]+)$/, async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId || !CONFIG.ADMIN_IDS.includes(fromId)) {
    return ctx.answerCallbackQuery({ text: "تنظیم دما فقط توسط ادمین امکان‌پذیر است.", show_alert: true });
  }
  const newTemp = parseFloat(ctx.match[1]);
  if (isNaN(newTemp) || newTemp < 0.0 || newTemp > 2.0) {
    return ctx.answerCallbackQuery({ text: "مقدار دما باید بین 0.0 تا 2.0 باشد.", show_alert: true });
  }
  setSetting("ai_temperature", String(newTemp));
  await ctx.editMessageText(`✅ <b>دمای خلاقیت با موفقیت روی <code>${newTemp}</code> تنظیم شد.</b>`, { parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery({ text: `دما به ${newTemp} تنظیم شد.` });
});

bot.callbackQuery(/^set_lang:(fa|en)$/, async (ctx) => {
  const newLang = ctx.match[1];
  setSetting("bot_language", newLang);
  await ctx.editMessageText(`✅ <b>زبان کاری به ${newLang === "fa" ? "فارسی 🇮🇷" : "English 🇬🇧"} تغییر یافت.</b>`, { parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery({ text: "زبان تغییر یافت." });
});

bot.callbackQuery("reset_sysprompt", async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  setSetting("custom_instruction", "");
  await ctx.editMessageText("🗑️ <b>دستورالعمل اختصاصی ادمین ریست شد و به حالت پیش‌فرض بازگشت.</b>", { parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery({ text: "پرامپت ریست شد." });
});

bot.callbackQuery("cmd_menu_model", async (ctx) => {
  const resolved = getResolvedActiveModel();
  const power = getActivePowerLevel();
  const kb = buildModelAndPowerKeyboard(resolved.model, power);
  const text = renderModelDashboardText(resolved, power);

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("cmd_menu_power", async (ctx) => {
  const currentPower = getActivePowerLevel();
  const kb = new InlineKeyboard()
    .text(`${currentPower === "low" ? "🔘 " : ""}⚡ Low (فوق‌سریع - بودجه ۰)`, "set_power:low").row()
    .text(`${currentPower === "medium" ? "🔘 " : ""}⚖️ Medium (متعادل - بودجه ۲۰۴۸)`, "set_power:medium").row()
    .text(`${currentPower === "high" ? "🔘 " : ""}🧠 High (عمیق - بودجه ۸۱۹۲)`, "set_power:high").row()
    .text("🔙 بازگشت به داشبورد مدل", "cmd_menu_model");

  const pInfo = POWER_LEVELS[currentPower];
  await ctx.editMessageText(
    `⚡ <b>تنظیم میزان قدرت تفکر و استدلال (Thinking Level):</b>\n\n` +
    `• سطح فعلی: ${pInfo.icon} <b>${pInfo.label}</b>\n` +
    `• سرعت تخمینی: <code>${pInfo.speed}</code>\n` +
    `• توضیح: <i>${pInfo.desc}</i>\n\n` +
    `سطح مورد نظر را انتخاب کنید:`,
    { reply_markup: kb, parse_mode: "HTML" }
  ).catch(() => {});
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("cmd_menu_temp", async (ctx) => {
  const kb = new InlineKeyboard()
    .text("🎯 دقیق (0.2)", "set_temp:0.2")
    .text("⚖️ متعادل (0.7)", "set_temp:0.7")
    .text("🎭 خلاق (1.0)", "set_temp:1.0");
  await ctx.editMessageText("🌡️ <b>میزان دمای خلاقیت را تعیین کنید:</b>", { reply_markup: kb, parse_mode: "HTML" });
});

bot.callbackQuery("cmd_menu_lang", async (ctx) => {
  const kb = new InlineKeyboard()
    .text("🇮🇷 فارسی", "set_lang:fa")
    .text("🇬🇧 English", "set_lang:en");
  await ctx.editMessageText("🌐 <b>زبان مورد نظر خود را انتخاب کنید:</b>", { reply_markup: kb, parse_mode: "HTML" });
});

bot.callbackQuery("cmd_menu_system", async (ctx) => {
  const approvedRules = getApprovedRules();
  let text = `📋 <b>قوانین حافظه زنده (${approvedRules.length} قانون):</b>\n\n`;
  if (approvedRules.length === 0) {
    text += "<i>هیچ قانونی ثبت نشده است. با گفتگوی زبانی می‌توانید از مزمز بخواهید قانونی پیشنهاد دهد.</i>";
  } else {
    for (const r of approvedRules) {
      text += `• <b>${escapeHtml(r.key)}:</b> <code>${escapeHtml(r.value.slice(0, 80))}</code>\n`;
    }
  }
  await ctx.editMessageText(text, { parse_mode: "HTML" });
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
    .text("👥 مدیریت گروه‌ها", "admin_groups")
    .text("📜 لاگ گفتگوهای کاربران", "admin_logs_menu")
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
    "👥 <b>مدیریت کاربران و سهمیه‌ها:</b>\nبرای ویرایش سهمیه، میوت، بن یا مشاهده لاگ، کاربر مورد نظر را انتخاب کنید:\n",
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
    .text("📜 مشاهده لاگ پیام‌ها", `u_logs:${targetId}:15`)
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
    .text("📜 مشاهده لاگ پیام‌ها", `u_logs:${targetId}:15`)
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

bot.callbackQuery(/^u_logs:(\d+)(?::(\d+))?$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const targetId = parseInt(ctx.match[1], 10);
  const count = ctx.match[2] ? parseInt(ctx.match[2], 10) : 15;
  await renderUserLogsView(ctx, targetId, count, true);
  await ctx.answerCallbackQuery().catch(() => {});
});

bot.callbackQuery("admin_logs_menu", async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  await renderLogsOverview(ctx, true);
  await ctx.answerCallbackQuery().catch(() => {});
});

bot.callbackQuery("logs_recent", async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const recentMsgs = getRecentGlobalLogs(15);
  let text = "⚡ <b>۱۵ پیام اخیر ثبت‌شده در کل سیستم:</b>\n\n";
  if (recentMsgs.length === 0) {
    text += "<i>هیچ پیامی ثبت نشده است.</i>";
  } else {
    for (const m of [...recentMsgs].reverse()) {
      const sender = m.role === "user" ? `👤 <b>${escapeHtml(m.first_name || String(m.user_id))}</b> (<code>${m.user_id}</code>)` : "🤖 <b>مزمز</b>";
      const timeStr = m.created_at ? ` <i>(${m.created_at})</i>` : "";
      const snippet = escapeHtml(m.content.length > 200 ? m.content.slice(0, 200) + "..." : m.content);
      text += `${sender}${timeStr}:\n${snippet}\n\n`;
    }
  }

  const kb = new InlineKeyboard()
    .text("🔄 به‌روزرسانی", "logs_recent")
    .text("📜 مرکز لاگ‌ها", "admin_logs_menu")
    .row()
    .text("🔙 پنل ادمین", "menu_admin");

  if (text.length <= 4000) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(async () => {
      await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
    });
  } else {
    await sendSafeMessage(ctx, text, { parse_mode: "HTML" });
  }
  await ctx.answerCallbackQuery().catch(() => {});
});

bot.callbackQuery("admin_groups", async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  await renderAdminGroups(ctx, true);
  await ctx.answerCallbackQuery().catch(() => {});
});

bot.callbackQuery(/^grp_detail:(\-?\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const chatId = parseInt(ctx.match[1], 10);
  const g = getGroupById(chatId);
  if (!g) {
    return ctx.answerCallbackQuery({ text: "گروه یافت نشد." });
  }

  const statusText = g.status === "approved" ? "✅ تایید شده و فعال" : g.status === "pending" ? "⏳ در انتظار تایید" : "🚪 خارج شده";

  const text = (
    `👥 <b>اطلاعات گروه:</b>\n\n` +
    `• عنوان گروه: <b>${escapeHtml(g.title)}</b>\n` +
    `• آیدی گروه: <code>${g.chat_id}</code>\n` +
    `• نوع چت: <code>${g.type}</code>\n` +
    `• وضعیت فعالیت: <b>${statusText}</b>\n` +
    `• اضافه کننده: <b>${escapeHtml(g.added_by_name)}</b> (${g.added_by_username ? `@${g.added_by_username}` : "ندارد"}) [<code>${g.added_by_id}</code>]\n` +
    `• تاریخ ثبت: <code>${g.created_at}</code>\n`
  );

  const kb = new InlineKeyboard();
  if (g.status !== "approved") {
    kb.text("✅ تایید عضویت", `grp_accept:${g.chat_id}`).row();
  }
  kb.text("🔄 استعلام وضعیت زنده از تلگرام", `grp_sync:${g.chat_id}`).row();
  if (g.status !== "left") {
    kb.text("🚪 خروج از گروه (Leave)", `grp_leave:${g.chat_id}`).row();
  }
  kb.text("🔙 بازگشت به لیست گروه‌ها", "admin_groups");

  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^grp_sync:(\-?\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const chatId = parseInt(ctx.match[1], 10);
  try {
    const chat = (await ctx.api.getChat(chatId)) as any;
    const title = chat.title || "گروه";
    registerOrUpdateGroup(chatId, title, chat.type);

    let role = "عضو";
    try {
      const member = await ctx.api.getChatMember(chatId, ctx.me.id);
      role = member.status === "administrator" ? "👑 مدیر (Admin)" : member.status === "member" ? "👤 عضو عادی (Member)" : member.status;
    } catch {}

    const g = getGroupById(chatId);
    const statusText = g?.status === "approved" ? "✅ تایید شده و فعال" : g?.status === "pending" ? "⏳ در انتظار تایید" : "🚪 خارج شده";

    const text = (
      `👥 <b>اطلاعات گروه (به‌روزرسانی شده از تلگرام):</b>\n\n` +
      `• عنوان گروه: <b>${escapeHtml(g?.title || title)}</b>\n` +
      `• آیدی گروه: <code>${chatId}</code>\n` +
      `• نوع چت: <code>${chat.type}</code>\n` +
      `• نقش ربات در گروه: <b>${role}</b>\n` +
      `• وضعیت فعالیت: <b>${statusText}</b>\n` +
      `• اضافه کننده: <b>${escapeHtml(g?.added_by_name || "نامشخص")}</b>\n` +
      `• تاریخ ثبت: <code>${g?.created_at || "نامشخص"}</code>\n`
    );

    const kb = new InlineKeyboard();
    if (g?.status !== "approved") {
      kb.text("✅ تایید عضویت", `grp_accept:${chatId}`).row();
    }
    kb.text("🔄 استعلام مجدد از تلگرام", `grp_sync:${chatId}`).row();
    if (g?.status !== "left") {
      kb.text("🚪 خروج از گروه (Leave)", `grp_leave:${chatId}`).row();
    }
    kb.text("🔙 بازگشت به لیست گروه‌ها", "admin_groups");

    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => {});
    await ctx.answerCallbackQuery({ text: `همگام‌سازی شد! عنوان: ${title} | نقش ربات: ${role}` });
  } catch (e: any) {
    await ctx.answerCallbackQuery({ text: `خطا در دریافت وضعیت از تلگرام: ${e?.message || e}`, show_alert: true });
  }
});

bot.callbackQuery(/^grp_accept:(\-?\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const chatId = parseInt(ctx.match[1], 10);
  setGroupStatus(chatId, "approved");
  const grp = getGroupById(chatId);
  const grpTitle = grp ? grp.title : String(chatId);

  // ارسال پیام خوشامدگویی و تایید در گروه
  try {
    await ctx.api.sendMessage(
      chatId,
      `🎉 <b>عضویت تایید شد!</b>\nسازنده و رئیس من (مهدی) اجازه فعالیت مزمز در گروه «${escapeHtml(grpTitle)}» را صادر کرد 🚀\nاز این پس می‌توانید با ریپلای روی من یا خطاب مستقیم گفتگو کنید!`,
      { parse_mode: "HTML" }
    );
  } catch (e: any) {
    console.warn("Could not send approval message to group:", e?.message);
  }

  await ctx.editMessageText(
    `✅ <b>گروه «${escapeHtml(grpTitle)}» (<code>${chatId}</code>) تایید شد و ربات در آن فعال است.</b>`,
    { parse_mode: "HTML" }
  ).catch(() => {});
  await ctx.answerCallbackQuery({ text: "گروه تایید شد." });
});

bot.callbackQuery(/^grp_(?:reject|leave):(\-?\d+)$/, async (ctx) => {
  if (!CONFIG.ADMIN_IDS.includes(ctx.from!.id)) return;
  const chatId = parseInt(ctx.match[1], 10);
  const grp = getGroupById(chatId);
  const grpTitle = grp ? grp.title : String(chatId);

  // ارسال پیام خداحافظی محترمانه در گروه قبل از خروج
  try {
    await ctx.api.sendMessage(
      chatId,
      `👋 طبق دستور سازنده و مدیر اصلی (مهدی)، من از این گروه خارج می‌شوم. روز خوش!`
    );
  } catch {}

  // خروج ربات از گروه
  try {
    await ctx.api.leaveChat(chatId);
  } catch (e: any) {
    console.warn("Could not leave chat:", e?.message);
  }

  setGroupStatus(chatId, "left");

  await ctx.editMessageText(
    `🚪 <b>ربات با موفقیت از گروه «${escapeHtml(grpTitle)}» (<code>${chatId}</code>) خارج شد.</b>`,
    { parse_mode: "HTML" }
  ).catch(() => {});
  await ctx.answerCallbackQuery({ text: "از گروه خارج شد." });
});

// مدیریت خاموش‌سازی تمیز کانتینر (Graceful Shutdown) برای جلوگیری از تداخل 409 هنگام دیپلوی مجدد
process.once("SIGINT", async () => {
  console.log("🛑 دریافت سیگنال SIGINT، توقف تمیز بات...");
  try {
    await bot.stop();
  } catch {}
  process.exit(0);
});

process.once("SIGTERM", async () => {
  console.log("🛑 دریافت سیگنال SIGTERM (دیپلوی جدید در Railway)، آزادسازی فوری اتصال به تلگرام...");
  try {
    await bot.stop();
  } catch {}
  process.exit(0);
});

// اجرای ربات با مکانیزم ضد کرش و تلاش مجدد هوشمند در برابر تداخل 409 کانتینرها
async function launchBotWithResilience() {
  const maxRetries = 10;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      await bot.start({
        drop_pending_updates: true,
        allowed_updates: [
          "message",
          "edited_message",
          "callback_query",
          "my_chat_member",
          "chat_member",
        ],
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
                  { command: "groups", description: "👥 مدیریت و نظارت بر گروه‌ها" },
                  { command: "addgroup", description: "➕ ثبت دستی گروه با آیدی" },
                  { command: "logs", description: "📜 مشاهده لاگ پیام‌ها و گفتگوهای کاربران" },
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

              // آماده‌سازی تاریخ و ساعت دقیق به وقت ایران
              const now = new Date();
              const dateFa = new Intl.DateTimeFormat("fa-IR", {
                timeZone: "Asia/Tehran",
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(now);
              const timeFa = new Intl.DateTimeFormat("fa-IR", {
                timeZone: "Asia/Tehran",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              }).format(now);

              // ارسال اعلان آپدیت جدید به تلگرام رئیس مهدی به همراه تاریخ، ساعت، کارهای جدید و رفع باگ‌ها
              await bot.api.sendMessage(
                adminId,
                `🚀 <b>آپدیت جدید مزمز: پشتیبانی از تمام مدل‌ها + کنترل سطح تفکر (Low / Medium / High)!</b>\n\n` +
                `📅 <b>زمان استقرار:</b> <code>${dateFa} | ساعت ${timeFa}</code>\n\n` +
                `🛠️ <b>امکانات و بهبودهای این نسخه:</b>\n` +
                `• 💎 <b>حفظ لیست کامل مدل‌های هوش مصنوعی:</b> دسترسی آزاد به تمامی مدل‌های <code>gemini-3.7-flash</code>, <code>gemini-3.8-flash</code>, <code>gemini-3.5-flash</code>, <code>gemini-3.5-flash-lite</code> و...\n` +
                `• ⚡ <b>تنظیم سطح قدرت تفکر برای هر مدل (Thinking Level):</b>\n` +
                `   ⚡ <b>Low (فوق‌سریع):</b> تفکر خاموش (بودجه ۰) برای پاسخ لحظه‌ای و زیر ۱ ثانیه\n` +
                `   ⚖️ <b>Medium (متعادل):</b> تفکر متعادل (بودجه ۲۰۴۸) برای تحلیل هوشمندانه و پرسرعت\n` +
                `   🧠 <b>High (عمیق):</b> تفکر و استدلال حداکثری (بودجه ۸۱۹۲) برای محاسبات و مسائل سخت\n` +
                `• 🎛️ <b>دستورات تعاملی جدید:</b> داشبورد کامل <code>/model</code>، دستور اختصاصی <code>/power</code> و شورت‌کات‌هایی مثل <code>/model 3.7 low</code>.\n` +
                `• 🛡️ <b>مدیریت هوشمند خطاها:</b> سازگاری خودکار با مدل‌ها و فال‌بک نرم‌افزاری در صورت بروز خطای تفکر.\n\n` +
                `<i>مزمز دقیق، پرسرعت و وفادار در خدمت شماست، رئیس مهدی!</i>`,
                { parse_mode: "HTML" }
              ).catch((err) => console.warn("Could not send startup notification to admin:", err?.message));
            }

            // ثبت منوی ۷ دستور اسلش استاندارد در تلگرام برای کاربران و پاکسازی در گروه‌ها
            await bot.api.setMyCommands([
              { command: "clear", description: "پاکسازی حافظه و زمینه گفتگو" },
              { command: "history", description: "مشاهده لاگ پیام‌های اخیر گفتگو" },
              { command: "model", description: "مشاهده یا تغییر مدل هوش مصنوعی" },
              { command: "temp", description: "تنظیم میزان خلاقیت پاسخ‌ها (Temperature)" },
              { command: "lang", description: "تغییر زبان ربات (فارسی / English)" },
              { command: "system", description: "مشاهده و تنظیم دستورالعمل سیستمی" },
              { command: "settings", description: "منوی تنظیمات تعاملی ربات" },
            ], { scope: { type: "default" } }).catch(() => {});
            await bot.api.deleteMyCommands({ scope: { type: "all_group_chats" } }).catch(() => {});
            console.log("✅ Standard Slash Commands registered for users via setMyCommands!");
          } catch (e: any) {
            console.warn("⚠️ Could not set bot commands automatically:", e?.message || e);
          }
        },
      });
      break;
    } catch (err: any) {
      attempt++;
      const is409 = err?.error_code === 409 || String(err?.message || "").includes("409");
      if (is409) {
        console.warn(`⏳ [Conflict 409] کانتینر قبلی در حال آزادسازی اتصال است. تلاش مجدد (${attempt}/${maxRetries}) در ۴ ثانیه...`);
        await new Promise((resolve) => setTimeout(resolve, 4000));
      } else {
        console.error(`❌ خطای اتصال به تلگرام:`, err?.message || err);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}

launchBotWithResilience();
