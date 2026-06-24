"use client";

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Loader2, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { showSuccess } from "@/utils/toast";
import { refreshSocketAuth, getSocket } from "@/lib/socket";

type AuthMode = "guest" | "member" | "register";
type DatabaseStatus = "checking" | "connected" | "disconnected";

const authEndpointByMode: Record<AuthMode, string> = {
  guest: "/api/auth/guest",
  member: "/api/auth/login",
  register: "/api/auth/register",
};

const Index = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AuthMode>("guest");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus>("checking");

  useEffect(() => {
    let isMounted = true;

    const checkHealth = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const data = await response.json();
        if (isMounted) {
          setDatabaseStatus(data?.database?.connected ? "connected" : "disconnected");
        }
      } catch {
        if (isMounted) {
          setDatabaseStatus("disconnected");
        }
      }
    };

    checkHealth();
    const timer = window.setInterval(checkHealth, 15000);

    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const handleLogin = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(authEndpointByMode[activeTab], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("تعذر الاتصال بخدمة الحسابات. أعد تشغيل السيرفر ثم حاول مرة أخرى.");
      }

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "تعذر تسجيل الدخول");
      }

      const normalizedUser = {
        ...data.user,
        profileMsg: typeof data.user?.profileMsg === "string" && data.user.profileMsg.trim()
          ? data.user.profileMsg
          : (typeof data.user?.statusMsg === "string" && data.user.statusMsg.trim() ? data.user.statusMsg : ""),
        statusMsg: typeof data.user?.statusMsg === "string" && data.user.statusMsg.trim()
          ? data.user.statusMsg
          : (typeof data.user?.profileMsg === "string" && data.user.profileMsg.trim() ? data.user.profileMsg : ""),
      };
      localStorage.setItem("authToken", data.token);
      localStorage.setItem("user", JSON.stringify(normalizedUser));
      // Ensure socket handshake uses latest auth data
      try {
        refreshSocketAuth();
        // Trigger reconnect so server receives updated handshake immediately
        const s = getSocket();
        if (s && s.connected) {
          s.disconnect();
          // reconnect will use refreshed auth
          getSocket();
        }
      } catch {}
      if (activeTab === "register") {
        showSuccess("تم إنشاء الحساب بنجاح");
      }
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تسجيل الدخول");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 rtl">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/20">
              <span className="text-lg font-black text-white">د</span>
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-800">دردشة دياد</h1>
              <p className="text-[10px] font-bold text-slate-500">مجتمع عربي مباشر وسريع</p>
            </div>
          </div>
          <div
            className={`flex items-center gap-2 rounded-full border px-4 py-1.5 ${
              databaseStatus === "connected"
                ? "border-green-100 bg-green-50 text-green-600"
                : databaseStatus === "checking"
                  ? "border-amber-100 bg-amber-50 text-amber-600"
                  : "border-red-100 bg-red-50 text-red-600"
            }`}
          >
            <div
              className={`h-2 w-2 rounded-full ${
                databaseStatus === "connected"
                  ? "bg-green-500"
                  : databaseStatus === "checking"
                    ? "bg-amber-500"
                    : "bg-red-500"
              }`}
            />
            <span className="text-xs font-bold">
              {databaseStatus === "connected"
                ? "قاعدة البيانات متصلة"
                : databaseStatus === "checking"
                  ? "فحص قاعدة البيانات"
                  : "قاعدة البيانات غير متصلة"}
            </span>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] p-4 [background-size:20px_20px]">
        <Card className="w-full max-w-md overflow-hidden rounded-3xl border-slate-200 bg-white shadow-2xl">
          <div className="h-2 w-full bg-primary" />
          <CardHeader className="flex flex-col items-center pb-4 pt-8 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50">
              <Users size={32} className="text-primary" />
            </div>
            <CardTitle className="text-2xl font-black text-slate-800">أهلاً بك في دياد</CardTitle>
            <p className="text-xs font-medium text-slate-500">ادخل كزائر أو أنشئ عضوية وابدأ الدردشة فوراً</p>
          </CardHeader>

          <CardContent className="px-8">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AuthMode)} className="w-full">
              <TabsList className="mb-6 grid h-11 w-full grid-cols-3 rounded-xl bg-slate-100 p-1">
                <TabsTrigger value="guest" className="rounded-lg text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm">
                  زائر
                </TabsTrigger>
                <TabsTrigger value="member" className="rounded-lg text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm">
                  عضو
                </TabsTrigger>
                <TabsTrigger value="register" className="rounded-lg text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm">
                  تسجيل
                </TabsTrigger>
              </TabsList>

              <div className="space-y-4">
                <Input
                  placeholder={activeTab === "guest" ? "اسم الزائر" : "اسم المستخدم"}
                  className="h-12 rounded-xl border-slate-200 bg-slate-50 text-right focus:ring-primary"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  dir="rtl"
                />

                {activeTab !== "guest" && (
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="كلمة المرور"
                      className="h-12 rounded-xl border-slate-200 bg-slate-50 pl-11 text-right focus:ring-primary"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      dir="rtl"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute left-3 top-3 text-slate-400 hover:text-slate-600"
                      aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                )}

                {error && (
                  <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-center text-xs font-bold text-red-600">
                    {error}
                  </div>
                )}

                <Button onClick={handleLogin} disabled={loading} className="h-12 w-full rounded-xl text-base font-bold shadow-lg shadow-primary/20">
                  {loading ? <Loader2 className="animate-spin" /> : activeTab === "register" ? "إنشاء الحساب" : "دخول الآن"}
                </Button>
              </div>
            </Tabs>
          </CardContent>

          <CardFooter className="flex flex-col items-center gap-4 pb-8 pt-4">
            <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400">
              <ShieldCheck size={14} />
              <span>جلسة موقعة من السيرفر ورسائل لحظية بدون تخزين دائم</span>
            </div>
          </CardFooter>
        </Card>
      </main>
    </div>
  );
};

export default Index;
