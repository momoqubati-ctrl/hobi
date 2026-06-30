"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Ban, UserX, Globe, Monitor, ShieldX, Plus, Search, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import AdminDataTable from "../shared/AdminDataTable";
import { getAdminHeaders, formatAdminDate } from "../utils";
import BanCreateModal from "./BanCreateModal";

const BansSection = () => {
  const [bans, setBans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [unbanTarget, setUnbanTarget] = useState<any>(null);
  const [unbanning, setUnbanning] = useState(false);

  const fetchBans = () => {
    setLoading(true);
    fetch("/api/admin/bans", { headers: getAdminHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setBans(data.bans);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchBans();
  }, []);

  const handleUnban = async () => {
    if (!unbanTarget) return;
    setUnbanning(true);
    try {
      const res = await fetch(`/api/admin/bans/${unbanTarget.id}`, {
        method: "DELETE",
        headers: getAdminHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        fetchBans();
      }
    } catch {
      // ignore
    } finally {
      setUnbanning(false);
      setUnbanTarget(null);
    }
  };

  const filteredBans = bans.filter((b) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (b.targetName && b.targetName.toLowerCase().includes(q)) ||
      (b.value && b.value.toLowerCase().includes(q)) ||
      (b.type && b.type.toLowerCase().includes(q)) ||
      (b.ip && b.ip.includes(q)) ||
      (b.fingerprint && b.fingerprint.toLowerCase().includes(q))
    );
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "ip": return <Globe size={18} />;
      case "device": return <Monitor size={18} />;
      case "country": return <Globe size={18} />;
      default: return <UserX size={18} />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "ip": return "text-blue-500 bg-blue-50";
      case "device": return "text-purple-500 bg-purple-50";
      case "country": return "text-green-500 bg-green-50";
      default: return "text-red-500 bg-red-50";
    }
  };

  const columns = [
    {
      key: "targetName",
      label: "المستهدف",
      render: (val: any, row: any) => (
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${getTypeColor(row.type)}`}>
            {getTypeIcon(row.type)}
          </div>
          <div>
            <div className="font-black text-slate-800 dark:text-white">{val}</div>
            <div className="text-[10px] font-bold text-slate-400" dir="ltr">
              {row.type === "ip" ? row.ip || row.value : row.value}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "type",
      label: "النوع",
      render: (val: any) => (
        <Badge variant="outline" className="font-bold border-slate-200">
          {val === "ip" ? "IP" : val === "device" ? "جهاز" : val === "country" ? "دولة" : "اسم"}
        </Badge>
      ),
    },
    {
      key: "duration",
      label: "المدة",
      render: (val: any) => <span className="font-bold text-amber-600">{val || "دائم"}</span>,
    },
    {
      key: "isActive",
      label: "الحالة",
      render: (val: any, row: any) => {
        const expired = row.expiresAt && new Date(row.expiresAt) < new Date();
        const active = val && !expired;
        return (
          <Badge
            className={
              active
                ? "bg-red-500/10 text-red-600 border-none"
                : "bg-slate-100 text-slate-400 border-none"
            }
          >
            {active ? "نشط" : "منتهي"}
          </Badge>
        );
      },
    },
    {
      key: "reason",
      label: "السبب",
      render: (val: any) => (
        <span className="text-xs text-slate-500 max-w-[120px] block truncate" title={val}>
          {val || "-"}
        </span>
      ),
    },
    {
      key: "createdBy",
      label: "بواسطة",
      render: (val: any) => (
        <span className="text-xs font-bold text-primary">{val || "النظام"}</span>
      ),
    },
    {
      key: "createdAt",
      label: "التاريخ",
      render: (val: any) => (
        <span className="text-[10px] font-bold text-slate-400" dir="ltr">
          {formatAdminDate(val)}
        </span>
      ),
    },
    {
      key: "actions",
      label: "إجراءات",
      render: (_: any, row: any) => (
        <div className="flex gap-1">
          {row.isActive && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-xl text-red-400 hover:bg-red-50 hover:text-red-600"
              onClick={() => setUnbanTarget(row)}
              title="فك الحظر"
            >
              <Trash2 size={18} />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-800 dark:text-white">إدارة الحظر</h2>
            <p className="text-sm text-muted-foreground font-medium">
              التحكم في قائمة المطرودين والمحظورين من الموقع
            </p>
          </div>
          <Button
            className="rounded-2xl h-12 px-6 gap-2 font-black shadow-lg shadow-primary/20"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={20} /> إضافة حظر جديد
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <BanStatCard
            icon={<Globe size={20} />}
            label="حظر IP"
            value={bans.filter((b) => b.type === "ip").length}
            color="text-blue-500"
          />
          <BanStatCard
            icon={<Monitor size={20} />}
            label="حظر أجهزة"
            value={bans.filter((b) => b.type === "device").length}
            color="text-purple-500"
          />
          <BanStatCard
            icon={<ShieldX size={20} />}
            label="حظر دائم"
            value={bans.filter((b) => b.duration === "دائم" || !b.expiresAt).length}
            color="text-red-500"
          />
        </div>

        <Card className="border-none shadow-xl rounded-3xl overflow-hidden">
          <CardHeader className="p-6 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <Input
                  placeholder="بحث في قائمة الحظر..."
                  className="h-11 pr-10 rounded-2xl bg-slate-50 border-none focus:ring-2 focus:ring-primary/20"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                onClick={fetchBans}
                className="h-11 px-6 rounded-2xl font-bold"
              >
                تحديث
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <AdminDataTable columns={columns} rows={filteredBans} loading={loading} />
          </CardContent>
        </Card>
      </div>

      <BanCreateModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onBanCreated={fetchBans}
      />

      <AlertDialog open={!!unbanTarget} onOpenChange={(o) => !o && setUnbanTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="text-amber-500" size={20} />
              تأكيد فك الحظر
            </AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من فك الحظر عن{" "}
              <span className="font-bold text-foreground">{unbanTarget?.targetName}</span>؟
              {unbanTarget?.type === "ip" && (
                <span className="block mt-1 text-xs text-slate-500" dir="ltr">
                  IP: {unbanTarget?.ip || unbanTarget?.value}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-2xl font-bold">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnban}
              disabled={unbanning}
              className="rounded-2xl font-bold bg-red-500 hover:bg-red-600"
            >
              {unbanning ? "جاري..." : "نعم، فك الحظر"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

const BanStatCard = ({ icon, label, value, color }: any) => (
  <Card className="border-none shadow-md rounded-2xl overflow-hidden">
    <CardContent className="p-4 flex items-center gap-4">
      <div className={`p-3 bg-slate-50 rounded-xl ${color}`}>{icon}</div>
      <div>
        <p className="text-[10px] font-black text-slate-400 uppercase">{label}</p>
        <h4 className="text-xl font-black">{value}</h4>
      </div>
    </CardContent>
  </Card>
);

export default BansSection;
