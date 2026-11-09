import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Eye, RefreshCw, WalletCards, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { getActiveSession } from "@/lib/authSession";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type WalletResponse = {
  success?: unknown;
  balanceCoins?: unknown;
  message?: unknown;
  orders?: unknown;
};

type InventoryOrder = {
  id: string;
  agentId: string;
  agentUsername: string;
  agentName: string;
  requestedCoins: string;
  quotedPriceMinorUnits: string | null;
  currencyCode: string | null;
  paymentInstructions: string | null;
  paymentReference: string | null;
  status: "requested" | "quoted" | "submitted" | "approved" | "rejected";
  rejectionReason: string | null;
  hasReceipt: boolean;
};

const isWalletResponse = (value: unknown): value is WalletResponse =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const formatCoins = (value: string) => new Intl.NumberFormat("en-US").format(BigInt(value));

const SiteOwnerWalletPanel = () => {
  const [balanceCoins, setBalanceCoins] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orders, setOrders] = useState<InventoryOrder[]>([]);
  const [busyOrderId, setBusyOrderId] = useState("");
  const [notice, setNotice] = useState("");
  const [quoteDrafts, setQuoteDrafts] = useState<Record<string, {
    priceMinorUnits: string;
    currencyCode: string;
    paymentInstructions: string;
  }>>({});
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [verifiedPayments, setVerifiedPayments] = useState<Record<string, boolean>>({});
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({});
  const receiptUrlsRef = useRef<Record<string, string>>({});

  const refreshBalance = useCallback(async () => {
    setLoading(true);
    setError("");

    const session = getActiveSession();
    if (!session) {
      setBalanceCoins(null);
      setError("انتهت الجلسة؛ يرجى تسجيل الدخول مجددًا.");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/site-owner/wallet", {
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: { Authorization: getOwnerAuthorization(), "Content-Type": "application/json" },
      });
      const data: unknown = await response.json();
      if (!isWalletResponse(data) || data.success !== true) {
        throw new Error(
          isWalletResponse(data) && typeof data.message === "string"
            ? data.message
            : "تعذر تحميل رصيد محفظة الموقع.",
        );
      }
      if (typeof data.balanceCoins !== "string" || !/^\d+$/.test(data.balanceCoins)) {
        throw new Error("استجابة رصيد المحفظة غير صالحة.");
      }

      setBalanceCoins(data.balanceCoins);
    } catch (loadError) {
      setBalanceCoins(null);
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل رصيد محفظة الموقع.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  const loadOrders = useCallback(async () => {
    const session = getActiveSession();
    if (!session) {
      setError("انتهت الجلسة؛ يرجى تسجيل الدخول مجددًا.");
      return;
    }
    try {
      const response = await fetch("/api/site-owner/inventory-orders", {
        cache: "no-store",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: { Authorization: getOwnerAuthorization() },
      });
      const data: unknown = await response.json();
      if (!response.ok || !isWalletResponse(data) || data.success !== true || !Array.isArray(data.orders)) {
        throw new Error(
          isWalletResponse(data) && typeof data.message === "string"
            ? data.message
            : "تعذر تحميل طلبات شحن الوكلاء.",
        );
      }
      setOrders(data.orders as InventoryOrder[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل طلبات شحن الوكلاء.");
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => () => {
    Object.values(receiptUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const getOwnerAuthorization = () => {
    const session = getActiveSession();
    if (!session) throw new Error("انتهت الجلسة؛ يرجى تسجيل الدخول مجددًا.");
    return "Bearer " + session.token;
  };

  const submitQuote = async (event: React.FormEvent<HTMLFormElement>, order: InventoryOrder) => {
    event.preventDefault();
    const draft = quoteDrafts[order.id] || {
      priceMinorUnits: "",
      currencyCode: "YER",
      paymentInstructions: "",
    };
    const amount = Number(draft.priceMinorUnits);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setError("أدخل السعر بوحدات العملة الصغرى كعدد صحيح موجب.");
      return;
    }
    setBusyOrderId(order.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/site-owner/inventory-orders/${encodeURIComponent(order.id)}/quote`, {
        method: "POST",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: { Authorization: getOwnerAuthorization(), "Content-Type": "application/json" },
        body: JSON.stringify({
          priceMinorUnits: amount,
          currencyCode: draft.currencyCode.toUpperCase(),
          paymentInstructions: draft.paymentInstructions,
        }),
      });
      const data: unknown = await response.json();
      if (!response.ok || !isWalletResponse(data) || data.success !== true) {
        throw new Error(isWalletResponse(data) && typeof data.message === "string"
          ? data.message
          : "تعذر إرسال عرض السعر.");
      }
      setNotice("تم إرسال عرض السعر إلى الوكيل.");
      await loadOrders();
    } catch (quoteError) {
      setError(quoteError instanceof Error ? quoteError.message : "تعذر إرسال عرض السعر.");
    } finally {
      setBusyOrderId("");
    }
  };

  const reviewOrder = async (order: InventoryOrder, action: "approve" | "reject") => {
    if (action === "approve" && !verifiedPayments[order.id]) {
      setError("أكد التحقق من وصول التحويل الخارجي قبل الاعتماد.");
      return;
    }
    if (action === "reject" && !rejectReasons[order.id]?.trim()) {
      setError("أدخل سبب رفض الطلب.");
      return;
    }
    setBusyOrderId(order.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/site-owner/inventory-orders/${encodeURIComponent(order.id)}/${action}`,
        {
          method: "POST",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          headers: { Authorization: getOwnerAuthorization(), "Content-Type": "application/json" },
          body: JSON.stringify(action === "approve"
            ? { paymentVerified: true }
            : { reason: rejectReasons[order.id] }),
        },
      );
      const data: unknown = await response.json();
      if (!response.ok || !isWalletResponse(data) || data.success !== true) {
        throw new Error(isWalletResponse(data) && typeof data.message === "string"
          ? data.message
          : "تعذر مراجعة الطلب.");
      }
      setNotice(action === "approve" ? "تم اعتماد مخزون الوكيل وتحديث دفتر الأستاذ." : "تم رفض طلب المخزون.");
      if (action === "approve") await refreshBalance();
      await loadOrders();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "تعذر مراجعة الطلب.");
    } finally {
      setBusyOrderId("");
    }
  };

  const loadReceipt = async (order: InventoryOrder) => {
    setBusyOrderId(order.id);
    setError("");
    try {
      const response = await fetch(
        `/api/site-owner/inventory-orders/${encodeURIComponent(order.id)}/proof`,
        {
          cache: "no-store",
          credentials: "same-origin",
          referrerPolicy: "no-referrer",
          headers: { Authorization: getOwnerAuthorization() },
        },
      );
      if (!response.ok) {
        const data: unknown = await response.json();
        throw new Error(isWalletResponse(data) && typeof data.message === "string"
          ? data.message
          : "تعذر تحميل الإيصال.");
      }
      const url = URL.createObjectURL(await response.blob());
      if (receiptUrlsRef.current[order.id]) URL.revokeObjectURL(receiptUrlsRef.current[order.id]);
      receiptUrlsRef.current = { ...receiptUrlsRef.current, [order.id]: url };
      setReceiptUrls(receiptUrlsRef.current);
    } catch (receiptError) {
      setError(receiptError instanceof Error ? receiptError.message : "تعذر تحميل الإيصال.");
    } finally {
      setBusyOrderId("");
    }
  };

  return (
    <section className="flex-1 overflow-y-auto p-4 md:p-6 rtl" aria-labelledby="site-owner-wallet-title">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <header>
          <h1 id="site-owner-wallet-title" className="text-xl font-semibold">محفظة الموقع</h1>
          <p className="mt-1 text-sm text-muted-foreground">إدارة مخزون الوكلاء والتحقق اليدوي من التحويلات.</p>
        </header>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">
                <WalletCards aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <CardDescription>مخزون العملات المتاح للتوزيع</CardDescription>
                <h2
                  aria-live="polite"
                  aria-busy={loading}
                  className="mt-1 break-words text-2xl font-semibold leading-none tracking-tight"
                >
                  {loading
                    ? "جارٍ تحميل الرصيد…"
                    : balanceCoins === null
                      ? "غير متاح"
                      : `${formatCoins(balanceCoins)} عملة`}
                </h2>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">رصيد مخزون الموقع من دفتر الأستاذ.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refreshBalance()}
              disabled={loading}
            >
              <RefreshCw aria-hidden="true" />
              تحديث الرصيد
            </Button>
            {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">طلبات مخزون الوكلاء</h2>
            <CardDescription>
              لا تعتمد الطلب إلا بعد التحقق من وصول التحويل فعليًا. يعتمد النقل على رصيد مخزون الموقع فقط.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="outline" onClick={() => void loadOrders()} disabled={Boolean(busyOrderId)}>
                <RefreshCw aria-hidden="true" />
                تحديث الطلبات
              </Button>
            </div>
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد طلبات مخزون.</p>
            ) : orders.map((order) => (
              <article key={order.id} className="space-y-3 rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{order.agentName} (@{order.agentUsername})</p>
                    <p className="text-sm text-muted-foreground">
                      {formatCoins(order.requestedCoins)} عملة · {order.status}
                    </p>
                  </div>
                  {order.quotedPriceMinorUnits && order.currencyCode && (
                    <p className="text-sm">
                      {formatCoins(order.quotedPriceMinorUnits)} {order.currencyCode}
                    </p>
                  )}
                </div>

                {order.status === "requested" && (
                  <form onSubmit={(event) => void submitQuote(event, order)} className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label htmlFor={`inventory-price-${order.id}`} className="text-sm font-medium">
                        السعر بوحدات العملة الصغرى
                      </label>
                      <Input
                        id={`inventory-price-${order.id}`}
                        type="number"
                        min="1"
                        step="1"
                        value={quoteDrafts[order.id]?.priceMinorUnits || ""}
                        onChange={(event) => setQuoteDrafts((current) => ({
                          ...current,
                          [order.id]: {
                            priceMinorUnits: event.target.value,
                            currencyCode: current[order.id]?.currencyCode || "YER",
                            paymentInstructions: current[order.id]?.paymentInstructions || "",
                          },
                        }))}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor={`inventory-currency-${order.id}`} className="text-sm font-medium">رمز العملة (3 أحرف)</label>
                      <Input
                        id={`inventory-currency-${order.id}`}
                        value={quoteDrafts[order.id]?.currencyCode || "YER"}
                        onChange={(event) => setQuoteDrafts((current) => ({
                          ...current,
                          [order.id]: {
                            priceMinorUnits: current[order.id]?.priceMinorUnits || "",
                            currencyCode: event.target.value,
                            paymentInstructions: current[order.id]?.paymentInstructions || "",
                          },
                        }))}
                        minLength={3}
                        maxLength={3}
                        required
                        dir="ltr"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <label htmlFor={`inventory-instructions-${order.id}`} className="text-sm font-medium">تعليمات الدفع</label>
                      <Textarea
                        id={`inventory-instructions-${order.id}`}
                        value={quoteDrafts[order.id]?.paymentInstructions || ""}
                        onChange={(event) => setQuoteDrafts((current) => ({
                          ...current,
                          [order.id]: {
                            priceMinorUnits: current[order.id]?.priceMinorUnits || "",
                            currencyCode: current[order.id]?.currencyCode || "YER",
                            paymentInstructions: event.target.value,
                          },
                        }))}
                        maxLength={4000}
                        required
                      />
                    </div>
                    <Button type="submit" className="sm:col-span-2" disabled={busyOrderId === order.id}>
                      إرسال عرض الدفع
                    </Button>
                  </form>
                )}

                {order.paymentReference && (
                  <p className="text-sm" dir="ltr">مرجع التحويل: {order.paymentReference}</p>
                )}
                {order.hasReceipt && (
                  <div className="space-y-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void loadReceipt(order)} disabled={busyOrderId === order.id}>
                      <Eye aria-hidden="true" />
                      عرض الإيصال الخاص
                    </Button>
                    {receiptUrls[order.id] && (
                      <img
                        src={receiptUrls[order.id]}
                        alt={`إيصال الدفع لطلب ${order.id}`}
                        className="max-h-96 max-w-full rounded border object-contain"
                      />
                    )}
                  </div>
                )}
                {order.status === "submitted" && (
                  <div className="space-y-3 border-t pt-3">
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={verifiedPayments[order.id] === true}
                        onChange={(event) => setVerifiedPayments((current) => ({
                          ...current,
                          [order.id]: event.target.checked,
                        }))}
                      />
                      <span>تحققت يدويًا من وصول مبلغ التحويل إلى حساب الموقع.</span>
                    </label>
                    <Button type="button" onClick={() => void reviewOrder(order, "approve")} disabled={busyOrderId === order.id}>
                      <CheckCircle2 aria-hidden="true" />
                      اعتماد ونقل العملات
                    </Button>
                    <div className="space-y-2">
                      <label htmlFor={`inventory-reject-${order.id}`} className="text-sm font-medium">سبب الرفض</label>
                      <Textarea
                        id={`inventory-reject-${order.id}`}
                        value={rejectReasons[order.id] || ""}
                        onChange={(event) => setRejectReasons((current) => ({
                          ...current,
                          [order.id]: event.target.value,
                        }))}
                        maxLength={500}
                      />
                      <Button type="button" variant="outline" onClick={() => void reviewOrder(order, "reject")} disabled={busyOrderId === order.id}>
                        <XCircle aria-hidden="true" />
                        رفض الطلب
                      </Button>
                    </div>
                  </div>
                )}
                {order.rejectionReason && (
                  <p className="text-sm text-destructive">سبب الرفض: {order.rejectionReason}</p>
                )}
              </article>
            ))}
            {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      </div>
    </section>
  );
};

export default SiteOwnerWalletPanel;
