import { Bot, Context } from "grammy";
import { db } from "../db";
import { CONFIG } from "../config";

// ۱. اسکیماهای ابزار برای هوش مصنوعی
export const adminToolsSchema = [
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

// میدلور ذخیره پیامها و مدیریت عضویت در گروهها
export function setupTrackingMiddleware(bot: Bot) {
  bot.on("message", async (ctx, next) => {
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      const text = ctx.message.text || ctx.message.caption || "";
      const senderId = ctx.from?.id || 0;
      const date = ctx.message.date || Math.floor(Date.now() / 1000);
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
    case "summarize_chat": {
      if (!currentChatId) return { error: "دستور باید داخل گروه اجرا شود یا شناسه گروه مشخص باشد." };
      const limit = Math.min(args.limit || 50, 100);
      const rows = db.prepare(`
        SELECT user_id, text FROM messages
        WHERE chat_id = ? AND text != ''
        ORDER BY id DESC LIMIT ?
      `).all(currentChatId, limit) as { user_id: number; text: string }[];
      
      const history = rows.reverse().map((r) => `User(${r.user_id}): ${r.text}`).join("\n");
      return { ok: true, context: history || "پیامی در حافظه یافت نشد." };
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
            can_send_other_messages: false
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
        const chats = db.prepare("SELECT chat_id, title FROM chats").all();
        return { ok: true, chats };
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
