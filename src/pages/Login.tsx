"use client";

import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Lock, Eye, EyeOff, Loader2, Sparkles, UserPlus, LogIn } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { reconnectSocket } from "@/lib/socket";
import { terminateUserSession } from "@/lib/authSession";

type AuthTab = "login" | "register" | "guest";

const Login = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { login, register, loginAsGuest, isLoading, error: authError } = useAuthContext();

  const initialTab = (searchParams.get("tab") as AuthTab) || "login";
  const [tab, setTab] = useState<AuthTab>(initialTab === "register" || initialTab === "guest" ? initialTab : "login");
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState("");

  // إنهاء الجلسة فور فتح نافذة تسجيل الدخول بأي طريقة
  useEffect(() => {
    terminateUserSession(true);
    if (searchParams.get("session_replaced")) {
      setLocalError(searchParams.get("msg") || "تم تسجيل خروجك لأن حسابك فُتح في صفحة أو جهاز آخر.");
    }
  }, [searchParams]);

  useEffect(() => {
    const tabParam = searchParams.get("tab") as AuthTab;
    if (tabParam && (tabParam === "login" || tabParam === "register" || tabParam === "guest")) {
      setTab(tabParam);
    }
  }, [searchParams]);

  const handleTabChange = (val: string) => {
    const newTab = val as AuthTab;
    setTab(newTab);
    setLocalError("");
    setSearchParams({ tab: newTab });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");

    try {
      let success = false;
      if (tab === "guest") {
        const guestName = username.trim() || displayName.trim();
        if (!guestName) {
          setLocalError("يرجى إدخال اسم الزائر");
          return;
        }
        success = await loginAsGuest(guestName);
      } else if (tab === "register") {
        if (!username.trim() || username.trim().length < 3) {
          setLocalError("اسم المستخدم يجب أن يكون 3 أحرف على الأقل");
          return;
        }
        if (!password || password.length < 6) {
          setLocalError("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
          return;
        }
        success = await register(username.trim(), password, displayName.trim() || undefined);
      } else {
        if (!username.trim() || !password) {
          setLocalError("يرجى إدخال اسم المستخدم وكلمة المرور");
          return;
        }
        success = await login(username.trim(), password);
      }

      if (success) {
        try {
          reconnectSocket();
        } catch (sockErr) {
          console.error("Socket reconnect error:", sockErr);
        }
        navigate("/dashboard");
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
    }
  };

  const displayError = localError || authError;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary via-indigo-900 to-slate-950 p-4 rtl">
      <Card className="w-full max-w-md bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl border border-primary/20 overflow-hidden">
        <div className="h-2 w-full bg-gradient-to-r from-primary to-indigo-600" />
        <CardHeader className="flex flex-col items-center space-y-2 pt-8">
          <div className="w-16 h-16 bg-gradient-to-br from-primary to-indigo-700 rounded-2xl flex items-center justify-center shadow-lg shadow-primary/30">
            <span className="text-white text-3xl font-black">د</span>
          </div>
          <CardTitle className="text-2xl font-black text-slate-800">دردشة دياد العربية</CardTitle>
          <p className="text-xs text-slate-500 font-medium">مجتمع عربي تفاعلي مباشر وآمن</p>
        </CardHeader>
        
        <CardContent className="px-8 pb-8 pt-2">
          <Tabs value={tab} onValueChange={handleTabChange} className="w-full mb-6">
            <TabsList className="grid grid-cols-3 h-11 w-full rounded-xl bg-slate-100 p-1">
              <TabsTrigger value="login" className="rounded-lg text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm">
                <LogIn size={14} className="ml-1.5" />
                دخول
              </TabsTrigger>
              <TabsTrigger value="register" className="rounded-lg text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm">
                <UserPlus size={14} className="ml-1.5" />
                تسجيل
              </TabsTrigger>
              <TabsTrigger value="guest" className="rounded-lg text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm">
                <Sparkles size={14} className="ml-1.5" />
                زائر
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === "register" && (
              <div className="relative">
                <User className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <Input
                  type="text"
                  placeholder="الاسم المستعار (اختياري)"
                  className="pl-4 pr-10 h-12 rounded-xl border-gray-200 focus:border-primary focus:ring-primary text-right"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  dir="rtl"
                />
              </div>
            )}

            <div className="relative">
              <User className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input
                type="text"
                placeholder={tab === "guest" ? "اسم الزائر (اختياري)" : "اسم المستخدم"}
                className="pl-4 pr-10 h-12 rounded-xl border-gray-200 focus:border-primary focus:ring-primary text-right"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required={tab !== "guest"}
                dir="rtl"
              />
            </div>

            {tab !== "guest" && (
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="كلمة المرور"
                  className="pl-10 pr-10 h-12 rounded-xl border-gray-200 focus:border-primary focus:ring-primary text-right"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  dir="rtl"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            )}

            {displayError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-bold text-center">
                {displayError}
              </div>
            )}

            <Button 
              type="submit" 
              disabled={isLoading}
              className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-white text-base font-bold shadow-lg shadow-primary/25 transition-all"
            >
              {isLoading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : tab === "register" ? (
                "إنشاء الحساب والدخول"
              ) : tab === "guest" ? (
                "دخول كزائر"
              ) : (
                "تسجيل الدخول"
              )}
            </Button>
          </form>

          <div className="mt-6 text-center text-xs text-slate-500 font-medium">
            {tab === "login" ? (
              <>
                ليس لديك حساب؟{" "}
                <button 
                  type="button" 
                  onClick={() => handleTabChange("register")} 
                  className="text-primary font-bold hover:underline"
                >
                  إنشاء حساب جديد
                </button>
              </>
            ) : tab === "register" ? (
              <>
                لديك حساب بالفعل؟{" "}
                <button 
                  type="button" 
                  onClick={() => handleTabChange("login")} 
                  className="text-primary font-bold hover:underline"
                >
                  تسجيل الدخول
                </button>
              </>
            ) : (
              <>
                هل تريد الاحتفاظ ببياناتك؟{" "}
                <button 
                  type="button" 
                  onClick={() => handleTabChange("register")} 
                  className="text-primary font-bold hover:underline"
                >
                  سجّل عضوية الآن
                </button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
