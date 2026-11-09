import {
  defineEventHandler,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { requireHostingOwner } from "../../../services/hostingOwnerAccess";
import {
  getSiteWalletBalance,
  SiteWalletFundingError,
} from "../../../services/siteWalletFundingService";

export const createSiteWalletBalanceHandler = (readBalance = getSiteWalletBalance) =>
  defineEventHandler(async (event) => {
    setResponseHeader(event, "Cache-Control", "no-store");
    setResponseHeader(event, "Referrer-Policy", "no-referrer");

    const owner = requireHostingOwner(event);
    if (!owner.ok) {
      return {
        success: false,
        code: "HOSTING_OWNER_ACCESS_DENIED",
        message: owner.message,
      };
    }

    try {
      return { success: true, balanceCoins: await readBalance() };
    } catch (error) {
      if (error instanceof SiteWalletFundingError) {
        setResponseStatus(event, error.code === "LEDGER_ACCOUNT_NOT_INITIALIZED" ? 503 : 500);
        return { success: false, code: error.code, message: error.message };
      }

      console.error("[Site Wallet Balance] Failed:", error);
      setResponseStatus(event, 500);
      return {
        success: false,
        code: "SITE_WALLET_BALANCE_FAILED",
        message: "تعذر تحميل رصيد محفظة الموقع",
      };
    }
  });

export default createSiteWalletBalanceHandler();
