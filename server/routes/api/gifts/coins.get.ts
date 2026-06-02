import { defineEventHandler, getQuery } from "h3";
import { getUserCoins } from "../../../services/giftService";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const userId = query.userId as string;

  if (!userId) {
    return { success: false, message: "userId مطلوب" };
  }

  try {
    const coins = await getUserCoins(userId);
    return { success: true, coins };
  } catch (error) {
    console.error("getUserCoins error:", error);
    return { success: false, message: "تعذر جلب الرصيد" };
  }
});
