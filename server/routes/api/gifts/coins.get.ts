import { defineEventHandler, setResponseStatus } from "h3";
import { getWalletSummary } from "../../../services/coinLedgerService";
import { getUserAuthContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const auth = getUserAuthContext(event);
  if (!auth.ok || !auth.userId || auth.role.toLowerCase() === "guest") {
    setResponseStatus(event, auth.ok ? 403 : 401);
    return { success: false, message: auth.ok ? "رصيد المحفظة متاح للأعضاء فقط" : auth.message };
  }

  try {
    const wallet = await getWalletSummary(auth.userId);
    return { success: true, ...wallet };
  } catch (error) {
    console.error("getWalletSummary error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر جلب الرصيد" };
  }
});
