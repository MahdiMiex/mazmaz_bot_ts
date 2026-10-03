import { Context } from "grammy";
import { askGemini } from "../services/ai";
import { CONFIG } from "../config";
import { HttpsProxyAgent } from "https-proxy-agent";
import { markdownToTelegramHtml } from "../utils/formatter";
import { withTyping, sendSafeMessage } from "../utils/chunker";
import { formatQuotaFooter, checkAndConsumeQuota } from "../db";

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

export async function handlePhotoMessage(ctx: Context) {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) return;

  const userId = ctx.from!.id;
  const chatType = ctx.chat?.type || "private";
  const isGroup = chatType === "group" || chatType === "supergroup";
  const isAdmin = CONFIG.ADMIN_IDS.includes(userId);

  const replyOpts = {
    reply_parameters: {
      message_id: ctx.message!.message_id,
      allow_sending_without_reply: true,
    },
  };

  // فیلتر در گروه‌ها: فقط در صورت ریپلای روی ربات، منشن یا خطاب مستقیم
  if (isGroup) {
    const botInfo = ctx.me;
    const isReplyToBot = ctx.message?.reply_to_message?.from?.id === botInfo.id;
    const captionLower = (ctx.message?.caption || "").toLowerCase();
    const isBotMentioned = captionLower.includes(`@${botInfo.username.toLowerCase()}`);
    const isDirectCall = /^(?:(?:سلام|درود|هی|الو|چطوری)\s+)?(?:مزمز|mazmaz)/i.test(ctx.message?.caption?.trim() || "");

    if (!isReplyToBot && !isBotMentioned && !isDirectCall) {
      return;
    }

    if (!isAdmin) {
      const quota = checkAndConsumeQuota(userId, true);
      if (!quota.allowed) {
        await ctx.reply(
          "⚠️ <b>سهمیه پیام امروز شما به پایان رسیده است!</b>\n\n" +
          "سهمیه روزانه شما بامداد فردا مجدداً شارژ می‌شود. 🌙",
          {
            ...replyOpts,
            parse_mode: "HTML",
          }
        );
        return;
      }
    }
  }

  const caption = ctx.message?.caption || "لطفاً این تصویر را با دقت و جزئیات کامل تحلیل و توضیح بده.";
  const statusMsg = await ctx.reply("👁️‍🗨️ <b>در حال دیدن و تحلیل هوشمند تصویر با مزمز... ⏳</b>", {
    ...replyOpts,
    parse_mode: "HTML",
  });

  await withTyping(ctx, async () => {
    try {
      const bestPhoto = photos[photos.length - 1];
      const file = await ctx.api.getFile(bestPhoto.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${file.file_path}`;

      const imgRes = await fetch(fileUrl, {
        // @ts-ignore
        agent,
      });

      if (!imgRes.ok) {
        await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, "❌ خطا در دانلود تصویر از تلگرام.");
        return;
      }

      const arrayBuffer = await imgRes.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");

      const rawAnalysis = await askGemini(userId, caption, base64, ctx);
      const analysis = markdownToTelegramHtml(rawAnalysis);
      const finalMsg = `🖼️ <b>تحلیل هوشمند تصویر توسط مزمز:</b>\n\n${analysis}${formatQuotaFooter(userId)}`;

      if (finalMsg.length <= 4000) {
        try {
          await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, finalMsg, { parse_mode: "HTML" });
        } catch {
          await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `🖼️ تحلیل هوشمند تصویر:\n\n${rawAnalysis}${formatQuotaFooter(userId)}`).catch(() => {});
        }
      } else {
        await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});
        await sendSafeMessage(ctx, finalMsg, {
          ...replyOpts,
          parse_mode: "HTML",
        });
      }
    } catch (err: any) {
      console.error("Photo analysis error:", err);
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, `❌ خطا در تحلیل عکس: ${err.message || err}`).catch(() => {});
    }
  });
}
