import { CONFIG } from "../config";
import { HttpsProxyAgent } from "https-proxy-agent";

const agent = CONFIG.USE_PROXY ? new HttpsProxyAgent(CONFIG.PROXY_URL) : undefined;

const WEATHER_CODES: Record<number, string> = {
  0: "آفتابی و کاملاً صاف ☀️",
  1: "عمدتاً صاف 🌤️",
  2: "نیمه‌ابری ⛅",
  3: "تمام‌ابری ☁️",
  45: "مه‌آلود 🌫️",
  48: "مه همراه با یخ‌زدگی 🌫️❄️",
  51: "نم‌نم باران سبک 🌦️",
  53: "نم‌نم باران متوسط 🌦️",
  55: "نم‌نم باران شدید 🌦️",
  56: "باران یخ‌زده سبک 🌨️",
  57: "باران یخ‌زده شدید 🌨️",
  61: "باران ملایم 🌧️",
  63: "باران متوسط 🌧️",
  65: "باران شدید و رگباری ⛈️",
  66: "باران سرد و یخی 🌧️❄️",
  67: "باران شدید یخی 🌧️❄️",
  71: "برف سبک 🌨️",
  73: "برف متوسط 🌨️",
  75: "برف سنگین ❄️",
  77: "دانه‌های برف ❄️",
  80: "رگبار ملایم باران 🌦️",
  81: "رگبار باران متوسط 🌧️",
  82: "رگبار باران بسیار شدید ⛈️",
  85: "رگبار برف سبک 🌨️",
  86: "رگبار برف سنگین ❄️",
  95: "رعد و برق ⚡",
  96: "رعد و برق همراه با تگرگ ⚡❄️",
  99: "طوفان شدید رعد و برق و تگرگ ⚡⛈️",
};

// مختصات دقیق تمام مراکز استان‌ها و شهرهای بزرگ ایران برای پاسخ‌دهی آنی و بی‌نقص
export const IRAN_CITIES: Record<string, { lat: number; lon: number; nameFa: string }> = {
  "تهران": { lat: 35.6892, lon: 51.3890, nameFa: "تهران" },
  "مشهد": { lat: 36.2972, lon: 59.6067, nameFa: "مشهد" },
  "اصفهان": { lat: 32.6546, lon: 51.6680, nameFa: "اصفهان" },
  "شیراز": { lat: 29.5926, lon: 52.5836, nameFa: "شیراز" },
  "تبریز": { lat: 38.0800, lon: 46.2919, nameFa: "تبریز" },
  "کرج": { lat: 35.8327, lon: 50.9915, nameFa: "کرج" },
  "قم": { lat: 34.6401, lon: 50.8764, nameFa: "قم" },
  "اهواز": { lat: 31.3183, lon: 48.6706, nameFa: "اهواز" },
  "کرمانشاه": { lat: 34.3142, lon: 47.0650, nameFa: "کرمانشاه" },
  "ارومیه": { lat: 37.5527, lon: 45.0761, nameFa: "ارومیه" },
  "رشت": { lat: 37.2808, lon: 49.5832, nameFa: "رشت" },
  "زاهدان": { lat: 29.4963, lon: 60.8629, nameFa: "زاهدان" },
  "همدان": { lat: 34.7989, lon: 48.5150, nameFa: "همدان" },
  "کرمان": { lat: 30.2839, lon: 57.0834, nameFa: "کرمان" },
  "یزد": { lat: 31.8974, lon: 54.3569, nameFa: "یزد" },
  "اردبیل": { lat: 38.2498, lon: 48.2973, nameFa: "اردبیل" },
  "بندرعباس": { lat: 27.1832, lon: 56.2666, nameFa: "بندرعباس" },
  "بندر عباس": { lat: 27.1832, lon: 56.2666, nameFa: "بندرعباس" },
  "اراک": { lat: 34.0917, lon: 49.6892, nameFa: "اراک" },
  "زنجان": { lat: 36.6736, lon: 48.4787, nameFa: "زنجان" },
  "سنندج": { lat: 35.3219, lon: 46.9862, nameFa: "سنندج" },
  "قزوین": { lat: 36.2797, lon: 50.0049, nameFa: "قزوین" },
  "خرم‌آباد": { lat: 33.4878, lon: 48.3558, nameFa: "خرم‌آباد" },
  "خرم اباد": { lat: 33.4878, lon: 48.3558, nameFa: "خرم‌آباد" },
  "گرگان": { lat: 36.8456, lon: 54.4393, nameFa: "گرگان" },
  "ساری": { lat: 36.5633, lon: 53.0601, nameFa: "ساری" },
  "شهریار": { lat: 35.6598, lon: 51.0583, nameFa: "شهریار" },
  "شهرکرد": { lat: 32.3256, lon: 50.8644, nameFa: "شهرکرد" },
  "سمنان": { lat: 35.5769, lon: 53.3970, nameFa: "سمنان" },
  "بجنورد": { lat: 37.4761, lon: 57.3290, nameFa: "بجنورد" },
  "ایلام": { lat: 33.6374, lon: 46.4227, nameFa: "ایلام" },
  "بوشهر": { lat: 28.9234, lon: 50.8203, nameFa: "بوشهر" },
  "بیرجند": { lat: 32.8663, lon: 59.2211, nameFa: "بیرجند" },
  "یاسوج": { lat: 30.6684, lon: 51.5876, nameFa: "یاسوج" },
  "کیش": { lat: 26.5325, lon: 53.9789, nameFa: "جزیره کیش" },
  "قشم": { lat: 26.9582, lon: 56.2718, nameFa: "جزیره قشم" },
  "کاشان": { lat: 33.9850, lon: 51.4100, nameFa: "کاشان" },
  "آبادان": { lat: 30.3392, lon: 48.3043, nameFa: "آبادان" },
  "ابادان": { lat: 30.3392, lon: 48.3043, nameFa: "آبادان" },
  "دزفول": { lat: 32.3811, lon: 48.4058, nameFa: "دزفول" },
  "نیشابور": { lat: 36.2133, lon: 58.7958, nameFa: "نیشابور" },
  "بابل": { lat: 36.5513, lon: 52.6789, nameFa: "بابل" },
  "آمل": { lat: 36.4676, lon: 52.3507, nameFa: "آمل" },
  "امول": { lat: 36.4676, lon: 52.3507, nameFa: "آمل" },
  "لاهیجان": { lat: 37.2072, lon: 50.0034, nameFa: "لاهیجان" },
  "بندرانزلی": { lat: 37.4728, lon: 49.4622, nameFa: "بندر انزلی" },
  "انزلی": { lat: 37.4728, lon: 49.4622, nameFa: "بندر انزلی" },
  "چابهار": { lat: 25.2919, lon: 60.6430, nameFa: "چابهار" },
  // Common English names
  "tehran": { lat: 35.6892, lon: 51.3890, nameFa: "تهران" },
  "mashhad": { lat: 36.2972, lon: 59.6067, nameFa: "مشهد" },
  "isfahan": { lat: 32.6546, lon: 51.6680, nameFa: "اصفهان" },
  "esfahan": { lat: 32.6546, lon: 51.6680, nameFa: "اصفهان" },
  "shiraz": { lat: 29.5926, lon: 52.5836, nameFa: "شیراز" },
  "tabriz": { lat: 38.0800, lon: 46.2919, nameFa: "تبریز" },
  "karaj": { lat: 35.8327, lon: 50.9915, nameFa: "کرج" },
  "rasht": { lat: 37.2808, lon: 49.5832, nameFa: "رشت" },
  "ahvaz": { lat: 31.3183, lon: 48.6706, nameFa: "اهواز" },
  "qom": { lat: 34.6401, lon: 50.8764, nameFa: "قم" },
};

export async function getWeather(cityName = "تهران"): Promise<string> {
  const rawCity = cityName.trim() || "تهران";
  const cleanCity = rawCity.toLowerCase().replace(/[ي]/g, "ی").replace(/[ك]/g, "ک");

  try {
    let lat = 35.6892;
    let lon = 51.389;
    let displayCity = rawCity;

    // ۱. بررسی بانک داخلی شهرهای ایران برای سرعت و دقت حداکثری
    if (IRAN_CITIES[cleanCity] || IRAN_CITIES[rawCity]) {
      const match = IRAN_CITIES[cleanCity] || IRAN_CITIES[rawCity];
      lat = match.lat;
      lon = match.lon;
      displayCity = match.nameFa;
    } else {
      // ۲. در صورتی که شهر در بانک داخلی نبود، استعلام ژئوکدینگ جهانی با پشتیبانی زبان فارسی
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(rawCity)}&count=1&language=fa&format=json`;
      const gRes = await fetch(geoUrl, {
        // @ts-ignore
        agent,
      });

      if (gRes.ok) {
        const gData = (await gRes.json()) as any;
        if (gData.results && gData.results.length > 0) {
          lat = gData.results[0].latitude;
          lon = gData.results[0].longitude;
          displayCity = gData.results[0].name || rawCity;
        }
      }
    }

    // دریافت وضعیت لحظه‌ای و پیش‌بینی امروز
    const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
    const wRes = await fetch(wUrl, {
      // @ts-ignore
      agent,
    });

    if (!wRes.ok) return "خطا در دریافت وضعیت آب و هوا از سرور هواشناسی.";

    const wData = (await wRes.json()) as any;
    const cur = wData.current || {};
    const daily = wData.daily || {};
    const cond = WEATHER_CODES[cur.weather_code] || "آرام و معتدل";

    const maxTemp = daily.temperature_2m_max?.[0] !== undefined ? `${daily.temperature_2m_max[0]}°C` : "نامشخص";
    const minTemp = daily.temperature_2m_min?.[0] !== undefined ? `${daily.temperature_2m_min[0]}°C` : "نامشخص";
    const rainProb = daily.precipitation_probability_max?.[0] !== undefined ? `${daily.precipitation_probability_max[0]}%` : "0%";

    return (
      `🌤️ <b>وضعیت زنده آب و هوای ${displayCity}:</b>\n\n` +
      `🌡️ دمای فعلی: <b>${cur.temperature_2m}°C</b> (حس واقعی: ${cur.apparent_temperature}°C)\n` +
      `☁️ شرایط جوی: <b>${cond}</b>\n` +
      `📈 بیشینه و کمینه امروز: <b>${maxTemp} / ${minTemp}</b>\n` +
      `💧 رطوبت نسبی: <b>${cur.relative_humidity_2m}%</b>\n` +
      `🌧️ احتمال بارش: <b>${rainProb}</b>\n` +
      `💨 سرعت باد: <b>${cur.wind_speed_10m} km/h</b>`
    );
  } catch (err: any) {
    return `خطا در استعلام وضعیت آب و هوا: ${err.message || err}`;
  }
}

export function extractWeatherIntent(text: string): { isWeather: boolean; city: string } {
  const clean = text.trim();

  // الگوهای تشخیص نیت هواشناسی
  const weatherPattern =
    /(?:هواشناسی|آب\s*و\s*هوا|اب\s*و\s*هوا|آب‌وهوا|اب‌وهوا|وضعیت\s*هوا|پیش[\s‌]*بینی\s*هوا|دمای\s*هوا|هوا\s*چطور|هوا\s*چگون|هوای\s+|بارون\s*میاد|باران\s*میاد|چقدر\s*سرده|چقدر\s*گرمه|weather|forecast)/i;

  if (!weatherPattern.test(clean)) {
    return { isWeather: false, city: "" };
  }

  // ۱. جستجوی الگوهای صریح مثل «در شهر مشهد»، «هوای شیراز»، «در تبریز»
  const prepMatch = clean.match(/(?:در\s+شهر|شهر|در|هوای|برای|واسه)\s+([^\s?؟!,،.]+)/i);
  if (prepMatch && prepMatch[1]) {
    const candidate = prepMatch[1].trim();
    if (!["امروز", "الان", "فردا", "اینجا", "خارج", "کشور"].includes(candidate)) {
      return { isWeather: true, city: candidate };
    }
  }

  // ۲. حذف کلمات کلیدی برای استخراج نام خالص شهر
  const stripped = clean
    .replace(
      /(?:پیش[\s‌]*بینی\s*هواشناسی|پیش[\s‌]*بینی\s*هوا|پیش[\s‌]*بینی|هواشناسی|آب\s*و\s*هوا|اب\s*و\s*هوا|آب‌وهوا|اب‌وهوا|وضعیت\s*هوا|دمای\s*هوا|هوا\s*چطوره|هوا\s*چطوریه|هوا\s*چگونه\s*است)/gi,
      " "
    )
    .replace(
      /(?:^|\s)(?:وضعیت|چطوره|چطوریه|چنده|چقدره|امروز|الان|فردا|داره|میاد|بارون|باران|برف|هوا|weather|forecast)(?=\s|$|[?؟!,،.])/gi,
      " "
    )
    .replace(/[?؟!,،.]/g, " ")
    .trim();

  const words = stripped.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length > 0) {
    return { isWeather: true, city: words[0] };
  }

  return { isWeather: true, city: "تهران" };
}

