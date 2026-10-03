import { Context } from "grammy";
import { askGemini } from "../services/ai";
import { CONFIG } from "../config";
import { HttpsProxyAgent } from "https-proxy-agent";

import { markdownToTelegramHtml } from "../utils/formatter";

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

export async function handlePhotoMessage(ctx: Context) {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) return;

  const caption = ctx.message?.caption || "لطفاً این تصویر را با دقت و جزئیات کامل تحلیل و توضیح بده.";
  const statusMsg = await ctx.reply("👁️‍🗨️ <b>در حال دیدن و تحلیل هوشمند تصویر با مزمز... ⏳</b>", {
    parse_mode: "HTML",
  });

  try {
    // Get highest resolution photo
    const bestPhoto = photos[photos.length - 1];
    const file = await ctx.api.getFile(bestPhoto.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${file.file_path}`;

    // Download image buffer
    const imgRes = await fetch(fileUrl, {
      // @ts-ignore
      agent,
    });

    if (!imgRes.ok) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "❌ خطا در دانلود تصویر از تلگرام."
      );
      return;
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const rawAnalysis = await askGemini(ctx.from!.id, caption, base64);
    const analysis = markdownToTelegramHtml(rawAnalysis);

    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `🖼️ <b>تحلیل هوشمند تصویر توسط مزمز:</b>\n\n${analysis}`,
        { parse_mode: "HTML" }
      );
    } catch {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `🖼️ تحلیل هوشمند تصویر توسط مزمز:\n\n${rawAnalysis}`
      ).catch(() => {});
    }
  } catch (err: any) {
    console.error("Photo analysis error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ خطا در تحلیل عکس: ${err.message || err}`
    );
  }
}
