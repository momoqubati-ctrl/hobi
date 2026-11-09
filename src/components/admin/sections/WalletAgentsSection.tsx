"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canManageAdminSection } from "../powers/permissionDefs";
import { getAdminHeaders } from "../utils";

type WalletAgent = {
  id: string;
  username: string;
  name: string;
  phone: string;
  status: "active" | "disabled";
  forcePasswordChange: boolean;
  createdAt: string;
};

type WalletAgentsResponse = {
  success: boolean;
  agents?: WalletAgent[];
  agent?: WalletAgent & { temporaryPassword: string };
  path?: string;
  message?: string;
};

const WalletAgentsSection = ({ permissions }: { permissions: string[] }) => {
  const [agents, setAgents] = useState<WalletAgent[]>([]);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [portalPath, setPortalPath] = useState("");
  const [portalError, setPortalError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canEdit = canManageAdminSection(permissions, "agentwallets", "edit");

  const loadAgents = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/wallet-agents", { headers: getAdminHeaders() });
      const data = (await response.json()) as WalletAgentsResponse;
      if (!response.ok || !data.success || !data.agents) {
        throw new Error(data.message || "تعذر جلب حسابات الوكلاء");
      }
      setAgents(data.agents);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر جلب حسابات الوكلاء");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPortalPath = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/wallet-agents/portal-link", {
        headers: getAdminHeaders(),
      });
      const data = (await response.json()) as WalletAgentsResponse;
      if (!response.ok || !data.success || !data.path) {
        throw new Error(data.message || "تعذر جلب رابط دخول الوكلاء");
      }
      setPortalPath(data.path);
      setPortalError("");
    } catch (loadError) {
      setPortalPath("");
      setPortalError(loadError instanceof Error ? loadError.message : "تعذر جلب رابط دخول الوكلاء");
    }
  }, []);

  useEffect(() => {
    void loadAgents();
    void loadPortalPath();
  }, [loadAgents, loadPortalPath]);

  const createAgent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    setTemporaryPassword("");
    try {
      const response = await fetch("/api/admin/wallet-agents", {
        method: "POST",
        headers: { ...getAdminHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ username, name, phone }),
      });
      const data = (await response.json()) as WalletAgentsResponse;
      if (!response.ok || !data.success || !data.agent) {
        throw new Error(data.message || "تعذر إنشاء حساب الوكيل");
      }
      setTemporaryPassword(data.agent.temporaryPassword);
      setNotice("تم إنشاء الحساب. أرسل رابط الدخول وكلمة المرور المؤقتة إلى الوكيل عبر قناة خاصة وآمنة.");
      setUsername("");
      setName("");
      setPhone("");
      await loadAgents();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "تعذر إنشاء حساب الوكيل");
    } finally {
      setSaving(false);
    }
  };

  const copyTemporaryPassword = async () => {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setNotice("تم نسخ كلمة المرور المؤقتة.");
    } catch (copyError) {
      console.error("Could not copy the temporary agent password", copyError);
      setError("تعذر نسخ كلمة المرور؛ انسخها يدويًا قبل مغادرة الصفحة.");
    }
  };

  const copyPortalLink = async () => {
    if (!portalPath) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${portalPath}`);
      setNotice("تم نسخ رابط دخول الوكلاء السري.");
    } catch (copyError) {
      console.error("Could not copy the wallet agent portal link", copyError);
      setError("تعذر نسخ الرابط؛ انسخه يدويًا.");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>رابط دخول الوكلاء السري</CardTitle>
            <p className="text-sm text-muted-foreground">
              شارك الرابط مع الوكلاء فقط عبر قناة خاصة. يظل اسم المستخدم وكلمة المرور مطلوبين للدخول.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {portalPath ? (
              <>
                <code className="block break-all rounded-md bg-muted p-3 text-center text-sm" dir="ltr">
                  {window.location.origin}{portalPath}
                </code>
                <Button type="button" variant="outline" onClick={copyPortalLink}>نسخ رابط الدخول</Button>
              </>
            ) : (
              <p role="status" className="text-sm text-amber-700">
                {portalError || "رابط الدخول غير مهيأ."}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>حسابات وكلاء الشحن</CardTitle>
          <p className="text-sm text-muted-foreground">
            كلمة المرور المؤقتة لا تُخزن كنص مكشوف ولا يمكن عرضها مرة أخرى؛ يغيّرها الوكيل عند أول دخول.
          </p>
        </CardHeader>
        {canEdit && (
          <CardContent>
            <form onSubmit={createAgent} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="wallet-agent-name" className="text-sm font-medium">اسم الوكيل</label>
                <Input
                  id="wallet-agent-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="wallet-agent-username" className="text-sm font-medium">اسم الدخول</label>
                <Input
                  id="wallet-agent-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  minLength={3}
                  maxLength={64}
                  pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,63}"
                  autoComplete="off"
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="wallet-agent-phone" className="text-sm font-medium">
                  رقم الهاتف مع مفتاح الدولة <span className="text-muted-foreground">(اختياري)</span>
                </label>
                <Input
                  id="wallet-agent-phone"
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+967 777 123 456"
                  maxLength={32}
                  pattern="(\+[1-9][0-9 ().-]{6,20}[0-9])?"
                  title="أدخل الرقم بالصيغة الدولية، مثل +967 777 123 456"
                  autoComplete="tel"
                  dir="ltr"
                />
                <p className="text-xs text-muted-foreground">
                  أدخل الرقم بصيغة دولية تبدأ بـ + متبوعًا بمفتاح الدولة.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "جارٍ إنشاء الحساب…" : "إنشاء حساب وكيل"}
                </Button>
              </div>
            </form>
          </CardContent>
        )}
      </Card>

      {temporaryPassword && (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="text-base">كلمة المرور المؤقتة — تُعرض مرة واحدة</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <code className="block select-all rounded-md bg-muted p-3 text-center text-base" dir="ltr">
              {temporaryPassword}
            </code>
            <Button type="button" variant="outline" onClick={copyTemporaryPassword}>نسخ كلمة المرور</Button>
            <Button type="button" variant="ghost" onClick={() => setTemporaryPassword("")}>إخفاء</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>الوكلاء ({agents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p role="status" className="text-sm text-muted-foreground">جارٍ تحميل الحسابات…</p>
          ) : agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد حسابات وكلاء.</p>
          ) : (
            <ul className="divide-y divide-border">
              {agents.map((agent) => (
                <li key={agent.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-medium">{agent.name}</p>
                    <p className="text-xs text-muted-foreground" dir="ltr">@{agent.username}</p>
                    {agent.phone && (
                      <p className="text-xs text-muted-foreground" dir="ltr">{agent.phone}</p>
                    )}
                  </div>
                  <div className="text-left text-xs">
                    <p>{agent.status === "active" ? "نشط" : "معطّل"}</p>
                    {agent.forcePasswordChange && (
                      <p className="text-amber-700">بانتظار تغيير كلمة المرور</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    </div>
  );
};

export default WalletAgentsSection;
