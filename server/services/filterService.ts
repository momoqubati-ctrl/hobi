import { dbPool } from "../db";
import { getIO } from "../socket";

export type FilterAction = "block" | "watch" | "allow";

interface FilterResult {
  originalText: string;
  filteredText: string;
  hasMatch: boolean;
  action: FilterAction | null;
  matchedWords: string[];
}

// ذاكرة مؤقتة لقواعد الفلتر لضمان السرعة القصوى
let cachedRules: { v: string, path: string }[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 30000; // تحديث القواعد كل 30 ثانية تلقائياً

/**
 * جلب القواعد مع دعم التخزين المؤقت
 */
async function getRules() {
  const now = Date.now();
  if (cachedRules && (now - lastCacheTime < CACHE_TTL)) {
    return cachedRules;
  }

  try {
    const queryPromise = dbPool.query("SELECT v, path FROM notext");
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Query timeout")), 8000)
    );
    const result = await Promise.race([queryPromise, timeoutPromise]) as any;
    
    cachedRules = result.rows;
    lastCacheTime = now;
    return cachedRules;
  } catch (err) {
    console.error("Failed to fetch filter rules:", err);
    return cachedRules || [];
  }
}

/**
 * وظيفة لتفريغ الكاش يدوياً (تستدعى عند إضافة كلمة جديدة من لوحة التحكم)
 */
export const clearFilterCache = () => {
  cachedRules = null;
};

/**
 * يقوم بفحص النص مقابل قواعد الفلتر بسرعة فائقة
 */
export const processText = async (params: {
  text: string;
  source: string;
  user: { username: string; topic: string; ip: string };
  target?: string;
}): Promise<FilterResult> => {
  const { text, source, user, target } = params;
  
  if (!text) return { originalText: "", filteredText: "", hasMatch: false, action: null, matchedWords: [] };

  // جلب القواعد من الكاش (سريع جداً)
  const rules = await getRules();

  const bmsgs = rules.filter(r => r.path === 'bmsgs').map(r => String(r.v || "").trim()).filter(Boolean);
  const wmsgs = rules.filter(r => r.path === 'wmsgs').map(r => String(r.v || "").trim()).filter(Boolean);
  const amsgs = rules.filter(r => r.path === 'amsgs').map(r => String(r.v || "").trim()).filter(Boolean);

  let filteredText = text;
  let hasBlockMatch = false;
  let hasWatchMatch = false;
  const matchedWords: string[] = [];

  // التحقق من الكلمات المسموحة
  for (const word of amsgs) {
    if (text.includes(word)) return { originalText: text, filteredText: text, hasMatch: false, action: "allow", matchedWords: [] };
  }

  // فحص الكلمات الممنوعة
  for (const word of bmsgs) {
    if (text.includes(word)) {
      hasBlockMatch = true;
      if (!matchedWords.includes(word)) matchedWords.push(word);
      const mask = "*".repeat(word.length);
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filteredText = filteredText.replace(new RegExp(escapedWord, 'g'), mask);
    }
  }

  // فحص الكلمات المراقبة
  for (const word of wmsgs) {
    if (text.includes(word)) {
      hasWatchMatch = true;
      if (!matchedWords.includes(word)) matchedWords.push(word);
    }
  }

  const finalAction: FilterAction | null = hasBlockMatch ? "block" : hasWatchMatch ? "watch" : null;

  if (finalAction) {
    // التسجيل في السجل يتم في الخلفية لعدم تعطيل الرسالة
    logDetection({
      v: matchedWords.join(", "),
      msg: text,
      source,
      target: target || "",
      user,
      action: finalAction
    }).catch(err => console.error("Logging failed", err));

    const io = getIO();
    if (io) {
      io.to("moderators_alerts").emit("filter_alert", {
        type: finalAction,
        word: matchedWords[0],
        user: user.topic,
        source,
        text
      });
    }
  }

  return { originalText: text, filteredText, hasMatch: !!finalAction, action: finalAction, matchedWords };
};

async function logDetection(data: any) {
  try {
    await dbPool.query(
      `INSERT INTO histletter (ip, msg, topic, v, "time", target, source, path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [data.user.ip, data.msg, data.user.topic, data.v, String(Date.now()), data.target, data.source, data.action === "block" ? "bmsgs" : "wmsgs"]
    );
  } catch (err) {
    console.error("Filter logging failed:", err);
  }
}