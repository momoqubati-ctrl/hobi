import {
  defineEventHandler,
  getHeader,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import {
  fundSiteWallet,
  SiteWalletFundingError,
} from "../../../services/siteWalletFundingService";
import { requireHostingOwner } from "../../../services/hostingOwnerAccess";

export const createSiteWalletFundingHandler = (fund = fundSiteWallet) =>
  defineEventHandler(async (event) => {
    setResponseHeader(event, "Cache-Control", "no-store");
    setResponseHeader(event, "Referrer-Policy", "no-referrer");

    const owner = requireHostingOwner(event);
    if (!owner.ok) {
      return { success: false, code: "HOSTING_OWNER_ACCESS_DENIED", message: owner.message };
    }

    const body = await readBody<Record<string, unknown> | null>(event);
    const idempotencyKey = getHeader(event, "idempotency-key");
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "amountCoins" && key !== "externalReference") ||
      typeof body.amountCoins !== "number" ||
      !Number.isSafeInteger(body.amountCoins) ||
      body.amountCoins <= 0 ||
      typeof body.externalReference !== "string" ||
      !body.externalReference.trim() ||
      body.externalReference.trim().length > 255 ||
      !idempotencyKey
    ) {
      setResponseStatus(event, 422);
      return {
        success: false,
        code: "INVALID_FUNDING_INPUT",
        message: "مبلغ التمويل ومرجع التحويل ومفتاح العملية مطلوبة",
      };
    }

    try {
      const result = await fund({
        hostingOwnerUsername: owner.username,
        amountCoins: body.amountCoins,
        externalReference: body.externalReference,
        idempotencyKey,
      });
      return {
        success: true,
        id: result.id,
        amountCoins: result.amountCoins,
        externalReference: result.externalReference,
        siteWalletBalance: result.siteWalletBalance,
        createdAt: result.createdAt,
        replayed: result.replayed,
      };
    } catch (error) {
      if (error instanceof SiteWalletFundingError) {
        const status = error.code === "INVALID_FUNDING" || error.code === "BALANCE_OVERFLOW"
          ? 422
          : error.code === "LEDGER_ACCOUNT_NOT_INITIALIZED"
            ? 503
            : error.code === "LEDGER_INCONSISTENT"
              ? 500
              : 409;
        setResponseStatus(event, status);
        return { success: false, code: error.code, message: error.message };
      }

      console.error("[Site Wallet Funding] Failed:", error);
      setResponseStatus(event, 500);
      return { success: false, code: "SITE_WALLET_FUNDING_FAILED", message: "تعذر تسجيل تمويل الموقع" };
    }
  });

export default createSiteWalletFundingHandler();
