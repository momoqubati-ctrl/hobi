"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Check, Mic, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getAdminHeaders } from "../utils";

interface VoiceProviderAccount {
  id: string;
  name: string;
  url: string;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

type VoiceProviderSelection =
  | { provider: "webrtc"; accountId: null }
  | { provider: "livekit"; accountId: string };

type AccountForm = {
  name: string;
  url: string;
  apiKey: string;
  apiSecret: string;
};

const EMPTY_FORM: AccountForm = { name: "", url: "", apiKey: "", apiSecret: "" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSelection(value: unknown): VoiceProviderSelection | null {
  if (!isRecord(value)) return null;
  if (value.provider === "webrtc" && value.accountId === null) {
    return { provider: "webrtc", accountId: null };
  }
  if (value.provider === "livekit" && typeof value.accountId === "string") {
    return { provider: "livekit", accountId: value.accountId };
  }
  return null;
}

function parseAccount(value: unknown): VoiceProviderAccount | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.url !== "string" ||
    typeof value.hasApiKey !== "boolean" ||
    typeof value.hasApiSecret !== "boolean" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    url: value.url,
    hasApiKey: value.hasApiKey,
    hasApiSecret: value.hasApiSecret,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

async function readApiResponse(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("تعذر قراءة استجابة الخادم");
  }

  if (!isRecord(value)) throw new Error("استجابة الخادم غير صالحة");
  if (!response.ok || value.success !== true) {
    throw new Error(typeof value.message === "string" ? value.message : "تعذر تنفيذ الطلب");
  }
  return value;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "حدث خطأ غير متوقع";
}

interface VoiceProviderSectionProps {
  permissions: string[];
}

const VoiceProviderSection = ({ permissions }: VoiceProviderSectionProps) => {
  const canEdit =
    permissions.includes("micprovideredit.edit") ||
    permissions.includes("micprovideredit.all");
  const canDelete =
    permissions.includes("micprovideredit.delete") ||
    permissions.includes("micprovideredit.all");
  const [accounts, setAccounts] = useState<VoiceProviderAccount[]>([]);
  const [selection, setSelection] = useState<VoiceProviderSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"selection" | "create" | "edit">("selection");
  const [editingAccount, setEditingAccount] = useState<VoiceProviderAccount | null>(null);
  const [selectionAccountId, setSelectionAccountId] = useState("");
  const [selectAfterCreate, setSelectAfterCreate] = useState(false);
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/voice-providers", {
        headers: getAdminHeaders(),
      });
      const body = await readApiResponse(response);
      if (!Array.isArray(body.accounts)) {
        throw new Error("قائمة حسابات LiveKit غير صالحة");
      }
      const parsedAccounts = body.accounts.map(parseAccount);
      if (parsedAccounts.some((account) => account === null)) {
        throw new Error("بيانات حساب LiveKit غير مكتملة");
      }
      const parsedSelection = parseSelection(body.selection);
      if (!parsedSelection) throw new Error("اختيار مزود الصوت غير صالح");

      setAccounts(parsedAccounts.filter(
        (account): account is VoiceProviderAccount => account !== null,
      ));
      setSelection(parsedSelection);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const openSelectionDialog = () => {
    if (!canEdit) return;
    setError("");
    setNotice("");
    setSelectionAccountId(
      selection?.provider === "livekit"
        ? selection.accountId
        : accounts[0]?.id ?? "",
    );
    setSelectAfterCreate(true);
    setDialogMode(accounts.length === 0 ? "create" : "selection");
    setEditingAccount(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openCreateDialog = (activateAfterSaving = false) => {
    if (!canEdit) return;
    setError("");
    setNotice("");
    setSelectAfterCreate(activateAfterSaving);
    setEditingAccount(null);
    setForm(EMPTY_FORM);
    setDialogMode("create");
    setDialogOpen(true);
  };

  const openEditDialog = (account: VoiceProviderAccount) => {
    if (!canEdit) return;
    setError("");
    setNotice("");
    setSelectAfterCreate(false);
    setEditingAccount(account);
    setForm({ name: account.name, url: account.url, apiKey: "", apiSecret: "" });
    setDialogMode("edit");
    setDialogOpen(true);
  };

  const saveSelection = async (nextSelection: VoiceProviderSelection) => {
    const response = await fetch("/api/admin/voice-provider-selection", {
      method: "PUT",
      headers: getAdminHeaders(),
      body: JSON.stringify(
        nextSelection.provider === "webrtc"
          ? { provider: "webrtc" }
          : { provider: "livekit", accountId: nextSelection.accountId },
      ),
    });
    const body = await readApiResponse(response);
    const savedSelection = parseSelection(body.selection);
    if (!savedSelection) throw new Error("اختيار مزود الصوت المحفوظ غير صالح");
    setSelection(savedSelection);
  };

  const handleSelectWebRtc = async () => {
    if (!canEdit) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await saveSelection({ provider: "webrtc", accountId: null });
      setNotice("تم حفظ WebRTC كمزود الصوت المطلوب.");
      toast.success("تم حفظ WebRTC كمزود الصوت المطلوب.");
    } catch (selectionError) {
      const message = getErrorMessage(selectionError);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError("");
    setNotice("");

    const accountId = editingAccount?.id ?? globalThis.crypto.randomUUID();
    const input: Record<string, string> = { name: form.name, url: form.url };
    if (form.apiKey.trim()) input.apiKey = form.apiKey;
    if (form.apiSecret.trim()) input.apiSecret = form.apiSecret;

    try {
      const response = await fetch(`/api/admin/voice-providers/${accountId}`, {
        method: "PUT",
        headers: getAdminHeaders(),
        body: JSON.stringify(input),
      });
      await readApiResponse(response);
      setForm(EMPTY_FORM);

      if (!editingAccount && selectAfterCreate) {
        try {
          await saveSelection({ provider: "livekit", accountId });
        } catch (selectionError) {
          setDialogMode("selection");
          setSelectionAccountId(accountId);
          await loadAccounts();
          setError(`تم حفظ الحساب، لكن تعذر تحديده كمزود مطلوب: ${getErrorMessage(selectionError)}`);
          return;
        }
      }

      setDialogOpen(false);
      const successMessage =
        !editingAccount && selectAfterCreate
          ? "تم حفظ حساب LiveKit وتحديده كمزود الصوت المطلوب."
          : editingAccount
            ? "تم تحديث حساب LiveKit دون كشف بيانات الاعتماد المحفوظة."
            : "تم حفظ حساب LiveKit.";
      setNotice(successMessage);
      toast.success(successMessage);
      await loadAccounts();
    } catch (saveError) {
      const message = getErrorMessage(saveError);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async (account: VoiceProviderAccount) => {
    if (!canDelete || !window.confirm(`هل تريد حذف حساب «${account.name}»؟`)) return;
    setDeletingId(account.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/voice-providers/${account.id}`, {
        method: "DELETE",
        headers: getAdminHeaders(),
      });
      await readApiResponse(response);
      const successMessage = "تم حذف حساب LiveKit.";
      setNotice(successMessage);
      toast.success(successMessage);
      await loadAccounts();
    } catch (deleteError) {
      const message = getErrorMessage(deleteError);
      setError(message);
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  };

  const selectedAccount = selection?.provider === "livekit"
    ? accounts.find((account) => account.id === selection.accountId)
    : undefined;

  return (
    <section className="space-y-5 p-4 rtl" aria-labelledby="voice-provider-title">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="voice-provider-title" className="text-xl font-bold text-foreground">
            مزود الصوت
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            اختر WebRTC أو أدر حسابات LiveKit المحفوظة بأمان.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => openCreateDialog()} disabled={!canEdit || saving}>
          <Plus className="ml-2 h-4 w-4" />
          إضافة حساب LiveKit
        </Button>
      </header>

      <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        الاختيار هنا هو المزود المطلوب فقط؛ حالة الاتصال الفعلية يحددها مكوّن التنسيق.
      </p>

      {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">{notice}</p>}

      <div className="grid gap-3 md:grid-cols-2">
        <div className={`rounded-xl border p-4 ${selection?.provider === "webrtc" ? "border-primary bg-primary/5" : "border-border bg-background"}`}>
          <div className="flex items-start gap-3">
            <Mic className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="flex-1">
              <h3 className="font-semibold">WebRTC</h3>
              <p className="mt-1 text-sm text-muted-foreground">المزود الافتراضي المتاح دون إعداد حساب LiveKit.</p>
              {selection?.provider === "webrtc" && (
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  <Check className="h-4 w-4" aria-hidden="true" /> الاختيار المطلوب حالياً
                </span>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleSelectWebRtc}
              disabled={!canEdit || saving || selection?.provider === "webrtc"}
            >
              استخدام WebRTC
            </Button>
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${selection?.provider === "livekit" ? "border-primary bg-primary/5" : "border-border bg-background"}`}>
          <div className="flex items-start gap-3">
            <Server className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="flex-1">
              <h3 className="font-semibold">LiveKit</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedAccount
                  ? `الحساب المطلوب: ${selectedAccount.name}`
                  : "اختر حساباً محفوظاً أو أضف إعداد LiveKit جديداً."}
              </p>
              {selection?.provider === "livekit" && (
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  <Check className="h-4 w-4" aria-hidden="true" /> الاختيار المطلوب حالياً
                </span>
              )}
            </div>
            <Button type="button" onClick={openSelectionDialog} disabled={!canEdit || saving}>
              إعداد LiveKit
            </Button>
          </div>
        </div>
      </div>

      <section aria-labelledby="saved-livekit-title" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id="saved-livekit-title" className="font-semibold">حسابات LiveKit المحفوظة</h3>
          <span className="text-xs text-muted-foreground">{accounts.length} حساب</span>
        </div>

        {loading ? (
          <div role="status" aria-busy="true" className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
            جارٍ تحميل إعدادات مزود الصوت...
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            لا توجد حسابات LiveKit محفوظة. أضف حساباً لإتاحته للاختيار.
          </div>
        ) : (
          <ul className="space-y-3">
            {accounts.map((account) => {
              const isSelected = selection?.provider === "livekit" && selection.accountId === account.id;
              return (
                <li key={account.id} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold">{account.name}</h4>
                      {isSelected && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">المحدد</span>}
                    </div>
                    <p className="mt-1 break-all text-sm text-muted-foreground" dir="ltr">{account.url}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      بيانات الاعتماد: {account.hasApiKey ? "المفتاح محفوظ" : "لا يوجد مفتاح"}،{" "}
                      {account.hasApiSecret ? "السر محفوظ" : "لا يوجد سر"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => openEditDialog(account)} disabled={!canEdit}>
                      <Pencil className="ml-1 h-4 w-4" /> تعديل
                    </Button>
                    {canDelete && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDeleteAccount(account)}
                        disabled={deletingId === account.id}
                      >
                        <Trash2 className="ml-1 h-4 w-4" />
                        {deletingId === account.id ? "جارٍ الحذف..." : "حذف"}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto rtl">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "selection"
                ? "اختيار حساب LiveKit"
                : dialogMode === "edit"
                  ? "تعديل حساب LiveKit"
                  : "إضافة حساب LiveKit"}
            </DialogTitle>
            <DialogDescription>
              لا تُعرض مفاتيح API المحفوظة؛ عند التعديل اترك حقول الأسرار فارغة للإبقاء على القيم الحالية.
            </DialogDescription>
          </DialogHeader>

          {dialogMode === "selection" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="voice-provider-account">حساب LiveKit</Label>
                <select
                  id="voice-provider-account"
                  value={selectionAccountId}
                  onChange={(event) => setSelectionAccountId(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  disabled={saving}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => openCreateDialog(true)} disabled={!canEdit || saving}>
                  <Plus className="ml-2 h-4 w-4" /> إضافة حساب جديد
                </Button>
                <Button
                  type="button"
                  onClick={async () => {
                    if (!selectionAccountId) return;
                    setSaving(true);
                    setError("");
                    try {
                      await saveSelection({ provider: "livekit", accountId: selectionAccountId });
                      setDialogOpen(false);
                      setNotice("تم حفظ حساب LiveKit كمزود الصوت المطلوب.");
                    } catch (selectionError) {
                      setError(getErrorMessage(selectionError));
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={!canEdit || saving || !selectionAccountId}
                >
                  {saving ? "جارٍ الحفظ..." : "حفظ الاختيار"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleSaveAccount} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="voice-provider-name">اسم الحساب</Label>
                <Input
                  id="voice-provider-name"
                  value={form.name}
                  maxLength={120}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  required
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="voice-provider-url">رابط LiveKit الآمن</Label>
                <Input
                  id="voice-provider-url"
                  value={form.url}
                  placeholder="wss://livekit.example.com"
                  dir="ltr"
                  maxLength={2048}
                  onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
                  required
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">استخدم رابط wss:// دون مسار أو بيانات دخول.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="voice-provider-api-key">مفتاح API</Label>
                <Input
                  id="voice-provider-api-key"
                  type="password"
                  autoComplete="new-password"
                  value={form.apiKey}
                  onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
                  required={dialogMode === "create"}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="voice-provider-api-secret">سر API</Label>
                <Input
                  id="voice-provider-api-secret"
                  type="password"
                  autoComplete="new-password"
                  value={form.apiSecret}
                  onChange={(event) => setForm((current) => ({ ...current, apiSecret: event.target.value }))}
                  required={dialogMode === "create"}
                  disabled={saving}
                />
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                  إلغاء
                </Button>
                <Button type="submit" disabled={!canEdit || saving}>
                  {saving ? "جارٍ الحفظ..." : dialogMode === "edit" ? "حفظ التعديلات" : selectAfterCreate ? "حفظ الحساب واختياره" : "حفظ الحساب"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default VoiceProviderSection;
