import { CONFIG } from "../config";
import { HttpsProxyAgent } from "https-proxy-agent";

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

export async function getCryptoPrices(): Promise<string> {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether,the-open-network,solana,binancecoin&vs_currencies=usd&include_24hr_change=true";

  try {
    const res = await fetch(url, {
      // @ts-ignore
      agent,
    });
    if (!res.ok) return "خطا در دریافت قیمت‌های لحظه‌ای بازار کریپتو.";

    const data = (await res.json()) as any;
    const coins = [
      ["bitcoin", "Bitcoin (BTC) 🪙"],
      ["ethereum", "Ethereum (ETH) 🔷"],
      ["solana", "Solana (SOL) 🟣"],
      ["the-open-network", "Toncoin (TON) 💎"],
      ["binancecoin", "BNB (BNB) 🟡"],
      ["tether", "Tether (USDT) 💵"],
    ];

    const lines = ["📊 <b>قیمت لحظه‌ای بازار ارز دیجیتال و تتر:</b>\n"];
    for (const [key, name] of coins) {
      const info = data[key] || {};
      const price = info.usd || 0;
      const change = info.usd_24h_change || 0;
      const sign = change >= 0 ? "🟢 +" : "🔴 ";
      const formatted = price >= 1 ? `$${price.toLocaleString()}` : `$${price.toFixed(4)}`;
      lines.push(`• <b>${name}</b>: ${formatted} (${sign}${change.toFixed(2)}%)`);
    }

    return lines.join("\n");
  } catch (err: any) {
    return `خطا در دریافت قیمت کریپتو: ${err.message || err}`;
  }
}
