import { defineEventHandler, getQuery } from "h3";
import { getTopGifts } from "../../../services/giftService";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const limit = parseInt(query.limit as string, 10) || 5;

  try {
    const topGifts = await getTopGifts(limit);
    return { success: true, topGifts };
  } catch (error) {
    console.error("getTopGifts error:", error);
    return { success: false, message: "تعذر جلب الهدايا الأكثر إرسالاً" };
  }
});
