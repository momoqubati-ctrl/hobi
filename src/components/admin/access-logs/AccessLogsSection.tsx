"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { History, Search, Trash2, RefreshCw, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AdminDataTable from '../shared/AdminDataTable';
import { getAdminHeaders } from '../utils';
import { getCountryFlagSrc } from "@/lib/countries";
import { showSuccess, showError } from "@/utils/toast";
import { useConfirm } from "@/hooks/use-confirm";

const AccessLogsSection = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState("25");
  const [processingUser, setProcessingUser] = useState<string | null>(null);
  const { confirm } = useConfirm();

  const fetchLogs = () => {
    setLoading(true);
    fetch(`/api/admin/access-logs?search=${search}&limit=${limit}`, { headers: getAdminHeaders() })
      .then(r => r.json())
      .then(data => {
        if (data.success) setLogs(data.logs);
        setLoading(false);
      });
  };

  useEffect(() => { fetchLogs(); }, [limit]);

  const handleClearLogs = async () => {
    const ok = await confirm({
      title: "مسح السجل",
      message: "هل أنت متأكد من رغبتك في مسح سجل الحالات بالكامل؟ لا يمكن التراجع عن هذا الإجراء.",
      confirmText: "نعم، امسح الكل",
      variant: "destructive"
    });

    if (!ok) return;

    try {
      const res = await fetch('/api/admin/access-logs', { 
        method: 'DELETE',
        headers: getAdminHeaders() 
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(data.message);
        setLogs([]);
      } else {
        showError(data.message);
      }
    } catch (err) {
      showError("تعذر مسح السجل");
    }
  };

  const handleVerifyUser = async (username: string, displayName: string) => {
    const ok = await confirm({
      title: "توثيق عضو",
      message: `هل أنت متأكد من توثيق العضو (${displayName})؟ سيظهر بجانب اسمه علامة التوثيق.`,
      confirmText: "توثيق الآن",
      variant: "success"
    });

    if (!ok) return;

    setProcessingUser(username);
    try {
      const res = await fetch('/api/admin/users/verify', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ username })
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(data.message);
        fetchLogs(); // تحديث القائمة لرؤية الحالة الجديدة
      } else {
        showError(data.message);
      }
    } catch (err) {
      showError("حدث خطأ أثناء التوثيق");
    } finally {
      setProcessingUser(null);
    }
  };

  const handleUnverifyUser = async (username: string, displayName: string) => {
    const ok = await confirm({
      title: "إلغاء توثيق",
      message: `هل أنت متأكد من إلغاء توثيق العضو (${displayName})؟ ستختفي علامة التوثيق من ملفه.`,
      confirmText: "إلغاء التوثيق",
      variant: "destructive"
    });

    if (!ok) return;

    setProcessingUser(username);
    try {
      const res = await fetch('/api/admin/users/unverify', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ username })
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(data.message);
        fetchLogs();
      } else {
        showError(data.message);
      }
    } catch (err) {
      showError("حدث خطأ أثناء إلغاء التوثيق");
    } finally {
      setProcessingUser(null);
    }
  };

  const formatTime = (ts: string) => {
    if (!ts) return "-";
    const date = new Date(Number(ts));
    return date.toLocaleString('en-US', { 
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false 
    });
  };

  const getUserType = (state: string, username: string) => {
    if (state === "دخول زائر" || username.startsWith("guest-")) {
      return { label: "زائر", color: "text-amber-600" };
    }
    return { label: "عضو", color: "text-green-600" };
  };

  const columns = [
    {
      key: "type",
      label: "النوع",
      render: (_: any, row: any) => {
        const type = getUserType(row.state, row.username);
        return <span className={`font-black text-[11px] ${type.color}`}>{type.label}</span>;
      }
    },
    {
      key: "state",
      label: "الحالة",
      render: (val: any) => (
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
          val.includes('دخول') ? 'bg-blue-50 text-blue-600' : 
          val.includes('تخمين') ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'
        }`}>
          {val}
        </span>
      )
    },
    {
      key: "username",
      label: "العضو",
      render: (val: any) => <span className="font-black text-slate-700 text-[11px]">{val}</span>
    },
    {
      key: "topic",
      label: "الزخرفة",
      render: (val: any) => <span className="font-black text-primary text-[11px]">{val}</span>
    },
    {
      key: "ip",
      label: "الآي بي",
      render: (val: any) => <span className="text-[10px] font-bold text-slate-500" dir="ltr">{val}</span>
    },
    {
      key: "code",
      label: "الدولة",
      render: (val: any) => (
        <div className="flex items-center gap-1 justify-center">
          <span className="text-[9px] font-bold text-slate-400 uppercase">{val}</span>
          <img src={getCountryFlagSrc(val)} className="w-4 h-3 rounded-sm object-cover shadow-sm" alt="" />
        </div>
      )
    },
    {
      key: "device",
      label: "الجهاز",
      render: (val: any) => <span className="text-[9px] font-bold text-slate-400 whitespace-nowrap" title={val}>{val || "-"}</span>
    },
    {
      key: "isin",
      label: "المصدر",
      render: (val: any) => <span className="text-[10px] font-bold text-slate-500">{val === "1" ? "*" : val}</span>
    },
    {
      key: "invitation",
      label: "الدعوة",
      render: () => <span className="text-[10px] font-bold text-slate-500">*</span>
    },
    {
      key: "createdAt",
      label: "الوقت",
      render: (val: any) => <span className="text-[10px] font-black text-slate-800" dir="ltr">{formatTime(val)}</span>
    },
    {
      key: "verify",
      label: "التوثيق",
      render: (_: any, row: any) => {
        const isGuest = row.state === "دخول زائر" || row.username.startsWith("guest-");
        if (isGuest) return null;

        const isVerified = row.isVerified === 1;

        if (isVerified) {
          return (
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-green-500" />
              <button 
                onClick={() => handleUnverifyUser(row.username, row.topic)}
                disabled={processingUser === row.username}
                className="text-red-400 hover:text-red-600 transition-colors disabled:opacity-50"
                title="إلغاء التوثيق"
              >
                {processingUser === row.username ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <XCircle size={16} />
                )}
              </button>
            </div>
          );
        }

        return (
          <button 
            onClick={() => handleVerifyUser(row.username, row.topic)}
            disabled={processingUser === row.username}
            className="text-slate-300 hover:text-green-600 transition-colors disabled:opacity-50"
            title="توثيق العضو"
          >
            {processingUser === row.username ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <CheckCircle2 size={18} />
            )}
          </button>
        );
      }
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-white">لوحة التحكم</h2>
          <p className="text-sm text-muted-foreground font-medium">متابعة سريعة للحالة العامة وإدارة السجلات</p>
        </div>
        <Button 
          variant="destructive" 
          onClick={handleClearLogs}
          className="rounded-2xl h-12 px-6 gap-2 font-black shadow-lg shadow-red-500/20"
        >
          <Trash2 size={20} /> مسح السجل
        </Button>
      </div>

      <Card className="border-none shadow-2xl shadow-slate-200/50 dark:shadow-none rounded-[32px] overflow-hidden bg-white dark:bg-slate-900">
        <CardHeader className="p-6 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <Input 
                  placeholder="البحث في السجل..." 
                  className="h-12 pr-11 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border-none focus:ring-2 focus:ring-primary/20 font-bold text-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchLogs()}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-400 whitespace-nowrap">عدد الصفوف</span>
                <Select value={limit} onValueChange={setLimit}>
                  <SelectTrigger className="w-20 h-12 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border-none font-black">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-none shadow-xl">
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="150">150</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button 
              onClick={fetchLogs} 
              variant="secondary"
              className="h-12 px-8 rounded-2xl font-black gap-2 bg-primary/10 text-primary hover:bg-primary/20"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              تحديث
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <AdminDataTable 
            columns={columns} 
            rows={logs} 
            loading={loading} 
            emptyMessage="لا توجد سجلات مطابقة للبحث"
          />
          <div className="p-4 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <History size={14} className="text-slate-400" />
            <span className="text-[10px] font-bold text-slate-400">يتم الاحتفاظ بآخر 150 سجل فقط تلقائياً لضمان سرعة أداء النظام.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AccessLogsSection;
