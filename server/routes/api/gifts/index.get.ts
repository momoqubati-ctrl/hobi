import { defineEventHandler } from "h3";
import { listGifts } from "../../../services/giftService";

export default defineEventHandler(async () => {
  try {
    const gifts = await listGifts();
    return { success: true, gifts };
  } catch (error) {
    console.error("listGifts error:", error);
    return { success: false, message: "تعذر جلب الهدايا" };
  }
});
