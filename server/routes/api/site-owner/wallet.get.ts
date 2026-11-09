import {
  defineEventHandler,
  getHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { verifyAuthToken } from "../../../services/authService";
import {
  getConfiguredSiteOwnerUsername,
  isSiteOwnerUsername,
} from "../../../services/siteOwner";
import { hasProtectedSiteOwnerRole } from "../../../services/siteOwnerAccess";
import {
  getSiteWalletBalance,
  SiteWalletFundingError,
} from "../../../services/siteWalletFundingService";

type WalletReader = () => Promise<string>;
type SiteOwnerAuthorizer = (userId: string, username: string) => Promise<boolean>;

export const createSiteOwnerWalletHandler = (
  readBalance: WalletReader = getSiteWalletBalance,
  authorize: SiteOwnerAuthorizer = hasProtectedSiteOwnerRole,
) => defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");

  const authorization = getHeader(event, "authorization") || "";
  const bearerToken = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || "";
  const claims = verifyAuthToken(bearerToken);
  if (!claims || claims.type !== undefined || claims.role.toLowerCase() === "guest") {
    setResponseStatus(event, 401);
    return {
      success: false,
      code: "AUTH_REQUIRED",
      message: "يلزم تسجيل الدخول",
    };
  }

  const configuredUsername = getConfiguredSiteOwnerUsername();
  if (!configuredUsername) {
    setResponseStatus(event, 503);
    return {
      success: false,
      code: "SITE_OWNER_ACCESS_UNAVAILABLE",
      message: "ميزة مالك الموقع غير مهيأة",
    };
  }

  if (!isSiteOwnerUsername(claims.username, configuredUsername)) {
    setResponseStatus(event, 403);
    return {
      success: false,
      code: "SITE_OWNER_ACCESS_DENIED",
      message: "غير مصرح بعرض محفظة الموقع",
    };
  }

  try {
    if (!(await authorize(claims.sub, configuredUsername))) {
      setResponseStatus(event, 403);
      return {
        success: false,
        code: "SITE_OWNER_ACCESS_DENIED",
        message: "غير مصرح بعرض محفظة الموقع",
      };
    }

    return { success: true, balanceCoins: await readBalance() };
  } catch (error) {
    if (error instanceof SiteWalletFundingError) {
      setResponseStatus(event, error.code === "LEDGER_ACCOUNT_NOT_INITIALIZED" ? 503 : 500);
      return { success: false, code: error.code, message: error.message };
    }

    console.error("[Site Owner Wallet] Failed to load inventory balance:", error);
    setResponseStatus(event, 500);
    return {
      success: false,
      code: "SITE_OWNER_WALLET_READ_FAILED",
      message: "تعذر تحميل رصيد محفظة الموقع",
    };
  }
});

export default createSiteOwnerWalletHandler();
