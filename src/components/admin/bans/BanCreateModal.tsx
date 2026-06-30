"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Loader2, UserX, Globe, Monitor, Fingerprint, AlertTriangle } from "lucide-react";
import { getAdminHeaders } from "../utils";

interface SearchedUser {
  id: string;
  username: string;
  displayName: string;
  ip: string;
  fingerprint: string;
  deviceSignature: string;
  countryCode: string;
  avatar: string;
  idreg: string;
  uid: string;
  power: string;
  lastActive: string | null;
  role: string;
}

interface BanCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBanCreated: () => void;
}

const BanCreateModal = ({ open, onOpenChange, onBanCreated }: BanCreateModalProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchedUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SearchedUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const banTypes = [
    { key: "name", label: "اسم المستخدم", icon: <UserX size={16} />, enabled: true },
    { key: "ip", label: "عنوان IP", icon: <Globe size={16} />, enabled: true },
    { key: "device", label: "بصمة الجهاز", icon: <Monitor size={16} />, enabled: true },
    { key: "signature", label: "توقيع الجهاز", icon: <Fingerprint size={16} />, enabled: true },
  ];

  const [selectedTypes, setSelectedTypes] = useState<Record<string, boolean>>(
    Object.fromEntries(banTypes.map((t) => [t.key, true])),
  );

  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("permanent");
  const [customDays, setCustomDays] = useState("7");

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 1) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/users-search?q=${encodeURIComponent(q)}`, {
        headers: getAdminHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.users);
      }
    } catch {
      // ignore
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setSelectedUser(null);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => doSearch(val), 300);
  };

  const selectUser = (user: SearchedUser) => {
    setSelectedUser(user);
    setSearchQuery(user.displayName || user.username);
    setSearchResults([]);
  };

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setSearchResults([]);
      setSelectedUser(null);
      setReason("");
      setDuration("permanent");
      setCustomDays("7");
      setError("");
      setSelectedTypes(Object.fromEntries(banTypes.map((t) => [t.key, true])));
    }
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSearchResults([]);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSubmit = async () => {
    if (!selectedUser) {
      setError("الرجاء اختيار مستخدم");
      return;
    }

    const activeTypes = Object.entries(selectedTypes).filter(([, v]) => v);
    if (activeTypes.length === 0) {
      setError("الرجاء اختيار نوع حظر واحد على الأقل");
      return;
    }

    setSubmitting(true);
    setError("");

    let expiresAt: string | null = null;
    let expiresLabel = "دائم";
    if (duration === "custom" && customDays) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(customDays));
      expiresAt = d.toISOString();
      expiresLabel = `${customDays} يوم`;
    }

    try {
      for (const [type] of activeTypes) {
        let value = "";
        let ip = "";
        let deviceFingerprint = "";
        let deviceSignature = "";

        if (type === "name") {
          value = selectedUser.username;
        } else if (type === "ip") {
          value = selectedUser.ip;
          ip = selectedUser.ip;
        } else if (type === "device") {
          value = selectedUser.fingerprint;
          deviceFingerprint = selectedUser.fingerprint;
        } else if (type === "signature") {
          value = selectedUser.deviceSignature;
          deviceSignature = selectedUser.deviceSignature;
        }

        const res = await fetch("/api/admin/bans", {
          method: "POST",
          headers: getAdminHeaders(),
          body: JSON.stringify({
            targetName: selectedUser.username,
            type: type === "signature" ? "device" : type,
            value,
            ip: selectedUser.ip,
            deviceFingerprint: type === "device" ? selectedUser.fingerprint : "",
            deviceSignature: type === "signature" ? selectedUser.deviceSignature : "",
            countryCode: selectedUser.countryCode,
            reason,
            expiresAt,
            expiresLabel,
          }),
        });

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.message);
        }
      }

      onBanCreated();
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء الحظر");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <UserX className="text-red-500" size={22} />
            إضافة حظر جديد
          </DialogTitle>
          <DialogDescription>ابحث عن مستخدم أو زائر وقم بحظره من الموقع بشكل كامل</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="relative" ref={dropdownRef}>
            <Label className="text-sm font-bold mb-2 block">البحث عن مستخدم</Label>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <Input
                placeholder="ابحث باسم المستخدم أو IP..."
                className="h-11 pr-10 rounded-2xl"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                dir="rtl"
              />
              {searching && (
                <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 animate-spin text-primary" size={18} />
              )}
            </div>
            {searchResults.length > 0 && (
              <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl max-h-60 overflow-y-auto">
                {searchResults.map((user) => (
                  <button
                    key={user.id}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-right border-b border-slate-100 dark:border-slate-800 last:border-0"
                    onClick={() => selectUser(user)}
                  >
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center text-xs font-black text-primary overflow-hidden shrink-0">
                      {user.avatar && user.avatar !== "/pic.png" ? (
                        <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        (user.displayName || user.username)[0]
                      )}
                    </div>
                    <div className="flex-1 min-w-0 text-right">
                      <div className="font-bold text-sm truncate">{user.displayName || user.username}</div>
                      <div className="text-[10px] text-slate-400 flex gap-2">
                        <span dir="ltr">@{user.username}</span>
                        {user.ip && <span dir="ltr" className="text-blue-400">{user.ip}</span>}
                      </div>
                    </div>
                    {user.idreg && (
                      <span className="text-[9px] font-bold text-slate-300" dir="ltr">#{user.idreg}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedUser && (
            <div className="bg-red-50 dark:bg-red-950/20 rounded-2xl p-4 border border-red-100 dark:border-red-900/30">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white font-bold text-sm overflow-hidden shrink-0">
                  {selectedUser.avatar && selectedUser.avatar !== "/pic.png" ? (
                    <img src={selectedUser.avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (selectedUser.displayName || selectedUser.username)[0]
                  )}
                </div>
                <div>
                  <div className="font-black text-slate-800 dark:text-white">{selectedUser.displayName || selectedUser.username}</div>
                  <div className="text-[11px] text-slate-500 flex gap-3">
                    <span dir="ltr">@{selectedUser.username}</span>
                    {selectedUser.idreg && <span dir="ltr">#{selectedUser.idreg}</span>}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
                {selectedUser.ip && (
                  <div className="bg-white/60 dark:bg-slate-800/60 rounded-xl px-3 py-2">
                    <span className="text-slate-400">IP: </span>
                    <span className="text-slate-700 dark:text-slate-300" dir="ltr">{selectedUser.ip}</span>
                  </div>
                )}
                {selectedUser.fingerprint && (
                  <div className="bg-white/60 dark:bg-slate-800/60 rounded-xl px-3 py-2 truncate">
                    <span className="text-slate-400">FP: </span>
                    <span className="text-slate-700 dark:text-slate-300 text-[9px]" dir="ltr">{selectedUser.fingerprint}</span>
                  </div>
                )}
                {selectedUser.deviceSignature && (
                  <div className="bg-white/60 dark:bg-slate-800/60 rounded-xl px-3 py-2 truncate col-span-2">
                    <span className="text-slate-400">توقيع: </span>
                    <span className="text-slate-700 dark:text-slate-300 text-[9px]" dir="ltr">{selectedUser.deviceSignature}</span>
                  </div>
                )}
                {selectedUser.countryCode && (
                  <div className="bg-white/60 dark:bg-slate-800/60 rounded-xl px-3 py-2">
                    <span className="text-slate-400">الدولة: </span>
                    <span className="text-slate-700 dark:text-slate-300">{selectedUser.countryCode}</span>
                  </div>
                )}
                {selectedUser.power && (
                  <div className="bg-white/60 dark:bg-slate-800/60 rounded-xl px-3 py-2">
                    <span className="text-slate-400">الصلاحية: </span>
                    <span className="text-slate-700 dark:text-slate-300">{selectedUser.power}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <Label className="text-sm font-bold mb-2 block">نوع الحظر</Label>
            <div className="grid grid-cols-2 gap-2">
              {banTypes.map((bt) => (
                <button
                  key={bt.key}
                  type="button"
                  onClick={() => setSelectedTypes((prev) => ({ ...prev, [bt.key]: !prev[bt.key] }))}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-bold transition-all ${
                    selectedTypes[bt.key]
                      ? "bg-red-500/10 border-red-200 dark:border-red-800 text-red-600"
                      : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"
                  }`}
                >
                  {bt.icon}
                  {bt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-sm font-bold mb-2 block">السبب</Label>
            <Input
              placeholder="سبب الحظر (اختياري)..."
              className="h-11 rounded-2xl"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div>
            <Label className="text-sm font-bold mb-2 block">المدة</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDuration("permanent")}
                className={`flex-1 px-4 py-2.5 rounded-xl border text-sm font-bold transition-all ${
                  duration === "permanent"
                    ? "bg-red-500/10 border-red-200 dark:border-red-800 text-red-600"
                    : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"
                }`}
              >
                دائم
              </button>
              <button
                type="button"
                onClick={() => setDuration("custom")}
                className={`flex-1 px-4 py-2.5 rounded-xl border text-sm font-bold transition-all ${
                  duration === "custom"
                    ? "bg-amber-500/10 border-amber-200 dark:border-amber-800 text-amber-600"
                    : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"
                }`}
              >
                مؤقت
              </button>
            </div>
            {duration === "custom" && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  max="365"
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  className="h-10 w-24 rounded-xl text-center"
                  dir="ltr"
                />
                <span className="text-sm font-bold text-slate-500">يوم</span>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-200 rounded-2xl px-4 py-3 flex items-center gap-2 text-sm font-bold text-red-600">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-2xl h-11 font-bold">
            إلغاء
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !selectedUser}
            className="rounded-2xl h-11 font-bold gap-2 bg-red-500 hover:bg-red-600"
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <UserX size={18} />}
            {submitting ? "جاري الحظر..." : "تأكيد الحظر"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BanCreateModal;
