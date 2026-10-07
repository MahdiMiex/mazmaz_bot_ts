import { CONFIG } from "../config";
import path from "path";
import fs from "fs";

export function isMediaUrl(text: string): boolean {
  const keywords = [
    "youtube.com",
    "youtu.be",
    "instagram.com",
    "pinterest.com",
    "pin.it",
    "tiktok.com",
    "twitter.com",
    "x.com",
    "soundcloud.com",
    "spotify.com",
  ];
  return keywords.some((k) => text.toLowerCase().includes(k));
}

export async function downloadMedia(
  url: string,
  audioOnly = false
): Promise<{ filePath: string | null; error?: string }> {
  const id = Math.random().toString(36).substring(2, 9);
  const outTemplate = path.join(CONFIG.DOWNLOADS_DIR, `${id}_%(title).40s.%(ext)s`);

  const args = [
    "yt-dlp",
    "--no-playlist",
    "--extractor-args",
    "youtube:player_client=android",
    "--max-filesize",
    "49M",
  ];

  if (CONFIG.USE_PROXY && CONFIG.PROXY_URL) {
    args.push("--proxy", CONFIG.PROXY_URL);
  }

  if (audioOnly) {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "192K", "-o", outTemplate, url);
  } else {
    args.push("-f", "b[filesize<49M]/best[ext=mp4]/best", "--merge-output-format", "mp4", "-o", outTemplate, url);
  }

  try {
    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const err = await new Response(proc.stderr).text();
      console.error("yt-dlp error:", err);
      if (err.includes("File is larger than max-filesize")) {
        return { filePath: null, error: "حجم فایل بیشتر از محدودیت ۵۰ مگابایت تلگرام است." };
      }
      return { filePath: null, error: "خطا در دانلود مدیا یا لینک نامعتبر." };
    }

    // Find the downloaded file
    const files = fs.readdirSync(CONFIG.DOWNLOADS_DIR);
    const downloaded = files.find((f) => f.startsWith(`${id}_`));

    if (downloaded) {
      const fullPath = path.join(CONFIG.DOWNLOADS_DIR, downloaded);
      return { filePath: fullPath };
    }

    return { filePath: null, error: "فایل دانلود شده یافت نشد." };
  } catch (err: any) {
    console.error("Download exception:", err);
    return { filePath: null, error: err.message || "خطای ناشناخته در دانلود." };
  }
}

export function cleanupFile(filePath: string | null) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn("Cleanup error:", e);
    }
  }
}
