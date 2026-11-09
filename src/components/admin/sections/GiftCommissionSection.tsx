"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canManageAdminSection } from "../powers/permissionDefs";
import { getAdminHeaders } from "../utils";

type GiftCommissionSettings = {
  configured: boolean;
  commissionRatePercent: number | null;
  roundingMode: "floor";
  updatedAt: string | null;
};

type GiftCommissionResponse = {
  success: boolean;
  message?: string;
  settings?: GiftCommissionSettings;
};

const GiftCommissionSection = ({ permissions }: { permissions: string[] }) => {
  const [settings, setSettings] = useState<GiftCommissionSettings | null>(null);
  const [ratePercent, setRatePercent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canEdit = canManageAdminSection(permissions, "giftcommission", "edit");

  useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      try {
        const response = await fetch("/api/admin/gift-commission", {
          headers: getAdminHeaders(),
        });
        const data = (await response.json()) as GiftCommissionResponse;
        if (!response.ok || !data.success || !data.settings) {
          throw new Error(data.message || "تعذر جلب إعدادات عمولة الهدايا");
        }
        if (active) {
          setSettings(data.settings);
          setRatePercent(data.settings.commissionRatePercent?.toString() ?? "");
        }
      } catch {
        if (active) setError("تعذر جلب إعدادات عمولة الهدايا");
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadSettings();
    return () => {
      active = false;
    };
  }, []);

  const saveSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/admin/gift-commission", {
        method: "PUT",
        headers: { ...getAdminHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ commissionRatePercent: Number(ratePercent) }),
      });
      const data = (await response.json()) as GiftCommissionResponse;
      if (!response.ok || !data.success || !data.settings) {
        throw new Error(data.message || "تعذر حفظ إعدادات عمولة الهدايا");
      }
      setSettings(data.settings);
      setRatePercent(data.settings.commissionRatePercent?.toString() ?? "");
      setNotice("تم حفظ نسبة العمولة.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ إعدادات عمولة الهدايا");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p role="status" className="py-12 text-center text-sm text-muted-foreground">جارٍ تحميل الإعدادات…</p>;
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>عمولة الهدايا</CardTitle>
        <p className="text-sm text-muted-foreground">
          تُخصم العمولة من سعر الهدية، ويُقرّب الناتج إلى أسفل لأقرب عملة كاملة.
        </p>
      </CardHeader>
      <CardContent>
        {settings?.configured ? (
          <p className="mb-4 text-sm">
            النسبة الحالية: <strong>{settings.commissionRatePercent}%</strong>
          </p>
        ) : (
          <p role="status" className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            لم تُضبط نسبة العمولة بعد؛ ستبقى عمليات إرسال الهدايا عبر المحفظة الجديدة متوقفة حتى حفظ قيمة صالحة.
          </p>
        )}

        {canEdit ? (
          <form onSubmit={saveSettings} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="gift-commission-rate" className="text-sm font-medium">
                نسبة العمولة (%)
              </label>
              <Input
                id="gift-commission-rate"
                type="number"
                min="0"
                max="100"
                step="0.01"
                inputMode="decimal"
                value={ratePercent}
                onChange={(event) => setRatePercent(event.target.value)}
                aria-describedby="gift-commission-help"
                required
              />
              <p id="gift-commission-help" className="text-xs text-muted-foreground">
                أدخل قيمة من 0 إلى 100، بدقتين عشريتين كحد أقصى. لا يمكن أن تتجاوز العمولة سعر الهدية.
              </p>
            </div>
            <Button type="submit" disabled={saving || !ratePercent.trim()}>
              {saving ? "جارٍ الحفظ…" : "حفظ النسبة"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">لا تملك صلاحية تعديل هذه الإعدادات.</p>
        )}

        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="mt-4 text-sm text-emerald-600">{notice}</p>}
      </CardContent>
    </Card>
  );
};

export default GiftCommissionSection;
