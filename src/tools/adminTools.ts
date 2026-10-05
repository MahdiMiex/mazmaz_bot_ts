import { Bot, Context } from "grammy";
import { db } from "../db";
import { CONFIG } from "../config";

// ۱. اسکیماهای تفکیک‌شده ابزارهای مدیریتی برای هوش مصنوعی
export const adminToolsDeclaration = [
  {
    name: "ban_chat_member",
    description: "بن یا اخراج دائم کاربر از گروه",
    parameters: {
      type: "OBJECT",
      properties: {
        user_id: { type: "NUMBER", description: "آیدی عددی کاربر هدف" }
      },
      required: ["user_id"]
    }
  },
  {
    name: "mute_chat_member",
    description: "سکوت (میوت) کردن کاربر در گروه برای مدت زمان مشخص",
    parameters: {
      type: "OBJECT",
      properties: {
        user_id: { type: "NUMBER", description: "آیدی عددی کاربر هدف" },
        duration_seconds: { type: "NUMBER", description: "مدت زمان میوت به ثانیه (مثلاً ۳۶۰۰ برای ۱ ساعت)" }
      },
      required: ["user_id"]
    }
  },
  {
    name: "unmute_chat_member",
    description: "رفع محدودیت و باز کردن میوت کاربر در گروه",
    parameters: {
      type: "OBJECT",
      properties: {
        user_id: { type: "NUMBER", description: "آیدی عددی کاربر هدف" }
      },
      required: ["user_id"]
    }
  }
];

export const adminToolsSchema = [
  ...adminToolsDeclaration,
  {
    name: "summarize_chat",
    description: "دریافت تاریخچه پیامهای اخیر گروه برای خلاصهسازی",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "تعداد پیامهای اخیر (پیشفرض ۵۰)" }
      }
    }
  },
  {
    name: "delete_recent_messages",
    description: "حذف گروهی آخرین پیامهای ارسالی در گروه",
    parameters: {
      type: "object",
      properties: {
        count: { type: "number", description: "تعداد پیامها برای پاکسازی" }
      },
      required: ["count"]
    }
  },
  {
    name: "moderate_user",
    description: "مدیریت و اعمال محدودیت روی کاربران گروه (بن، آنبن، میوت)",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["ban", "unban", "mute"] },
        user_id: { type: "number", description: "شناسه عددی کاربر مقصد" }
      },
      required: ["action", "user_id"]
    }
  },
  {
    name: "manage_bot_chats",
    description: "مشاهده لیست گروهها یا لفت دادن بات از گروه",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "leave"] },
        chat_id: { type: "number", description: "شناسه گروه در صورت درخواست خروج" }
      },
      required: ["action"]
    }
  }
];

// ۲. حافظه ۳۰ پیام اخیر چت (هم کش در حافظه رم، هم دیتابیس پایدار SQLite)
export const MAX_MESSAGES = 30;
export const chatMemory = new Map<number, { role: string; text: string; time: number }[]>();

export function saveMessage(chatId: number, role: string, text: string) {
  const history = chatMemory.get(chatId) || [];
  history.push({ role, text, time: Date.now() });
  if (history.length > MAX_MESSAGES) history.shift();
  chatMemory.set(chatId, history);
}

// میدلور ذخیره پیامها و مدیریت عضویت در گروهها
export function setupTrackingMiddleware(bot: Bot) {
  bot.on("message", async (ctx, next) => {
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      const text = ctx.message.text || ctx.message.caption || "";
      const senderName = ctx.from?.first_name || String(ctx.from?.id || 0);
      const senderId = ctx.from?.id || 0;
      const date = ctx.message.date || Math.floor(Date.now() / 1000);

      if (text) {
        saveMessage(ctx.chat.id, senderName, text);
      }

      try {
        db.prepare(`
          INSERT INTO messages (chat_id, message_id, user_id, text, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(ctx.chat.id, ctx.message.message_id, senderId, text, date);
      } catch (e: any) {
        console.warn("Failed to track group message:", e?.message);
      }
    }
    await next();
  });

  bot.on("my_chat_member", (ctx, next) => {
    const status = ctx.myChatMember.new_chat_member.status;
    if (status === "member" || status === "administrator") {
      try {
        db.prepare("INSERT OR REPLACE INTO chats (chat_id, title) VALUES (?, ?)").run(ctx.chat.id, ctx.chat.title || "گروه");
      } catch {}
    } else if (status === "left" || status === "kicked") {
      try {
        db.prepare("DELETE FROM chats WHERE chat_id = ?").run(ctx.chat.id);
      } catch {}
    }
    if (typeof next === "function") next();
  });
}

// ۳. توابع اجرایی ابزارهای مدیریتی تلگرام
export async function executeAdminTool(botOrApi: any, ctx: Context | any, name: string, args: any, requestingUserId?: number) {
  // قوانین امنیتی: دستورات مدیریتی و حذف پیام فقط در صورتی اجرا شوند که کاربر درخواست‌دهنده ادمین باشد
  const userId = requestingUserId || ctx?.from?.id;
  if (!userId || !CONFIG.ADMIN_IDS.includes(userId)) {
    return { ok: false, error: "⛔ عدم دسترسی: دستورات مدیریتی گروه فقط برای سازنده و ادمین اصلی (رئیس مهدی) مجاز است." };
  }

  const currentChatId = args.chat_id || ctx?.chat?.id;
  const api = botOrApi?.api || botOrApi || ctx?.api;

  switch (name) {
    case "ban_chat_member": {
      if (!currentChatId) return { error: "دستور فقط در گروه قابل اجراست." };
      const targetUserId = Number(args.user_id);
      if (!targetUserId || isNaN(targetUserId)) {
        return { ok: false, error: "شناسه عددی کاربر هدف نامعتبر است." };
      }
      try {
        await api.banChatMember(currentChatId, targetUserId);
        return { success: true, message: `کاربر ${targetUserId} با موفقیت بن شد.` };
      } catch (err: any) {
        return { error: `خطا در اجرای دستور ادمینی: ${err.description || err.message}` };
      }
    }

    case "mute_chat_member": {
      if (!currentChatId) return { error: "دستور فقط در گروه قابل اجراست." };
      const targetUserId = Number(args.user_id);
      if (!targetUserId || isNaN(targetUserId)) {
        return { ok: false, error: "شناسه عددی کاربر هدف نامعتبر است." };
      }
      const untilDate = args.duration_seconds 
        ? Math.floor(Date.now() / 1000) + Number(args.duration_seconds)
        : 0;

      try {
        await api.restrictChatMember(currentChatId, targetUserId, {
          can_send_messages: false,
          can_send_photos: false,
          can_send_videos: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
        }, {
          until_date: untilDate
        });
        return { success: true, message: `کاربر ${targetUserId} میوت شد.` };
      } catch (err: any) {
        return { error: `خطا در اجرای دستور ادمینی: ${err.description || err.message}` };
      }
    }

    case "unmute_chat_member": {
      if (!currentChatId) return { error: "دستور فقط در گروه قابل اجراست." };
      const targetUserId = Number(args.user_id);
      if (!targetUserId || isNaN(targetUserId)) {
        return { ok: false, error: "شناسه عددی کاربر هدف نامعتبر است." };
      }
      try {
        await api.restrictChatMember(currentChatId, targetUserId, {
          can_send_messages: true,
          can_send_photos: true,
          can_send_videos: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
        });
        return { success: true, message: `میوت کاربر ${targetUserId} برداشته شد.` };
      } catch (err: any) {
        return { error: `خطا در اجرای دستور ادمینی: ${err.description || err.message}` };
      }
    }

    case "summarize_chat": {
      let targetChatId = args.chat_id || currentChatId;
      if (!targetChatId && args.group_title) {
        const found = db.query("SELECT chat_id FROM groups WHERE title LIKE ? LIMIT 1").get(`%${args.group_title}%`) as any;
        if (found) targetChatId = found.chat_id;
      }
      if (!targetChatId) {
        const single = db.query("SELECT chat_id, title FROM groups WHERE status = 'approved' LIMIT 1").get() as any;
        if (single) targetChatId = single.chat_id;
      }
      if (!targetChatId) return { error: "دستور باید داخل گروه اجرا شود یا عنوان گروه مشخص باشد." };

      const limit = Math.min(args.limit || 50, 100);
      const rows = db.query(`
        SELECT user_id, text FROM messages
        WHERE chat_id = ? AND text != ''
        ORDER BY id DESC LIMIT ?
      `).all(targetChatId, limit) as { user_id: number; text: string }[];
      
      const history = rows.reverse().map((r, i) => `${i + 1}. [کاربر ${r.user_id}]: ${r.text}`).join("\n");
      return { ok: true, chat_id: targetChatId, context: history || "پیامی در حافظه این گروه یافت نشد." };
    }

    case "delete_recent_messages": {
      if (!currentChatId) return { error: "دستور باید داخل گروه اجرا شود." };
      const count = Math.min(args.count || 10, 100);
      const rows = db.prepare(`
        SELECT message_id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?
      `).all(currentChatId, count) as { message_id: number }[];

      if (!rows.length) return { ok: false, message: "پیامی برای حذف پیدا نشد." };
      
      const messageIds = rows.map((r) => r.message_id);
      try {
        await api.deleteMessages(currentChatId, messageIds);
        db.prepare(`DELETE FROM messages WHERE chat_id = ? AND message_id IN (${messageIds.join(",")})`).run(currentChatId);
        return { ok: true, deleted_count: messageIds.length };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    }

    case "moderate_user": {
      if (!currentChatId) return { error: "دستور باید داخل گروه اجرا شود." };
      const { action, user_id } = args;
      if (!user_id || isNaN(Number(user_id))) {
        return { ok: false, error: "شناسه عددی کاربر مقصد نامعتبر است." };
      }
      const targetUserId = Number(user_id);
      try {
        if (action === "ban") {
          await api.banChatMember(currentChatId, targetUserId);
        } else if (action === "unban") {
          await api.unbanChatMember(currentChatId, targetUserId, { only_if_banned: true });
        } else if (action === "mute") {
          await api.restrictChatMember(currentChatId, targetUserId, {
            can_send_messages: false,
            can_send_photos: false,
            can_send_videos: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false,
          });
        } else {
          return { ok: false, error: `عملیات نامعتبر: ${action}` };
        }
        return { ok: true, status: `عملیات ${action} روی کاربر ${targetUserId} انجام شد.` };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    }

    case "manage_bot_chats": {
      if (args.action === "list") {
        try {
          const groups = db.prepare("SELECT chat_id, title, type, status, added_by_name FROM groups").all();
          if (groups.length > 0) return { ok: true, groups, count: groups.length };
        } catch {}
        const chats = db.prepare("SELECT chat_id, title FROM chats").all();
        return { ok: true, groups: chats, count: chats.length };
      } else if (args.action === "leave") {
        const targetChat = args.chat_id || currentChatId;
        if (!targetChat) return { error: "شناسه گروه مشخص نشده است." };
        try {
          await api.leaveChat(targetChat);
        } catch (e: any) {
          console.warn("Could not leave chat via API:", e?.message);
        }
        db.prepare("DELETE FROM chats WHERE chat_id = ?").run(targetChat);
        return { ok: true, message: `بات از گروه ${targetChat} خارج شد.` };
      }
      return { error: "عملیات نامعتبر" };
    }

    default:
      return { error: "ابزار ناشناخته" };
  }
}
