import { useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, LogOut, ShieldCheck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getSiteWalletFundingAttempt,
  type SiteWalletFundingAttempt,
} from "@/lib/site-wallet-funding-intent";
import {
  hostingOwnerPortalHeaders,
  readHostingOwnerApiResponse,
} from "@/lib/hosting-owner-portal-api";

type SiteWalletFundingResult = {
  id: string;
  amountCoins: number;
  externalReference: string;
  siteWalletBalance: string;
  replayed: boolean;
};

type SiteWalletFundingPanelProps = {
  balanceCoins: string | null;
  balanceError: string;
  balanceLoading: boolean;
  onBalanceChange: (balance: string) => void;
  onLogout: () => Promise<void>;
  onRefreshBalance: () => Promise<void>;
  ownerUsername: string;
  portalKey: string;
};

const isFundingResult = (data: Record<string, unknown>): data is Record<string, unknown> & SiteWalletFundingResult =>
  typeof data.id === "string" &&
  typeof data.amountCoins === "number" &&
  Number.isSafeInteger(data.amountCoins) &&
  typeof data.externalReference === "string" &&
  typeof data.siteWalletBalance === "string" &&
  /^\d+$/.test(data.siteWalletBalance) &&
  typeof data.replayed === "boolean";

const formatCoins = (value: string) => new Intl.NumberFormat("en-US").format(BigInt(value));

const SiteWalletFundingPanel = ({
  balanceCoins,
  balanceError,
  balanceLoading,
  onBalanceChange,
  onLogout,
  onRefreshBalance,
  ownerUsername,
  portalKey,
}: SiteWalletFundingPanelProps) => {
  const [amount, setAmount] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [paymentVerified, setPaymentVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fundingResult, setFundingResult] = useState<SiteWalletFundingResult | null>(null);
  const pendingAttempt = useRef<SiteWalletFundingAttempt | null>(null);

  const amountCoins = Number(amount);
  const validAmount = Number.isSafeInteger(amountCoins) && amountCoins > 0;
  const validReference = externalReference.trim().length > 0 && externalReference.trim().length <= 255;

  const submitFunding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validAmount || !validReference || !paymentVerified) return;

    setSaving(true);
    setError("");
    setNotice("");
    setFundingResult(null);

    const intent = { amountCoins, externalReference };
    const attempt = getSiteWalletFundingAttempt(intent, pendingAttempt.current);
    pendingAttempt.current = attempt;

    try {
      const response = await fetch("/api/hosting-owner/fund", {
        method: "POST",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          ...hostingOwnerPortalHeaders(portalKey, attempt.idempotencyKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amountCoins, externalReference: externalReference.trim() }),
      });
      const data = await readHostingOwnerApiResponse(response);
      if (!isFundingResult(data) || data.amountCoins !== amountCoins) {
        throw new Error("استجابة التمويل غير مكتملة");
      }

      pendingAttempt.current = null;
      setFundingResult(data);
      onBalanceChange(data.siteWalletBalance);
      setNotice(data.replayed
        ? "تم تأكيد نتيجة عملية التمويل السابقة دون إضافة رصيد جديد."
        : "تم تسجيل التمويل وتحديث رصيد مخزون الموقع.");
      setAmount("");
      setExternalReference("");
      setPaymentVerified(false);
    } catch (fundingError) {
      setError(fundingError instanceof Error ? fundingError.message : "تعذر تسجيل التمويل");
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    setLogoutBusy(true);
    setError("");
    try {
      await onLogout();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "تعذر تسجيل الخروج");
    } finally {
      setLogoutBusy(false);
    }
  };

  return (
    <section className="min-w-0 w-full max-w-3xl space-y-5" aria-labelledby="site-wallet-title">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">مالك الاستضافة</p>
          <h1 className="break-all text-xl font-semibold" dir="ltr">{ownerUsername}</h1>
        </div>
        <Button type="button" variant="outline" onClick={() => void logout()} disabled={logoutBusy}>
          <LogOut aria-hidden="true" />
          {logoutBusy ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"}
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">
              <WalletCards aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <CardDescription>الرصيد المتاح للشحن والتوزيع</CardDescription>
              <h2
                id="site-wallet-title"
                aria-live="polite"
                aria-busy={balanceLoading}
                className="mt-1 break-words text-2xl font-semibold leading-none tracking-tight"
              >
                {balanceLoading
                  ? "جارٍ تحميل الرصيد…"
                  : balanceCoins === null
                    ? "غير متاح"
                    : `${formatCoins(balanceCoins)} عملة`}
              </h2>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">رصيد مخزون الموقع المسجل في دفتر الأستاذ.</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void onRefreshBalance()} disabled={balanceLoading}>
            تحديث الرصيد
          </Button>
          {balanceError && <p role="alert" className="w-full text-sm text-destructive">{balanceError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold leading-none tracking-tight">تسجيل تمويل جديد</h2>
          <CardDescription>
            سجّل العملات بعد التحقق يدويًا من وصول التحويل الخارجي إلى حساب الموقع.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitFunding} className="space-y-4">
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="site-funding-amount" className="text-sm font-medium">كمية العملات</label>
                <Input
                  id="site-funding-amount"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="site-funding-reference" className="text-sm font-medium">مرجع التحويل</label>
                <Input
                  id="site-funding-reference"
                  value={externalReference}
                  onChange={(event) => setExternalReference(event.target.value)}
                  maxLength={255}
                  required
                  dir="ltr"
                />
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-md border p-3 text-sm leading-6">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-primary"
                checked={paymentVerified}
                onChange={(event) => setPaymentVerified(event.target.checked)}
              />
              <span>
                أؤكد أنني تحققت من وصول التحويل الخارجي قبل إضافة العملات إلى مخزون الموقع.
              </span>
            </label>

            <Button type="submit" disabled={saving || !validAmount || !validReference || !paymentVerified}>
              <ArrowDownToLine aria-hidden="true" />
              {saving ? "جارٍ تسجيل التمويل…" : "تأكيد التمويل"}
            </Button>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
            {fundingResult && (
              <div className="min-w-0 rounded-md border border-emerald-600/30 bg-emerald-50 p-4 text-sm text-emerald-950">
                <p className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  تفاصيل العملية المسجلة
                </p>
                <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-emerald-800">الكمية</dt>
                    <dd>{formatCoins(String(fundingResult.amountCoins))} عملة</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-emerald-800">مرجع التحويل</dt>
                    <dd dir="ltr" className="break-all">{fundingResult.externalReference}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-emerald-800">الرصيد بعد التمويل</dt>
                    <dd>{formatCoins(fundingResult.siteWalletBalance)} عملة</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-emerald-800">رقم العملية</dt>
                    <dd dir="ltr" className="break-all">{fundingResult.id}</dd>
                  </div>
                </dl>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </section>
  );
};

export default SiteWalletFundingPanel;
