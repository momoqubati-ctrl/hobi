"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Coins, Trophy, Loader2, Search, X, Check, RefreshCw } from 'lucide-react';
import { showSuccess, showError } from "@/utils/toast";
import { useRealtimeStore } from "@/lib/realtime-store";
import {
  clearGiftSendIdempotencyKey,
  getGiftSendIdempotencyKey,
} from "@/lib/gift-send-idempotency";

interface Gift {
  id: string;
  name: string;
  icon: string;
  price: number;
  category: string;
}

interface TopGift {
  name: string;
  icon: string;
  count: number;
}

interface StoredUser {
  id?: string;
}

interface GiftRecipient {
  id: string;
  name?: string;
  username?: string;
  avatar?: string;
  pic?: string;
  nameColor?: string;
  socketId?: string;
  role?: string;
}

interface CoinPackage {
  agentId: string;
  agentUsername: string;
  agentName: string;
  packageId: string;
  coinAmount: string;
  priceMinorUnits: string;
  currencyCode: string;
  paymentInstructions: string;
}

interface CoinPurchase {
  id: string;
  agentId: string;
  agentName: string;
  coinAmount: string;
  priceMinorUnits: string;
  currencyCode: string;
  paymentInstructions: string;
  paymentReference: string | null;
  status: "awaiting_payment" | "submitted" | "approved" | "rejected";
  rejectionReason: string | null;
}

const getStoredUser = (): StoredUser | null => {
  try {
    const user: unknown = JSON.parse(localStorage.getItem("user") || "null");
    return user && typeof user === "object" ? user as StoredUser : null;
  } catch {
    return null;
  }
};

const getAuthHeaders = () => {
  const token = localStorage.getItem("authToken") || localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const formatCoins = (value: string) => BigInt(value).toLocaleString();

const GiftStore = () => {
  const { onlineUsers } = useRealtimeStore();

  const [gifts, setGifts] = useState<Gift[]>([]);
  const [coins, setCoins] = useState("0");
  const [cashableCoins, setCashableCoins] = useState("0");
  const [topGifts, setTopGifts] = useState<TopGift[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [coinPackages, setCoinPackages] = useState<CoinPackage[]>([]);
  const [coinPurchases, setCoinPurchases] = useState<CoinPurchase[]>([]);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [purchaseError, setPurchaseError] = useState("");
  const [activePurchase, setActivePurchase] = useState<CoinPurchase | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentReceipt, setPaymentReceipt] = useState<File | null>(null);
  const pendingPurchaseAttempt = useRef<{ packageId: string; key: string } | null>(null);

  // Send dialog
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [selectedGift, setSelectedGift] = useState<Gift | null>(null);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState<GiftRecipient | null>(null);

  const currentUser = getStoredUser();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [giftsRes, topRes] = await Promise.all([
        fetch("/api/gifts"),
        fetch("/api/gifts/top"),
      ]);
      const giftsData = await giftsRes.json();
      const topData = await topRes.json();

      if (giftsData.success) setGifts(giftsData.gifts);
      if (topData.success) setTopGifts(topData.topGifts);

      if (currentUser?.id) {
        const coinsRes = await fetch("/api/gifts/coins", { headers: getAuthHeaders() });
        const coinsData = await coinsRes.json();
        if (coinsData.success) {
          setCoins(coinsData.coins);
          setCashableCoins(coinsData.cashableCoins);
        }
      }
    } catch (err) {
      console.error("Failed to fetch gift store data", err);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refreshCoinPurchases = useCallback(async () => {
    if (!currentUser?.id) return;
    setPurchaseLoading(true);
    setPurchaseError("");
    try {
      const [packagesResponse, purchasesResponse] = await Promise.all([
        fetch("/api/coin-purchases/agents", { headers: getAuthHeaders(), cache: "no-store" }),
        fetch("/api/coin-purchases", { headers: getAuthHeaders(), cache: "no-store" }),
      ]);
      const [packagesData, purchasesData] = await Promise.all([
        packagesResponse.json(),
        purchasesResponse.json(),
      ]);
      if (!packagesResponse.ok || !packagesData.success) {
        throw new Error(packagesData.message || "تعذر تحميل باقات العملات");
      }
      if (!purchasesResponse.ok || !purchasesData.success) {
        throw new Error(purchasesData.message || "تعذر تحميل سجل الشراء");
      }
      setCoinPackages(packagesData.packages);
      setCoinPurchases(purchasesData.purchases);

      const walletResponse = await fetch("/api/gifts/coins", { headers: getAuthHeaders(), cache: "no-store" });
      const walletData = await walletResponse.json();
      if (walletData.success) {
        setCoins(walletData.coins);
        setCashableCoins(walletData.cashableCoins);
      }
    } catch (error) {
      setPurchaseError(error instanceof Error ? error.message : "تعذر تحميل معلومات شراء العملات");
    } finally {
      setPurchaseLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (purchaseDialogOpen) void refreshCoinPurchases();
  }, [purchaseDialogOpen, refreshCoinPurchases]);

  const beginCoinPurchase = async (item: CoinPackage) => {
    setPurchaseSaving(true);
    setPurchaseError("");
    if (pendingPurchaseAttempt.current?.packageId !== item.packageId) {
      pendingPurchaseAttempt.current = { packageId: item.packageId, key: crypto.randomUUID() };
    }
    try {
      const response = await fetch("/api/coin-purchases", {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
          "Idempotency-Key": pendingPurchaseAttempt.current.key,
        },
        body: JSON.stringify({ agentId: item.agentId, packageId: item.packageId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.purchase) {
        throw new Error(data.message || "تعذر بدء طلب الشراء");
      }
      pendingPurchaseAttempt.current = null;
      setActivePurchase({
        id: data.purchase.id,
        agentId: data.purchase.agentId,
        agentName: item.agentName,
        coinAmount: data.purchase.coinAmount,
        priceMinorUnits: data.purchase.priceMinorUnits,
        currencyCode: data.purchase.currencyCode,
        paymentInstructions: data.purchase.paymentInstructions,
        paymentReference: null,
        status: data.purchase.status,
        rejectionReason: null,
      });
      setPaymentReference("");
      setPaymentReceipt(null);
    } catch (error) {
      setPurchaseError(error instanceof Error ? error.message : "تعذر بدء طلب الشراء");
    } finally {
      setPurchaseSaving(false);
    }
  };

  const submitCoinPurchasePayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activePurchase || !paymentReceipt) {
      setPurchaseError("أرفق صورة إيصال الدفع.");
      return;
    }
    setPurchaseSaving(true);
    setPurchaseError("");
    try {
      const formData = new FormData();
      formData.set("paymentReference", paymentReference);
      formData.set("receipt", paymentReceipt);
      const response = await fetch(`/api/coin-purchases/${encodeURIComponent(activePurchase.id)}/payment`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "تعذر إرسال إثبات الدفع");
      }
      showSuccess("تم إرسال إثبات الدفع إلى الوكيل للمراجعة.");
      setActivePurchase(null);
      setPaymentReceipt(null);
      setPaymentReference("");
      await refreshCoinPurchases();
    } catch (error) {
      setPurchaseError(error instanceof Error ? error.message : "تعذر إرسال إثبات الدفع");
    } finally {
      setPurchaseSaving(false);
    }
  };

  const purchaseStatusLabel: Record<CoinPurchase["status"], string> = {
    awaiting_payment: "بانتظار التحويل",
    submitted: "قيد مراجعة الوكيل",
    approved: "تمت إضافة العملات",
    rejected: "مرفوض",
  };

  const openSendDialog = (gift: Gift) => {
    setSelectedGift(gift);
    setSelectedRecipient(null);
    setRecipientSearch("");
    setSendDialogOpen(true);
  };

  const handleSend = async () => {
    if (!selectedGift || !selectedRecipient || !currentUser) return;
    setSending(selectedGift.id);
    const intent = {
      giftId: selectedGift.id,
      receiverId: selectedRecipient.id,
      quantity: 1,
    };
    try {
      const requestKey = getGiftSendIdempotencyKey(intent, localStorage);
      const res = await fetch("/api/gifts/send", {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify({
          receiverId: selectedRecipient.id,
          giftId: selectedGift.id,
          quantity: 1,
        }),
      });
      const data = await res.json();
      if (data.success) {
        clearGiftSendIdempotencyKey(intent, requestKey, localStorage);
        setCoins(data.newBalance);
        showSuccess(`تم إرسال ${selectedGift.icon} ${selectedGift.name} إلى ${selectedRecipient.name || selectedRecipient.username}`);
        setSendDialogOpen(false);
        try {
          const walletRes = await fetch("/api/gifts/coins", { headers: getAuthHeaders() });
          const walletData = await walletRes.json();
          if (walletData.success) {
            setCoins(walletData.coins);
            setCashableCoins(walletData.cashableCoins);
          }
        } catch (refreshError) {
          console.error("Gift was sent but the wallet balance could not be refreshed", refreshError);
        }
        try {
          const topRes = await fetch("/api/gifts/top");
          const topData = await topRes.json();
          if (topData.success) setTopGifts(topData.topGifts);
        } catch (refreshError) {
          console.error("Gift was sent but the top gifts could not be refreshed", refreshError);
        }
      } else {
        showError(data.message || "تعذر إرسال الهدية");
      }
    } catch (error) {
      console.error("Gift sending failed", error);
      showError("حدث خطأ أثناء إرسال الهدية");
    } finally {
      setSending(null);
    }
  };

  const filteredUsers = onlineUsers.filter((user: GiftRecipient) => {
    const name = (user.name || user.username || "").toLowerCase();
    return (
      Boolean(user.id && user.id !== "0" && user.role?.toLowerCase() !== "guest") &&
      name.includes(recipientSearch.toLowerCase()) &&
      user.id !== currentUser?.id
    );
  });

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full p-8">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-24 rtl">
      <div className="bg-gradient-to-r from-amber-400 to-yellow-600 p-6 rounded-3xl text-white shadow-lg shadow-yellow-500/20">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold mb-1">متجر الهدايا</h3>
            <p className="text-white/80 text-xs">أرسل الهدايا لأصدقائك لزيادة شعبيتهم</p>
          </div>
          <div className="bg-card/20 px-4 py-2 rounded-2xl backdrop-blur-sm flex items-center gap-2">
            <Coins size={20} className="text-yellow-200" />
            <span className="font-bold">{formatCoins(coins)}</span>
          </div>
        </div>
        <p className="mt-3 text-xs text-white/85">
          رصيد قابل للسحب: {formatCoins(cashableCoins)}
        </p>
        <Button
          type="button"
          variant="secondary"
          className="mt-4 rounded-xl"
          onClick={() => setPurchaseDialogOpen(true)}
          disabled={!currentUser}
        >
          <Coins size={16} className="ml-2" />
          شراء عملات من وكيل
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {gifts.map((gift) => (
          <Card key={gift.id} className="border-none shadow-sm rounded-2xl overflow-hidden hover:scale-[1.02] transition-transform">
            <CardContent className="p-4 flex flex-col items-center text-center">
              <div className="text-5xl mb-4 transform hover:scale-110 transition-transform duration-300">
                {gift.icon}
              </div>
              <h4 className="font-bold text-foreground mb-1">{gift.name}</h4>
              <div className="flex items-center gap-1 text-amber-600 font-bold text-sm mb-4">
                <Coins size={14} />
                <span>{gift.price}</span>
              </div>
              <Button
                className="w-full rounded-xl h-9 text-xs font-bold"
                variant={gift.category === 'legendary' ? 'default' : 'secondary'}
                onClick={() => openSendDialog(gift)}
                disabled={sending === gift.id || !currentUser}
              >
                {sending === gift.id ? <Loader2 className="animate-spin" size={14} /> : "شراء وإهداء"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {topGifts.length > 0 && (
        <div className="bg-card p-4 rounded-2xl shadow-sm border border-border">
          <h4 className="font-bold text-foreground mb-4 flex items-center gap-2">
            <Trophy size={18} className="text-yellow-500" />
            أكثر الهدايا إرسالاً اليوم
          </h4>
          <div className="space-y-3">
            {topGifts.map((gift, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                  <span className="text-2xl">{gift.icon}</span>
                  <span className="font-medium text-foreground">{gift.name}</span>
                </div>
                <span className="text-muted-foreground text-xs">{gift.count.toLocaleString()} مرة</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">
              إرسال {selectedGift?.icon} {selectedGift?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {selectedGift && (
              <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-xl flex items-center justify-between">
                <span className="text-sm font-medium">التكلفة</span>
                <span className="font-bold text-amber-600 flex items-center gap-1">
                  <Coins size={14} /> {selectedGift.price}
                </span>
              </div>
            )}

            <div className="relative">
              <Search className="absolute right-3 top-2.5 text-muted-foreground" size={16} />
              <Input
                placeholder="ابحث عن مستلم..."
                className="pr-10 h-10 text-sm"
                value={recipientSearch}
                onChange={(e) => setRecipientSearch(e.target.value)}
                dir="rtl"
              />
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredUsers.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-4">لا يوجد مستخدمون</p>
              ) : (
                filteredUsers.map((user: GiftRecipient) => (
                  <button
                    key={user.id || user.socketId}
                    className={`w-full flex items-center gap-3 p-2 rounded-xl transition-colors ${
                      selectedRecipient?.id === user.id
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                    onClick={() => {
                      setSelectedRecipient(user);
                    }}
                  >
                    <Avatar className="w-11 h-11 rounded-lg">
                      <AvatarImage src={user.avatar || user.pic || "/pic.png"} />
                      <AvatarFallback className="text-[10px]">{(user.name || user.username)?.[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 text-right">
                      <p className="text-xs font-bold" style={user.nameColor && user.nameColor !== "#000000" ? { color: user.nameColor } : undefined}>{user.name || user.username}</p>
                    </div>
                    {selectedRecipient?.id === user.id && <Check size={16} className="text-primary" />}
                  </button>
                ))
              )}
            </div>

            <Button
              className="w-full h-11 rounded-xl font-bold"
              onClick={handleSend}
              disabled={!selectedRecipient || !!sending}
            >
              {sending ? <Loader2 className="animate-spin" size={16} /> : `إرسال إلى ${selectedRecipient?.name || selectedRecipient?.username || ""}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={purchaseDialogOpen}
        onOpenChange={(open) => {
          setPurchaseDialogOpen(open);
          if (!open) {
            setActivePurchase(null);
            setPurchaseError("");
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-center">شراء عملات من وكيل</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              اختر الباقة، حوّل المبلغ إلى الوكيل، ثم أرسل مرجع التحويل وصورة الإيصال. تُضاف العملات بعد تحقق الوكيل من وصول المبلغ.
            </p>
            {activePurchase ? (
              <form onSubmit={submitCoinPurchasePayment} className="space-y-4 rounded-xl border p-4">
                <div>
                  <p className="font-semibold">{activePurchase.agentName}</p>
                  <p className="text-sm">
                    {BigInt(activePurchase.coinAmount).toLocaleString()} عملة —{" "}
                    {BigInt(activePurchase.priceMinorUnits).toLocaleString()} {activePurchase.currencyCode}
                  </p>
                </div>
                <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">
                  {activePurchase.paymentInstructions}
                </p>
                <div className="space-y-2">
                  <label htmlFor="coin-purchase-reference" className="text-sm font-medium">مرجع التحويل</label>
                  <Input
                    id="coin-purchase-reference"
                    value={paymentReference}
                    onChange={(event) => setPaymentReference(event.target.value)}
                    maxLength={255}
                    required
                    dir="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="coin-purchase-receipt" className="text-sm font-medium">صورة الإيصال (حتى 5 ميغابايت)</label>
                  <Input
                    id="coin-purchase-receipt"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => setPaymentReceipt(event.target.files?.[0] || null)}
                    required
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={purchaseSaving}>
                    {purchaseSaving ? <Loader2 className="animate-spin" size={16} /> : "إرسال إثبات الدفع"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setActivePurchase(null)} disabled={purchaseSaving}>
                    رجوع للباقات
                  </Button>
                </div>
              </form>
            ) : (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">الباقات المتاحة</h3>
                  <Button type="button" size="sm" variant="outline" onClick={() => void refreshCoinPurchases()} disabled={purchaseLoading}>
                    <RefreshCw size={14} className="ml-1" />
                    تحديث
                  </Button>
                </div>
                {purchaseLoading ? (
                  <div className="flex justify-center p-4"><Loader2 className="animate-spin" /></div>
                ) : coinPackages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد باقات متاحة حاليًا.</p>
                ) : coinPackages.map((item) => (
                  <article key={item.packageId} className="space-y-2 rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">{item.agentName}</p>
                        <p className="text-sm text-muted-foreground">@{item.agentUsername}</p>
                      </div>
                      <p className="font-semibold">
                        {BigInt(item.coinAmount).toLocaleString()} عملة —{" "}
                        {BigInt(item.priceMinorUnits).toLocaleString()} {item.currencyCode}
                      </p>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{item.paymentInstructions}</p>
                    <Button type="button" size="sm" onClick={() => void beginCoinPurchase(item)} disabled={purchaseSaving}>
                      اختيار الباقة
                    </Button>
                  </article>
                ))}
                <div className="space-y-2 border-t pt-3">
                  <h3 className="font-semibold">سجل طلبات الشراء</h3>
                  {coinPurchases.length === 0 ? (
                    <p className="text-sm text-muted-foreground">لا توجد طلبات شراء.</p>
                  ) : coinPurchases.map((purchase) => (
                    <div key={purchase.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                      <span>
                        {purchase.agentName} · {BigInt(purchase.coinAmount).toLocaleString()} عملة
                      </span>
                      <span>{purchaseStatusLabel[purchase.status]}</span>
                      {purchase.rejectionReason && (
                        <p className="w-full text-destructive">سبب الرفض: {purchase.rejectionReason}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            {purchaseError && <p role="alert" className="text-sm text-destructive">{purchaseError}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GiftStore;