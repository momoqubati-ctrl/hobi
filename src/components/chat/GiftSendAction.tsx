"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Coins, Gift, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { showError, showSuccess } from "@/utils/toast";
import {
  clearGiftSendIdempotencyKey,
  getGiftSendIdempotencyKey,
} from "@/lib/gift-send-idempotency";
import { canSendContextualGift } from "@/lib/gift-send-eligibility";

type GiftRecipient = {
  id: string;
  name: string;
  role?: string;
};

type GiftCatalogItem = {
  id: string;
  name: string;
  icon: string;
  price: number;
  category: string;
};

type GiftSendActionProps = {
  recipient: GiftRecipient;
  iconOnly?: boolean;
  className?: string;
};

const readStoredUser = () => {
  try {
    const raw = localStorage.getItem("user");
    const user: unknown = raw ? JSON.parse(raw) : null;
    if (!user || typeof user !== "object") return { id: "", role: "guest" };
    const record = user as Record<string, unknown>;
    return {
      id: typeof record.id === "string" || typeof record.id === "number" ? String(record.id) : "",
      role: typeof record.role === "string" ? record.role : "guest",
    };
  } catch {
    return { id: "", role: "guest" };
  }
};

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("authToken") || localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const GiftSendAction = ({ recipient, iconOnly = false, className }: GiftSendActionProps) => {
  const [sender, setSender] = useState({ id: "", role: "guest" });
  const [open, setOpen] = useState(false);
  const [gifts, setGifts] = useState<GiftCatalogItem[]>([]);
  const [selectedGiftId, setSelectedGiftId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    setSender(readStoredUser());
  }, []);

  const eligible = canSendContextualGift(sender, recipient);
  const selectedGift = gifts.find((gift) => gift.id === selectedGiftId);
  const parsedQuantity = Number(quantity);
  const totalCost = useMemo(() => {
    if (!selectedGift || !Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1) return null;
    return BigInt(selectedGift.price) * BigInt(parsedQuantity);
  }, [selectedGift, parsedQuantity]);
  const hasEnoughCoins = balance !== null && totalCost !== null && totalCost <= BigInt(balance);

  useEffect(() => {
    if (!open || gifts.length > 0) return;

    let active = true;
    const loadDialogData = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const headers = getAuthHeaders();
        if (!headers.Authorization) {
          throw new Error("يرجى تسجيل الدخول لإرسال الهدايا");
        }

        const [giftsResponse, walletResponse] = await Promise.all([
          fetch("/api/gifts"),
          fetch("/api/gifts/coins", { headers }),
        ]);
        const giftsData = await giftsResponse.json();
        const walletData = await walletResponse.json();
        if (!giftsResponse.ok || !giftsData?.success || !Array.isArray(giftsData.gifts)) {
          throw new Error(giftsData?.message || "تعذر تحميل قائمة الهدايا");
        }
        if (
          !walletResponse.ok ||
          !walletData?.success ||
          typeof walletData.coins !== "string" ||
          !/^\d+$/.test(walletData.coins)
        ) {
          throw new Error(walletData?.message || "تعذر تحميل رصيد المحفظة");
        }
        const availableGifts = giftsData.gifts.filter((gift: unknown): gift is GiftCatalogItem => {
          if (!gift || typeof gift !== "object") return false;
          const item = gift as Record<string, unknown>;
          return (
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            typeof item.icon === "string" &&
            typeof item.category === "string" &&
            typeof item.price === "number" &&
            Number.isSafeInteger(item.price) &&
            item.price > 0
          );
        });
        if (active) {
          setGifts(availableGifts);
          setSelectedGiftId(availableGifts[0]?.id || "");
          setBalance(walletData.coins);
        }
      } catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : "تعذر تحميل بيانات الإهداء";
          setLoadError(message);
          showError(message);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadDialogData();
    return () => {
      active = false;
    };
  }, [open, gifts.length, loadAttempt]);

  const sendGift = async () => {
    if (!selectedGift || !totalCost || !hasEnoughCoins || sending) return;
    const requestIntent = {
      giftId: selectedGift.id,
      receiverId: recipient.id,
      quantity: parsedQuantity,
    };
    setSending(true);

    try {
      const requestKey = getGiftSendIdempotencyKey(requestIntent, localStorage);
      const response = await fetch("/api/gifts/send", {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify(requestIntent),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        showError(data?.message || "تعذر إرسال الهدية");
        return;
      }
      if (typeof data.newBalance !== "string" || !/^\d+$/.test(data.newBalance)) {
        showError("تم استلام رد غير مكتمل؛ أعد المحاولة للطلب نفسه للتحقق دون تكرار الخصم.");
        return;
      }

      clearGiftSendIdempotencyKey(requestIntent, requestKey, localStorage);
      setBalance(data.newBalance);
      showSuccess(`تم إرسال ${selectedGift.icon} ${selectedGift.name} إلى ${recipient.name}`);
      setOpen(false);
    } catch (error) {
      console.error("Contextual gift send failed", error);
      showError("تعذر تأكيد نتيجة إرسال الهدية. أعد المحاولة للطلب نفسه لتجنب تكرار الخصم.");
    } finally {
      setSending(false);
    }
  };

  if (!eligible) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={iconOnly ? "icon" : "sm"}
          className={className}
          aria-label={`إهداء ${recipient.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <Gift className="h-4 w-4 text-pink-600" />
          {!iconOnly && <span>إهداء</span>}
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>إهداء إلى {recipient.name}</DialogTitle>
          <DialogDescription>
            اختر هدية وكمية. لن تُخصم العملات إلا بعد تأكيد الإرسال.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            جارٍ تحميل الهدايا والرصيد…
          </div>
        ) : loadError ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">{loadError}</p>
            <Button type="button" variant="outline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
              إعادة المحاولة
            </Button>
          </div>
        ) : gifts.length === 0 ? (
          <p role="status" className="py-4 text-sm text-muted-foreground">
            لا توجد هدايا متاحة للإرسال حاليًا.
          </p>
        ) : (
          <div className="space-y-4">
            <label className="block space-y-2 text-sm font-medium">
              <span>الهدية</span>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedGiftId}
                onChange={(event) => setSelectedGiftId(event.target.value)}
              >
                {gifts.map((gift) => (
                  <option key={gift.id} value={gift.id}>
                    {gift.icon} {gift.name} — {gift.price} عملة
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-2 text-sm font-medium">
              <span>الكمية</span>
              <Input
                type="number"
                min={1}
                max={1000}
                step={1}
                inputMode="numeric"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>

            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="flex items-center justify-between">
                <span>إجمالي التكلفة</span>
                <strong className="inline-flex items-center gap-1">
                  <Coins className="h-4 w-4" />
                  {totalCost?.toLocaleString() ?? "—"} عملة
                </strong>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                رصيدك: {balance === null ? "—" : BigInt(balance).toLocaleString()} عملة
              </p>
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={
                !selectedGift ||
                !Number.isSafeInteger(parsedQuantity) ||
                parsedQuantity < 1 ||
                parsedQuantity > 1000 ||
                !hasEnoughCoins ||
                sending
              }
              onClick={sendGift}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
              تأكيد إرسال الهدية
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default GiftSendAction;
