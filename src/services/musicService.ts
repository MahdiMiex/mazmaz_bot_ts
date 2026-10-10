import { InputFile } from "grammy";
import fs from "fs";
import path from "path";
import { CONFIG } from "../config";

export interface MusicDownloadResult {
  ok: boolean;
  filePath?: string;
  title?: string;
  performer?: string;
  duration?: number;
  error?: string;
}

/**
 * دانلود و استخراج فایل صوتی با استفاده از yt-dlp در دایرکتوری موقت /tmp
 */
export async function downloadAudio(queryOrUrl: string, signal?: AbortSignal): Promise<MusicDownloadResult> {
  const cleanInput = queryOrUrl.trim();
  if (!cleanInput) {
    return { ok: false, error: "نام آهنگ یا لینک صوتی مشخص نشده است." };
  }
  if (signal?.aborted) {
    return { ok: false, error: "عملیات متوقف شد." };
  }

  let query = cleanInput;
  const isUrl = /^https?:\/\//i.test(cleanInput);
  if (typeof query === "string" && query.includes("spotify.com/track/")) {
    try {
      const _sRes = await fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent(query), { signal });
      const _sData = await _sRes.json();
      if (_sData && _sData.title) query = "scsearch1:" + _sData.title;
    } catch {}
  }
  if (signal?.aborted) {
    return { ok: false, error: "عملیات متوقف شد." };
  }

  const target = isUrl ? cleanInput : `scsearch1:${cleanInput}`;
  const id = `mazmaz_audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const outTemplate = path.join("/tmp", `${id}.%(ext)s`);

  const cleanupPartialFiles = () => {
    try {
      if (fs.existsSync("/tmp")) {
        const files = fs.readdirSync("/tmp");
        for (const f of files) {
          if (f.startsWith(id)) {
            try {
              fs.unlinkSync(path.join("/tmp", f));
            } catch {}
          }
        }
      }
    } catch {}
  };

  const args = [
    "yt-dlp",
    "--no-playlist",
    "--extractor-args",
    "youtube:player_client=android",
    "--max-filesize",
    "50M",
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "192K",
    "--print",
    "%(title)s<META>%(artist,uploader)s<META>%(duration)s",
    "--no-simulate",
    "-o",
    outTemplate,
  ];

  if (CONFIG.USE_PROXY && CONFIG.PROXY_URL) {
    args.push("--proxy", CONFIG.PROXY_URL);
  }

  args.push(target);

  let proc: any = null;
  const onAbort = () => {
    try {
      if (proc) {
        proc.kill();
      }
    } catch {}
    cleanupPartialFiles();
  };

  if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    if (signal?.aborted) {
      onAbort();
      return { ok: false, error: "عملیات متوقف شد." };
    }

    proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;

    if (signal?.aborted) {
      cleanupPartialFiles();
      return { ok: false, error: "عملیات متوقف شد." };
    }

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      cleanupPartialFiles();
      if (signal?.aborted) {
        return { ok: false, error: "عملیات متوقف شد." };
      }
      console.error("yt-dlp music download error:", stderr);
      if (stderr.includes("File is larger than max-filesize") || stderr.includes("larger than max-filesize")) {
        return { ok: false, error: "حجم فایل صوتی بیشتر از سقف ۵۰ مگابایت محدودیت تلگرام است." };
      }
      return { ok: false, error: `خطا در دریافت موزیک: ${stderr.slice(0, 150)}` };
    }

    // استخراج متادیتا از خروجی yt-dlp
    let title = "موزیک";
    let performer = "مزمز";
    let duration: number | undefined;

    const metaLine = stdout.split("\n").find((l) => l.includes("<META>"));
    if (metaLine) {
      const parts = metaLine.split("<META>");
      if (parts[0] && parts[0].trim() && parts[0].trim() !== "NA") {
        title = parts[0].trim();
      }
      if (parts[1] && parts[1].trim() && parts[1].trim() !== "NA") {
        performer = parts[1].trim();
      }
      if (parts[2] && !isNaN(parseInt(parts[2], 10))) {
        duration = parseInt(parts[2], 10);
      }
    }

    // یافتن فایل دانلود شده در مسیر /tmp
    const files = fs.readdirSync("/tmp");
    const downloadedFile = files.find((f) => f.startsWith(id));

    if (!downloadedFile) {
      return { ok: false, error: "فایل صوتی دانلود شده در مسیر موقت یافت نشد." };
    }

    const fullPath = path.join("/tmp", downloadedFile);
    const stat = fs.statSync(fullPath);

    // سقف ۵۰ مگابایت برای بات تلگرام
    const MAX_TELEGRAM_AUDIO_BYTES = 50 * 1024 * 1024;
    if (stat.size > MAX_TELEGRAM_AUDIO_BYTES) {
      try {
        fs.unlinkSync(fullPath);
      } catch {}
      return { ok: false, error: "حجم فایل صوتی بیشتر از سقف ۵۰ مگابایت محدودیت تلگرام است." };
    }

    return {
      ok: true,
      filePath: fullPath,
      title,
      performer,
      duration,
    };
  } catch (err: any) {
    cleanupPartialFiles();
    if (signal?.aborted) {
      return { ok: false, error: "عملیات متوقف شد." };
    }
    console.error("Music download exception:", err);
    return { ok: false, error: err?.message || "خطای ناشناخته در دریافت فایل صوتی." };
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
    if (signal?.aborted) {
      cleanupPartialFiles();
    }
  }
}

/**
 * حذف ایمن فایل موقت
 */
export function cleanupTempAudio(filePath?: string | null) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn("Failed to unlink temp audio file:", e);
    }
  }
}

/**
 * دانلود و ارسال مستقیم موزیک به تلگرام با replyWithAudio
 */
export async function sendMusicToTelegram(
  ctx: any,
  queryOrUrl: string,
  preferredTitle?: string,
  preferredPerformer?: string,
  signal?: AbortSignal
): Promise<{ ok: boolean; message: string; title?: string; performer?: string }> {
  let downloadResult: MusicDownloadResult | null = null;
  let statusMsg: any = null;

  try {
    if (signal?.aborted) {
      return { ok: false, message: "متوقف شد" };
    }

    if (ctx?.reply) {
      statusMsg = await ctx.reply("🎵 <i>در حال جستجو و دریافت آهنگ از پایگاه صوتی... ⏳</i>", {
        parse_mode: "HTML",
      }).catch(() => null);
    }

    if (signal?.aborted) {
      if (statusMsg && ctx?.api?.editMessageText) {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "⛔ متوقف شد").catch(() => {});
      }
      return { ok: false, message: "متوقف شد" };
    }

    await ctx.replyWithChatAction?.("upload_voice").catch(() => {});

    downloadResult = await downloadAudio(queryOrUrl, signal);

    if (signal?.aborted) {
      if (statusMsg && ctx?.api?.editMessageText) {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "⛔ متوقف شد").catch(() => {});
      }
      return { ok: false, message: "متوقف شد" };
    }

    if (!downloadResult.ok || !downloadResult.filePath) {
      const errorMsg = downloadResult.error || "خطا در دانلود موزیک.";
      if (statusMsg && ctx?.api?.editMessageText) {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `❌ ${errorMsg}`).catch(() => {});
      } else if (ctx?.reply) {
        await ctx.reply(`❌ ${errorMsg}`);
      }
      return { ok: false, message: errorMsg };
    }

    if (signal?.aborted) {
      if (statusMsg && ctx?.api?.editMessageText) {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "⛔ متوقف شد").catch(() => {});
      }
      return { ok: false, message: "متوقف شد" };
    }

    const finalTitle = preferredTitle || downloadResult.title || "موزیک";
    const finalPerformer = preferredPerformer || downloadResult.performer || "مزمز";

    await ctx.replyWithAudio(new InputFile(downloadResult.filePath), {
      title: finalTitle,
      performer: finalPerformer,
      duration: downloadResult.duration,
      caption: `🎵 <b>${finalTitle}</b>\n👤 <i>${finalPerformer}</i>\n\nربات هوشمند <b>@mazmazAgentBot</b>`,
      parse_mode: "HTML",
    });

    if (statusMsg && ctx?.api?.deleteMessage) {
      await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
    }

    return {
      ok: true,
      title: finalTitle,
      performer: finalPerformer,
      message: `آهنگ «${finalTitle}» از «${finalPerformer}» با موفقیت در چت ارسال شد.`,
    };
  } catch (err: any) {
    if (signal?.aborted) {
      if (statusMsg && ctx?.api?.editMessageText) {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "⛔ متوقف شد").catch(() => {});
      }
      return { ok: false, message: "متوقف شد" };
    }
    console.error("sendMusicToTelegram error:", err);
    const errorMsg = `خطا در ارسال آهنگ به تلگرام: ${err?.message || err}`;
    if (statusMsg && ctx?.api?.editMessageText) {
      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `❌ ${errorMsg}`).catch(() => {});
    } else if (ctx?.reply) {
      await ctx.reply(`❌ ${errorMsg}`).catch(() => {});
    }
    return { ok: false, message: errorMsg };
  } finally {
    if (downloadResult?.filePath) {
      cleanupTempAudio(downloadResult.filePath);
    }
  }
}
