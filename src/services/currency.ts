import { CONFIG } from "../config";
import { HttpsProxyAgent } from "https-proxy-agent";

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

export interface CurrencyData {
  dollar: number;
  dollarLow: number;
  dollarHigh: number;
  dollarChange: number;
  dollarChangePercent: number;
  dollarDirection: string;
  tether: number;
  euro: number;
  dirham: number;
  gold18: number;
  coinEmami: number;
  ounceGold: string;
  dateStr: string;
  timeStr: string;
  rangePercent: number;
  chartUrl: string;
}

function toToman(rialStr?: string): number {
  if (!rialStr) return 0;
  const num = parseInt(rialStr.replace(/,/g, ""), 10);
  return Math.round(num / 10);
}

/**
 * Fetches live dollar, currencies, and gold prices from TGJU
 */
export async function fetchLiveCurrencyData(): Promise<CurrencyData | null> {
  const url = "https://call4.tgju.org/ajax.json";

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      // @ts-ignore
      agent,
    });

    if (!res.ok) return null;

    const json = (await res.json()) as any;
    const data = json?.current || {};

    const usd = data["price_dollar_rl"] || {};
    const usdt = data["crypto-tether-irr"] || {};
    const eur = data["price_eur"] || {};
    const aed = data["price_aed"] || {};
    const gold = data["geram18"] || {};
    const coin = data["sekee"] || {};
    const ons = data["ons"] || {};

    const dollar = toToman(usd.p);
    const dollarLow = toToman(usd.l);
    const dollarHigh = toToman(usd.h);
    const dollarChange = toToman(usd.d);
    const dollarChangePercent = parseFloat(usd.dp) || 0;
    const dollarDirection = usd.dt || (dollarChangePercent >= 0 ? "high" : "low");

    const now = new Date();
    const dateStr = new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "full",
      timeZone: "Asia/Tehran",
    }).format(now);
    const timeStr =
      usd.t ||
      new Intl.DateTimeFormat("fa-IR", {
        timeStyle: "medium",
        timeZone: "Asia/Tehran",
      }).format(now);

    const range = dollarHigh - dollarLow;
    const rangePercent =
      range > 0
        ? Math.min(100, Math.max(0, Math.round(((dollar - dollarLow) / range) * 100)))
        : 50;

    const chartUrl = generateDollarChartUrl(dollarLow, dollar, dollarHigh);

    return {
      dollar,
      dollarLow,
      dollarHigh,
      dollarChange,
      dollarChangePercent,
      dollarDirection,
      tether: toToman(usdt.p),
      euro: toToman(eur.p),
      dirham: toToman(aed.p),
      gold18: toToman(gold.p),
      coinEmami: toToman(coin.p),
      ounceGold: ons.p || "0",
      dateStr,
      timeStr,
      rangePercent,
      chartUrl,
    };
  } catch (err: any) {
    console.error("Failed to fetch live currency from TGJU:", err?.message || err);
    return null;
  }
}

/**
 * Generates a high-resolution dark mode QuickChart URL
 */
export function generateDollarChartUrl(low: number, current: number, high: number): string {
  const mid1 = Math.round(low + (high - low) * 0.25);
  const mid2 = Math.round(low + (high - low) * 0.6);

  const chartConfig = {
    type: "line",
    data: {
      labels: ["کف روز", "صبح", "ظهر", "عصر", "فعلی"],
      datasets: [
        {
          label: "دلار آزاد (تومان)",
          data: [low, mid1, mid2, high, current],
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.15)",
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointBackgroundColor: "#10b981",
        },
      ],
    },
    options: {
      title: {
        display: true,
        text: `نمودار نوسان روزانه دلار بازار آزاد (${current.toLocaleString()} تومان)`,
        fontColor: "#ffffff",
        fontSize: 16,
      },
      legend: {
        labels: { fontColor: "#94a3b8" },
      },
      scales: {
        xAxes: [
          {
            ticks: { fontColor: "#94a3b8" },
            gridLines: { color: "rgba(255,255,255,0.05)" },
          },
        ],
        yAxes: [
          {
            ticks: { fontColor: "#94a3b8" },
            gridLines: { color: "rgba(255,255,255,0.05)" },
          },
        ],
      },
    },
  };

  return `https://quickchart.io/chart?bkg=%230f172a&w=650&h=320&c=${encodeURIComponent(
    JSON.stringify(chartConfig)
  )}`;
}

/**
 * Builds the comprehensive Telegram Dollar & Gold price report with charts
 */
export async function getDollarAndGoldReport(): Promise<{ text: string; chartUrl: string }> {
  const data = await fetchLiveCurrencyData();

  if (!data || data.dollar === 0) {
    return {
      text: "⚠️ <b>خطا در دریافت قیمت‌های لحظه‌ای بازار ارز و طلا.</b>\nلطفاً چند لحظه بعد مجدداً تلاش کنید.",
      chartUrl: "",
    };
  }

  const dirEmoji = data.dollarChangePercent >= 0 ? "🟢" : "🔴";
  const sign = data.dollarChangePercent >= 0 ? "+" : "";

  // Visual Progress Bar (14 blocks)
  const filled = Math.round((data.rangePercent / 100) * 14);
  const bar = "█".repeat(filled) + "░".repeat(14 - filled);

  const kLow = (data.dollarLow / 1000).toFixed(1) + "k";
  const kCur = (data.dollar / 1000).toFixed(1) + "k";
  const kHigh = (data.dollarHigh / 1000).toFixed(1) + "k";

  const text = (
    `💵 <b>قیمت لحظه‌ای دلار، ارز و طلا در بازار آزاد:</b>\n` +
    `📅 <b>تاریخ:</b> ${data.dateStr}\n` +
    `⏰ <b>ساعت ثبت:</b> <code>${data.timeStr}</code>\n\n` +
    `• 🇺🇸 <b>دلار آزاد (تهران):</b> <code>${data.dollar.toLocaleString()}</code> تومان (${dirEmoji} ${sign}${data.dollarChangePercent}%)\n` +
    `• 🪙 <b>تتر (USDT):</b> <code>${data.tether.toLocaleString()}</code> تومان\n` +
    `• 🇪🇺 <b>یورو اروپا:</b> <code>${data.euro.toLocaleString()}</code> تومان\n` +
    `• 🇦🇪 <b>درهم امارات:</b> <code>${data.dirham.toLocaleString()}</code> تومان\n` +
    `• 🥇 <b>طلای ۱۸ عیار:</b> <code>${data.gold18.toLocaleString()}</code> تومان\n` +
    `• 🌕 <b>سکه تمام امامی:</b> <code>${data.coinEmami.toLocaleString()}</code> تومان\n` +
    `• 🌐 <b>انس جهانی طلا:</b> <code>$${data.ounceGold}</code>\n\n` +
    `📊 <b>دامنه نوسان امروز دلار (کف تا سقف):</b>\n` +
    `<code>کف: ${data.dollarLow.toLocaleString()} ت</code> ▕${bar}▏ <code>سقف: ${data.dollarHigh.toLocaleString()} ت</code>\n` +
    `📍 <i>موقعیت فعلی در بازه روز: <b>${data.rangePercent}%</b></i>\n\n` +
    `📈 <b>نمودار شماتیک روند نوسان روزانه:</b>\n` +
    `<pre>` +
    `${kHigh} ┤        ╭─── سقف روز\n` +
    `${kCur} ┤    ╭───╯    ● فعلی (${data.dollar.toLocaleString()})\n` +
    `${kLow} ┴────╯ کف روز` +
    `</pre>`
  );

  return { text, chartUrl: data.chartUrl };
}
