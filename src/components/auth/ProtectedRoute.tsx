"use client";

import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthContext } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { token, isLoading } = useAuthContext();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  const effectiveToken = token || localStorage.getItem("auth_token") || localStorage.getItem("authToken");

  if (!effectiveToken) {
    // تحويل المستخدم لصفحة الدخول مع حفظ المسار الذي كان يحاول الوصول إليه
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
