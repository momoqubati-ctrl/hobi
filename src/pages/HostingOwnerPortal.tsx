import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import HostingOwnerLoginForm from "@/components/hosting-owner/HostingOwnerLoginForm";
import SiteWalletFundingPanel from "@/components/hosting-owner/SiteWalletFundingPanel";
import {
  hostingOwnerPortalHeaders,
  readHostingOwnerApiResponse,
} from "@/lib/hosting-owner-portal-api";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const getOwnerUsername = (data: Record<string, unknown>) => {
  const owner = data.owner;
  return isRecord(owner) && typeof owner.username === "string" ? owner.username : null;
};

const readBalance = async (portalKey: string) => {
  const response = await fetch("/api/hosting-owner/balance", {
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
    headers: hostingOwnerPortalHeaders(portalKey),
  });
  const data = await readHostingOwnerApiResponse(response);
  if (typeof data.balanceCoins !== "string" || !/^\d+$/.test(data.balanceCoins)) {
    throw new Error("تعذر قراءة رصيد مخزون الموقع");
  }
  return data.balanceCoins;
};

const HostingOwnerPortal = () => {
  const { portalKey = "" } = useParams();
  const [checking, setChecking] = useState(true);
  const [portalAvailable, setPortalAvailable] = useState(false);
  const [ownerUsername, setOwnerUsername] = useState<string | null>(null);
  const [balanceCoins, setBalanceCoins] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState("");
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalanceError("");
    try {
      setBalanceCoins(await readBalance(portalKey));
    } catch (balanceFailure) {
      setBalanceError(balanceFailure instanceof Error
        ? balanceFailure.message
        : "تعذر تحميل رصيد محفظة الموقع");
    } finally {
      setBalanceLoading(false);
    }
  }, [portalKey]);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const headers = hostingOwnerPortalHeaders(portalKey);
        const portalResponse = await fetch("/api/hosting-owner/portal", {
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          headers,
        });
        await readHostingOwnerApiResponse(portalResponse);
        if (!active) return;
        setPortalAvailable(true);

        const sessionResponse = await fetch("/api/hosting-owner/auth/session", {
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          headers,
        });
        const session = await readHostingOwnerApiResponse(sessionResponse);
        if (session.authenticated === false) return;
        if (session.authenticated !== true) {
          throw new Error("تعذر التحقق من جلسة مالك الاستضافة");
        }
        const username = getOwnerUsername(session);
        if (!username) throw new Error("تعذر التحقق من جلسة مالك الاستضافة");
        if (!active) return;
        setOwnerUsername(username);
        try {
          setBalanceCoins(await readBalance(portalKey));
        } catch (balanceFailure) {
          if (active) {
            setBalanceError(balanceFailure instanceof Error
              ? balanceFailure.message
              : "تعذر تحميل رصيد محفظة الموقع");
          }
        }
      } catch (portalFailure) {
        if (active) {
          setError(portalFailure instanceof Error
            ? portalFailure.message
            : "رابط بوابة مالك الاستضافة غير صالح أو غير مهيأ");
        }
      } finally {
        if (active) setChecking(false);
      }
    };

    void initialize();
    return () => {
      active = false;
    };
  }, [portalKey]);

  const login = async (username: string, password: string): Promise<boolean> => {
    setLoginBusy(true);
    setError("");
    try {
      const response = await fetch("/api/hosting-owner/auth/login", {
        method: "POST",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          ...hostingOwnerPortalHeaders(portalKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });
      const data = await readHostingOwnerApiResponse(response);
      const authenticatedUsername = getOwnerUsername(data);
      if (!authenticatedUsername) throw new Error("تعذر تحميل بيانات مالك الاستضافة");
      setOwnerUsername(authenticatedUsername);
      await refreshBalance();
      return true;
    } catch (loginFailure) {
      setError(loginFailure instanceof Error ? loginFailure.message : "تعذر تسجيل الدخول");
      return false;
    } finally {
      setLoginBusy(false);
    }
  };

  const logout = async () => {
    const response = await fetch("/api/hosting-owner/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
      headers: hostingOwnerPortalHeaders(portalKey),
    });
    await readHostingOwnerApiResponse(response);
    setOwnerUsername(null);
    setBalanceCoins(null);
    setBalanceError("");
    setError("");
  };

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4" dir="rtl" aria-busy="true">
        <p role="status">جارٍ التحقق من رابط الدخول…</p>
      </main>
    );
  }

  if (!portalAvailable) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4" dir="rtl">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p role="alert" className="text-center text-destructive">
              {error || "رابط بوابة مالك الاستضافة غير صالح أو غير مهيأ."}
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen justify-center bg-muted/40 p-4 sm:p-8" dir="rtl">
      <div className="flex w-full max-w-5xl items-center justify-center">
        {ownerUsername ? (
          <SiteWalletFundingPanel
            balanceCoins={balanceCoins}
            balanceError={balanceError}
            balanceLoading={balanceLoading}
            onBalanceChange={setBalanceCoins}
            onLogout={logout}
            onRefreshBalance={refreshBalance}
            ownerUsername={ownerUsername}
            portalKey={portalKey}
          />
        ) : (
          <HostingOwnerLoginForm busy={loginBusy} error={error} onSubmit={login} />
        )}
      </div>
    </main>
  );
};

export default HostingOwnerPortal;
