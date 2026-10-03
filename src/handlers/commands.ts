import { Context, InlineKeyboard } from "grammy";
import { CONFIG } from "../config";
import {
  getUserCount,
  getAllUsers,
  approveUser,
  rejectUser,
  getUserById,
  getTasks,
  addTask,
  toggleTask,
  deleteTask,
  getStats,
} from "../db";

export function getMainMenu(userId: number): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("🧠 چت هوشمند و طنز", "menu_ai")
    .text("📥 دانلودر مدیا", "menu_dl")
    .row()
    .text("⚡ بنچمارک سخت‌افزار و هوش مصنوعی", "menu_bench")
    .row()
    .text("📝 کارهای روزمره من", "menu_tasks")
    .text("🌤️ آب و هوا", "menu_weather")
    .row()
    .text("💵 قیمت دلار و طلا", "menu_dollar")
    .text("📊 قیمت کریپتو", "menu_crypto")
    .row()
    .text("🔍 سرچ و خواندن لینک", "menu_link");

  if (CONFIG.ADMIN_IDS.includes(userId)) {
    kb.row().text("👑 پنل ادمین و مدیریت سهمیه‌ها", "menu_admin");
  }
  return kb;
}

export async function handleStart(ctx: Context) {
  const user = ctx.from;
  const name = user?.first_name || "رفیق";
  const isAdmin = CONFIG.ADMIN_IDS.includes(user?.id || 0);

  const adminWelcome = (
    `سلام و ارادت خدمت <b>رئیس مهدی عزیز</b>! 👑⚡\n\n` +
    `مزمز با قدرت تمام روی رانتایم فوق‌سریع Bun و TypeScript آنلاینه و با وفاداری کامل در خدمت شماست.\n\n` +
    `<b>وضعیت دسترسی:</b> مالک و سازنده اصلی (دسترسی نامحدود و ویژه) 🚀\n\n` +
    `از منوی زیر یا با ارسال مستقیم هر پیام، عکس، لینک یا دستوری کار رو شروع کن رئیس:`
  );

  const userWelcome = (
    `سلام <b>${name}</b> عزیز! به ربات <b>mazmaz</b> خوش اومدی! 🚀✨\n\n` +
    `من مزمزم؛ رفیق دانا، پرانرژی و همه‌کاره تو در تلگرام که توسط مهدی با رانتایم فوق‌سریع Bun خلق شدم! ⚡\n\n` +
    `<b>کارهایی که برات می‌کنم:</b>\n` +
    `• 🧠 چت هوشمند، طنز و پاسخ به سوالات\n` +
    `• 🌤️ وضعیت لحظه‌ای و پیش‌بینی دقیق آب و هوای تمام شهرها\n` +
    `• 🖼️ تحلیل کامل هر عکسی که بفرستی (کد، نوشته، اسکرین‌شات)\n` +
    `• 🌐 خواندن و تحلیل لینک‌های توییتر، ردیت و صفحات وب\n` +
    `• ⚡ استعلام جدیدترین بنچمارک‌های سخت‌افزار (CPU, GPU) و Chatbot Arena\n` +
    `• 📥 دانلودر پرسرعت یوتیوب، اینستاگرام و پینترست\n` +
    `• 📝 مدیریت تسک‌های روزانه و بازار کریپتو\n\n` +
    `از منوی زیر استفاده کن یا همین الان متنی، لینکی یا عکسی بفرست:`
  );

  const welcome = isAdmin ? adminWelcome : userWelcome;

  await ctx.reply(welcome, {
    reply_markup: getMainMenu(user?.id || 0),
    parse_mode: "HTML",
  });
}

export async function handleHelp(ctx: Context) {
  const help = (
    `📖 <b>راهنمای دستورات و کارکرد ربات mazmaz:</b>\n\n` +
    `• <code>/start</code> - شروع گفتگو و نمایش منوی اصلی\n` +
    `• <code>/stop</code> - توقف یا ریست کردن گفتگو\n` +
    `• <code>/history</code> - پاک کردن تاریخچه چت و حافظه موقت\n` +
    `• <code>/tasks</code> - مدیریت کارهای روزمره\n` +
    `• <code>هواشناسی [اسم شهر]</code> - استعلام وضعیت زنده و پیش‌بینی آب و هوا\n` +
    `• <code>بنچمارک [اسم گوشی/پردازنده]</code> - بنچمارک تخصصی قطعه\n` +
    `• <code>دلار</code> یا <code>کریپتو</code> - قیمت لحظه‌ای بازار\n` +
    `• ارسال هر لینک توییتر/ردیت/سایت - خلاصه و تحلیل محتوا\n` +
    `• ارسال عکس - تحلیل و پاسخ به سوالات روی تصویر\n` +
    `• ارسال لینک یوتیوب/اینستا - دانلود ویدیو یا استخراج MP3\n\n` +
    `💡 <i>توی گروه‌ها هم هر وقت بگی «مزمز» یا ریپلای کنی درجا جوابت رو میده!</i>`
  );
  await ctx.reply(help, { parse_mode: "HTML" });
}

export async function renderTasksMenu(ctx: Context, userId: number, editMessage = false) {
  const tasks = getTasks(userId);
  const kb = new InlineKeyboard();

  let text = "📝 <b>لیست کارهای روزمره شما:</b>\n\n";
  if (tasks.length === 0) {
    text += "لیست شما در حال حاضر خالی است! برای اضافه کردن تسک، دستوری مثل <code>/add مطالعه پایتون</code> بفرستید.";
  } else {
    for (const t of tasks) {
      const icon = t.is_done ? "✅" : "⬜";
      const title = t.is_done ? `<s>${t.title}</s>` : t.title;
      kb.text(`${icon} ${t.title.slice(0, 25)}`, `task_tog:${t.id}`)
        .text("🗑️", `task_del:${t.id}`)
        .row();
    }
  }

  kb.text("🔙 بازگشت به منو", "menu_home");

  if (editMessage && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  } else {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  }
}
