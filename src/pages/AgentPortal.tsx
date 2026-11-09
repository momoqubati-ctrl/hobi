import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { KeyRound, LogOut, RefreshCw, ShieldCheck, Wallet, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type WalletAgent = {
  id: string;
  username: string;
  name: string;
  phone: string;
  forcePasswordChange: boolean;
};

type InventoryOrder = {
  id: string;
  requestedCoins: string;
  quotedPriceMinorUnits: string | null;
  currencyCode: string | null;
  paymentInstructions: string | null;
  paymentReference: string | null;
  status: "requested" | "quoted" | "submitted" | "approved" | "rejected";
  rejectionReason: string | null;
  createdAt: string;
};

type AgentPackage = {
  id: string;
  coinAmount: string;
  priceMinorUnits: string;
  currencyCode: string;
  paymentInstructions: string;
  isActive: boolean;
};

type MemberPurchase = {
  id: string;
  memberUserId: string;
  memberUsername: string;
  coinAmount: string;
  priceMinorUnits: string;
  currencyCode: string;
  paymentInstructions: string;
  paymentReference: string | null;
  status: "awaiting_payment" | "submitted" | "approved" | "rejected";
  rejectionReason: string | null;
  hasReceipt: boolean;
};

type ApiResponse = {
  success: boolean;
  agent?: WalletAgent;
  balanceCoins?: unknown;
  orders?: InventoryOrder[];
  packages?: AgentPackage[];
  purchases?: MemberPurchase[];
  message?: string;
};

const readResponse = async (response: Response): Promise<ApiResponse> => {
  const data = (await response.json()) as ApiResponse;
  if (!response.ok || !data.success) {
    throw new Error(data.message || "تعذر تنفيذ الطلب");
  }
  return data;
};

const formatCoins = (value: string) => new Intl.NumberFormat("en-US").format(BigInt(value));

const AgentPortal = () => {
  const { portalKey = "" } = useParams();
  const [portalReady, setPortalReady] = useState(false);
  const [agent, setAgent] = useState<WalletAgent | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inventoryOrders, setInventoryOrders] = useState<InventoryOrder[]>([]);
  const [packages, setPackages] = useState<AgentPackage[]>([]);
  const [memberPurchases, setMemberPurchases] = useState<MemberPurchase[]>([]);
  const [balanceCoins, setBalanceCoins] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceError, setBalanceError] = useState("");
  const [requestedCoins, setRequestedCoins] = useState("1000");
  const [packageDraft, setPackageDraft] = useState({
    coinAmount: "1000",
    priceMinorUnits: "",
    currencyCode: "YER",
    paymentInstructions: "",
  });
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, { reference: string; receipt?: File }>>({});
  const [refreshOrders, setRefreshOrders] = useState(0);
  const [verifiedMemberPayments, setVerifiedMemberPayments] = useState<Record<string, boolean>>({});
  const [memberPurchaseReasons, setMemberPurchaseReasons] = useState<Record<string, string>>({});
  const [memberReceiptUrls, setMemberReceiptUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalanceError("");
    try {
      const data = await readResponse(await fetch("/api/agents/wallet", {
        cache: "no-store",
        headers: { "x-agent-portal-key": portalKey },
      }));
      if (typeof data.balanceCoins !== "string" || !/^\d+$/.test(data.balanceCoins)) {
        throw new Error("استجابة رصيد المحفظة غير صالحة.");
      }
      setBalanceCoins(data.balanceCoins);
    } catch (loadError) {
      setBalanceCoins(null);
      setBalanceError(loadError instanceof Error ? loadError.message : "تعذر تحميل رصيد الوكيل.");
    } finally {
      setBalanceLoading(false);
    }
  }, [portalKey]);

  useEffect(() => {
    let active = true;
    const headers = { "x-agent-portal-key": portalKey };

    const initialize = async () => {
      try {
        await readResponse(await fetch("/api/agents/portal", { headers }));
        if (!active) return;
        setPortalReady(true);

        const response = await fetch("/api/agents/me", { headers });
        if (response.status !== 401) {
          const data = await readResponse(response);
          if (active && data.agent) setAgent(data.agent);
        }
      } catch {
        if (active) setError("رابط دخول الوكلاء غير صالح أو غير مهيأ.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void initialize();
    return () => {
      active = false;
    };
  }, [portalKey]);

  useEffect(() => {
    if (!agent || agent.forcePasswordChange) return;
    let active = true;
    void Promise.all([
      fetch("/api/agents/inventory-orders", { headers: { "x-agent-portal-key": portalKey } }).then(readResponse),
      fetch("/api/agents/packages", { headers: { "x-agent-portal-key": portalKey } }).then(readResponse),
      fetch("/api/agents/coin-purchases", { headers: { "x-agent-portal-key": portalKey } }).then(readResponse),
    ])
      .then(([ordersData, packagesData, purchasesData]) => {
        if (active) {
          setInventoryOrders(ordersData.orders || []);
          setPackages(packagesData.packages || []);
          setMemberPurchases(purchasesData.purchases || []);
        }
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "تعذر تحميل طلبات المخزون");
      });
    return () => {
      active = false;
    };
  }, [agent, portalKey, refreshOrders]);

  useEffect(() => {
    if (!agent || agent.forcePasswordChange) {
      setBalanceCoins(null);
      setBalanceLoading(false);
      return;
    }
    void refreshBalance();
  }, [agent, refreshBalance, refreshOrders]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/agents/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-portal-key": portalKey,
        },
        body: JSON.stringify({ username, password }),
      });
      const data = await readResponse(response);
      if (!data.agent) throw new Error("تعذر تحميل بيانات الوكيل");
      setAgent(data.agent);
      setPassword("");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "تعذر تسجيل الدخول");
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (newPassword.length < 12) {
      setError("يجب أن تتكون كلمة المرور الجديدة من 12 حرفًا على الأقل.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("كلمتا المرور الجديدتان غير متطابقتين.");
      return;
    }

    setSaving(true);
    try {
      await readResponse(await fetch("/api/agents/auth/password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-agent-portal-key": portalKey,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      }));
      setAgent((current) => current ? { ...current, forcePasswordChange: false } : current);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("تم تغيير كلمة المرور بنجاح.");
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "تعذر تغيير كلمة المرور");
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    setError("");
    try {
      await readResponse(await fetch("/api/agents/auth/logout", { method: "POST" }));
      setAgent(null);
      setNotice("");
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "تعذر تسجيل الخروج");
    }
  };

  const createInventoryOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(requestedCoins);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setError("أدخل كمية عملات صحيحة.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await readResponse(await fetch("/api/agents/inventory-orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "x-agent-portal-key": portalKey,
        },
        body: JSON.stringify({ requestedCoins: amount }),
      }));
      setNotice("تم إرسال طلب المخزون إلى مالك الموقع.");
      setRefreshOrders((value) => value + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "تعذر إنشاء طلب المخزون");
    } finally {
      setSaving(false);
    }
  };

  const submitInventoryPayment = async (event: FormEvent<HTMLFormElement>, orderId: string) => {
    event.preventDefault();
    const draft = paymentDrafts[orderId];
    if (!draft?.receipt) {
      setError("أرفق صورة إيصال التحويل.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const formData = new FormData();
      formData.set("paymentReference", draft.reference);
      formData.set("receipt", draft.receipt);
      await readResponse(await fetch(`/api/agents/inventory-orders/${encodeURIComponent(orderId)}/payment`, {
        method: "POST",
        headers: { "x-agent-portal-key": portalKey },
        body: formData,
      }));
      setNotice("تم إرسال إثبات الدفع للمراجعة.");
      setPaymentDrafts((current) => ({ ...current, [orderId]: { reference: "" } }));
      setRefreshOrders((value) => value + 1);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "تعذر إرسال إثبات الدفع");
    } finally {
      setSaving(false);
    }
  };

  const savePackage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const coinAmount = Number(packageDraft.coinAmount);
    const priceMinorUnits = Number(packageDraft.priceMinorUnits);
    if (
      !Number.isSafeInteger(coinAmount) || coinAmount <= 0 ||
      !Number.isSafeInteger(priceMinorUnits) || priceMinorUnits <= 0
    ) {
      setError("أدخل كمية وسعرًا صحيحين للباقة.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await readResponse(await fetch("/api/agents/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-portal-key": portalKey },
        body: JSON.stringify({ ...packageDraft, coinAmount, priceMinorUnits }),
      }));
      setNotice("تم حفظ الباقة؛ الطلبات المفتوحة تحتفظ بسعرها السابق.");
      setRefreshOrders((value) => value + 1);
    } catch (packageError) {
      setError(packageError instanceof Error ? packageError.message : "تعذر حفظ الباقة");
    } finally {
      setSaving(false);
    }
  };

  const deactivatePackage = async (packageId: string) => {
    setSaving(true);
    setError("");
    try {
      await readResponse(await fetch(`/api/agents/packages/${encodeURIComponent(packageId)}`, {
        method: "DELETE",
        headers: { "x-agent-portal-key": portalKey },
      }));
      setNotice("تم إيقاف الباقة.");
      setRefreshOrders((value) => value + 1);
    } catch (packageError) {
      setError(packageError instanceof Error ? packageError.message : "تعذر إيقاف الباقة");
    } finally {
      setSaving(false);
    }
  };

  const reviewMemberPurchase = async (event: FormEvent<HTMLFormElement>, purchase: MemberPurchase) => {
    event.preventDefault();
    if (!verifiedMemberPayments[purchase.id]) {
      setError("أكد التحقق من وصول تحويل العضو قبل اعتماد العملات.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await readResponse(await fetch(
        `/api/agents/coin-purchases/${encodeURIComponent(purchase.id)}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agent-portal-key": portalKey },
          body: JSON.stringify({ paymentVerified: true }),
        },
      ));
      setNotice("تم اعتماد الشراء وتحويل العملات إلى رصيد العضو.");
      setRefreshOrders((value) => value + 1);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "تعذر اعتماد شراء العضو");
    } finally {
      setSaving(false);
    }
  };

  const rejectMemberPurchase = async (purchase: MemberPurchase) => {
    const reason = memberPurchaseReasons[purchase.id]?.trim();
    if (!reason) {
      setError("أدخل سبب رفض عملية الشراء.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await readResponse(await fetch(
        `/api/agents/coin-purchases/${encodeURIComponent(purchase.id)}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agent-portal-key": portalKey },
          body: JSON.stringify({ reason }),
        },
      ));
      setNotice("تم رفض عملية الشراء.");
      setRefreshOrders((value) => value + 1);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "تعذر رفض الشراء");
    } finally {
      setSaving(false);
    }
  };

  const loadMemberReceipt = async (purchaseId: string) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/agents/coin-purchases/${encodeURIComponent(purchaseId)}/proof`,
        { headers: { "x-agent-portal-key": portalKey }, cache: "no-store" },
      );
      if (!response.ok) await readResponse(response);
      const url = URL.createObjectURL(await response.blob());
      setMemberReceiptUrls((current) => {
        if (current[purchaseId]) URL.revokeObjectURL(current[purchaseId]);
        return { ...current, [purchaseId]: url };
      });
    } catch (receiptError) {
      setError(receiptError instanceof Error ? receiptError.message : "تعذر تحميل إيصال العضو");
    } finally {
      setSaving(false);
    }
  };

  const inventoryStatusLabel: Record<InventoryOrder["status"], string> = {
    requested: "بانتظار عرض السعر",
    quoted: "بانتظار الدفع",
    submitted: "قيد مراجعة الدفع",
    approved: "تم اعتماد المخزون",
    rejected: "مرفوض",
  };

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center p-4" aria-busy="true">جارٍ التحقق من رابط الدخول…</main>;
  }

  if (!portalReady) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4" dir="rtl">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p role="alert" className="text-center text-destructive">{error}</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4" dir="rtl">
      <Card className={`w-full ${agent && !agent.forcePasswordChange ? "max-w-3xl" : "max-w-md"}`}>
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            {agent ? <Wallet aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
          </div>
          <CardTitle>{agent ? `مرحبًا ${agent.name}` : "دخول وكيل الشحن"}</CardTitle>
          <p className="text-sm text-muted-foreground">
            مساحة خاصة بوكلاء الشحن
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!agent ? (
            <form onSubmit={login} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="agent-username" className="text-sm font-medium">اسم المستخدم</label>
                <Input
                  id="agent-username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="agent-password" className="text-sm font-medium">كلمة المرور</label>
                <Input
                  id="agent-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  dir="ltr"
                />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}
              </Button>
            </form>
          ) : agent.forcePasswordChange ? (
            <form onSubmit={changePassword} className="space-y-4">
              <p className="text-sm text-amber-700">
                يجب تغيير كلمة المرور المؤقتة قبل متابعة استخدام الحساب.
              </p>
              <div className="space-y-2">
                <label htmlFor="agent-current-password" className="text-sm font-medium">كلمة المرور المؤقتة</label>
                <Input
                  id="agent-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="agent-new-password" className="text-sm font-medium">كلمة المرور الجديدة (12 حرفًا على الأقل)</label>
                <Input
                  id="agent-new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="agent-confirm-password" className="text-sm font-medium">تأكيد كلمة المرور الجديدة</label>
                <Input
                  id="agent-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  dir="ltr"
                />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "جارٍ تحديث كلمة المرور…" : "تغيير كلمة المرور"}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              {agent.phone && (
                <p className="text-sm text-muted-foreground" dir="ltr">
                  {agent.phone}
                </p>
              )}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <WalletCards aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <CardDescription>رصيد مخزون العملات المتاح للبيع</CardDescription>
                      <h2
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
                  <p className="text-sm text-muted-foreground">الرصيد الحالي المخصص لهذا الوكيل.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void refreshBalance()}
                    disabled={balanceLoading}
                  >
                    <RefreshCw aria-hidden="true" />
                    تحديث الرصيد
                  </Button>
                  {balanceError && <p role="alert" className="w-full text-sm text-destructive">{balanceError}</p>}
                </CardContent>
              </Card>
              <div className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                <p>اطلب مخزون العملات، ثم أرفق مرجع التحويل وصورة الإيصال بعد استلام عرض السعر.</p>
              </div>
              <section aria-labelledby="agent-packages-heading" className="space-y-3 rounded-md border p-4">
                <h2 id="agent-packages-heading" className="font-semibold">باقات العملات وأسعار البيع</h2>
                <p className="text-sm text-muted-foreground">
                  السعر بوحدات العملة الصغرى. تعديل الباقة لا يغير طلبات الشراء السابقة.
                </p>
                <form onSubmit={savePackage} className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="agent-package-coins" className="text-sm font-medium">كمية العملات</label>
                    <Input
                      id="agent-package-coins"
                      type="number"
                      min="1"
                      step="1"
                      value={packageDraft.coinAmount}
                      onChange={(event) => setPackageDraft((draft) => ({ ...draft, coinAmount: event.target.value }))}
                      required
                      dir="ltr"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="agent-package-price" className="text-sm font-medium">السعر بوحدات العملة الصغرى</label>
                    <Input
                      id="agent-package-price"
                      type="number"
                      min="1"
                      step="1"
                      value={packageDraft.priceMinorUnits}
                      onChange={(event) => setPackageDraft((draft) => ({ ...draft, priceMinorUnits: event.target.value }))}
                      required
                      dir="ltr"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="agent-package-currency" className="text-sm font-medium">رمز العملة</label>
                    <Input
                      id="agent-package-currency"
                      value={packageDraft.currencyCode}
                      onChange={(event) => setPackageDraft((draft) => ({ ...draft, currencyCode: event.target.value.toUpperCase() }))}
                      minLength={3}
                      maxLength={3}
                      required
                      dir="ltr"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <label htmlFor="agent-package-instructions" className="text-sm font-medium">تعليمات الدفع للعضو</label>
                    <textarea
                      id="agent-package-instructions"
                      className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={packageDraft.paymentInstructions}
                      onChange={(event) => setPackageDraft((draft) => ({ ...draft, paymentInstructions: event.target.value }))}
                      maxLength={4000}
                      required
                    />
                  </div>
                  <Button type="submit" className="sm:col-span-2" disabled={saving}>
                    حفظ / تحديث الباقة
                  </Button>
                </form>
                <ul className="space-y-2">
                  {packages.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                      <span>
                        {Number(item.coinAmount).toLocaleString("ar")} عملة —{" "}
                        {Number(item.priceMinorUnits).toLocaleString("ar")} {item.currencyCode}
                        {!item.isActive && " · متوقفة"}
                      </span>
                      {item.isActive && (
                        <Button type="button" size="sm" variant="outline" onClick={() => void deactivatePackage(item.id)} disabled={saving}>
                          إيقاف الباقة
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              <form onSubmit={createInventoryOrder} className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <label htmlFor="agent-stock-amount" className="text-sm font-medium">كمية العملات المطلوبة</label>
                  <Input
                    id="agent-stock-amount"
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={requestedCoins}
                    onChange={(event) => setRequestedCoins(event.target.value)}
                    required
                    dir="ltr"
                  />
                </div>
                <Button type="submit" disabled={saving}>
                  {saving ? "جارٍ الإرسال…" : "طلب مخزون"}
                </Button>
              </form>
              <section aria-labelledby="agent-stock-orders-heading" className="space-y-3">
                <h2 id="agent-stock-orders-heading" className="font-semibold">طلبات المخزون</h2>
                {inventoryOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد طلبات مخزون حتى الآن.</p>
                ) : inventoryOrders.map((order) => (
                  <article key={order.id} className="space-y-3 rounded-md border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{Number(order.requestedCoins).toLocaleString("ar")} عملة</p>
                      <span className="rounded-full bg-muted px-3 py-1 text-xs">{inventoryStatusLabel[order.status]}</span>
                    </div>
                    {order.quotedPriceMinorUnits && order.currencyCode && (
                      <p className="text-sm">
                        السعر: {Number(order.quotedPriceMinorUnits).toLocaleString("ar")} {order.currencyCode}
                      </p>
                    )}
                    {order.paymentInstructions && (
                      <p className="whitespace-pre-wrap rounded bg-muted/60 p-3 text-sm">
                        {order.paymentInstructions}
                      </p>
                    )}
                    {order.status === "quoted" && (
                      <form onSubmit={(event) => void submitInventoryPayment(event, order.id)} className="space-y-3">
                        <div className="space-y-2">
                          <label htmlFor={`agent-transfer-${order.id}`} className="text-sm font-medium">مرجع التحويل</label>
                          <Input
                            id={`agent-transfer-${order.id}`}
                            value={paymentDrafts[order.id]?.reference || ""}
                            onChange={(event) => setPaymentDrafts((current) => ({
                              ...current,
                              [order.id]: { ...current[order.id], reference: event.target.value },
                            }))}
                            maxLength={255}
                            required
                            dir="ltr"
                          />
                        </div>
                        <div className="space-y-2">
                          <label htmlFor={`agent-receipt-${order.id}`} className="text-sm font-medium">صورة إيصال الدفع (حتى 5 ميغابايت)</label>
                          <Input
                            id={`agent-receipt-${order.id}`}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(event) => setPaymentDrafts((current) => ({
                              ...current,
                              [order.id]: { ...current[order.id], receipt: event.target.files?.[0] },
                            }))}
                            required
                          />
                        </div>
                        <Button type="submit" disabled={saving}>
                          {saving ? "جارٍ الإرسال…" : "إرسال إثبات الدفع"}
                        </Button>
                      </form>
                    )}
                    {order.rejectionReason && (
                      <p className="text-sm text-destructive">سبب الرفض: {order.rejectionReason}</p>
                    )}
                  </article>
                ))}
              </section>
              <section aria-labelledby="agent-member-purchases-heading" className="space-y-3">
                <h2 id="agent-member-purchases-heading" className="font-semibold">طلبات شراء الأعضاء</h2>
                {memberPurchases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد طلبات شراء من الأعضاء.</p>
                ) : memberPurchases.map((purchase) => (
                  <article key={purchase.id} className="space-y-3 rounded-md border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{purchase.memberUsername}</p>
                        <p className="text-sm text-muted-foreground">
                          {Number(purchase.coinAmount).toLocaleString("ar")} عملة ·{" "}
                          {Number(purchase.priceMinorUnits).toLocaleString("ar")} {purchase.currencyCode}
                        </p>
                      </div>
                      <span className="rounded-full bg-muted px-3 py-1 text-xs">{purchase.status}</span>
                    </div>
                    {purchase.paymentReference && (
                      <p className="text-sm" dir="ltr">مرجع التحويل: {purchase.paymentReference}</p>
                    )}
                    {purchase.hasReceipt && (
                      <div className="space-y-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => void loadMemberReceipt(purchase.id)} disabled={saving}>
                          عرض إيصال العضو
                        </Button>
                        {memberReceiptUrls[purchase.id] && (
                          <img
                            src={memberReceiptUrls[purchase.id]}
                            alt={`إيصال شراء العضو ${purchase.memberUsername}`}
                            className="max-h-96 max-w-full rounded border object-contain"
                          />
                        )}
                      </div>
                    )}
                    {purchase.status === "submitted" && (
                      <div className="space-y-3 border-t pt-3">
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={verifiedMemberPayments[purchase.id] === true}
                            onChange={(event) => setVerifiedMemberPayments((current) => ({
                              ...current,
                              [purchase.id]: event.target.checked,
                            }))}
                          />
                          <span>تحققت يدويًا من وصول المبلغ إلى حسابي قبل اعتماد الرصيد.</span>
                        </label>
                        <form onSubmit={(event) => void reviewMemberPurchase(event, purchase)}>
                          <Button type="submit" disabled={saving}>
                            اعتماد وتحويل العملات للعضو
                          </Button>
                        </form>
                        <div className="space-y-2">
                          <label htmlFor={`member-purchase-reason-${purchase.id}`} className="text-sm font-medium">سبب الرفض</label>
                          <textarea
                            id={`member-purchase-reason-${purchase.id}`}
                            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={memberPurchaseReasons[purchase.id] || ""}
                            onChange={(event) => setMemberPurchaseReasons((current) => ({
                              ...current,
                              [purchase.id]: event.target.value,
                            }))}
                            maxLength={500}
                          />
                          <Button type="button" variant="outline" onClick={() => void rejectMemberPurchase(purchase)} disabled={saving}>
                            رفض الشراء
                          </Button>
                        </div>
                      </div>
                    )}
                    {purchase.rejectionReason && (
                      <p className="text-sm text-destructive">سبب الرفض: {purchase.rejectionReason}</p>
                    )}
                  </article>
                ))}
              </section>
              <Button type="button" variant="outline" className="w-full" onClick={() => void logout()}>
                <LogOut className="ml-2 h-4 w-4" aria-hidden="true" />
                تسجيل الخروج
              </Button>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
        </CardContent>
      </Card>
    </main>
  );
};

export default AgentPortal;
