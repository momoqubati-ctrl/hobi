"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit3, Trash2, Shield, Crown, Loader2 } from 'lucide-react';
import { getAdminHeaders } from '../utils';
import { useConfirm } from '@/hooks/use-confirm';

interface RoleRow {
  id: string;
  name: string;
  rank: number;
  color?: string;
  is_staff?: boolean;
  auto_enabled?: boolean;
  auto_points?: number;
  is_hidden?: boolean;
  permissions?: Record<string, string | number | boolean>;
}

const RolesSection = () => {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { confirm } = useConfirm();

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/roles', { headers: getAdminHeaders() });
      const data = await res.json();
      if (data.success) setRoles(data.roles);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRoles(); }, []);

  if (loading) return <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-800">إدارة الرتب</h2>
          <p className="text-sm text-muted-foreground font-medium">تخصيص الرتب، الألوان، والهرمية</p>
        </div>
        <Button className="rounded-2xl h-12 px-6 gap-2 font-black shadow-lg shadow-primary/20">
          <Plus size={20} /> إضافة رتبة جديدة
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {roles.map(role => (
          <Card key={role.id} className="border-none shadow-xl rounded-3xl overflow-hidden group hover:scale-[1.02] transition-all">
            <div className="h-2 w-full" style={{ backgroundColor: role.color }} />
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-2xl bg-slate-50" style={{ color: role.color }}>
                    {role.rank >= 9000 ? <Crown size={24} /> : <Shield size={24} />}
                  </div>
                  <div>
                    <h3 className="font-black text-lg text-slate-800">{role.name}</h3>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Priority: {role.rank}</span>
                  </div>
                </div>
                <Badge variant="outline" className="rounded-lg font-black border-slate-200">
                  {role.is_staff ? 'إدارية' : 'عادية'}
                </Badge>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-slate-400">الترقية التلقائية:</span>
                  <span className={role.auto_enabled ? 'text-green-600' : 'text-slate-300'}>
                    {role.auto_enabled ? `${role.auto_points} نقطة` : 'معطلة'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-slate-400">الحالة:</span>
                  <span className={role.is_hidden ? 'text-amber-600' : 'text-blue-600'}>
                    {role.is_hidden ? 'مخفية' : 'مرئية'}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 pt-4 border-t border-slate-50">
                <Button variant="ghost" className="flex-1 rounded-xl font-bold gap-2 hover:bg-slate-50">
                  <Edit3 size={16} /> تعديل
                </Button>
                <Button variant="ghost" className="rounded-xl text-red-400 hover:bg-red-50 hover:text-red-500">
                  <Trash2 size={16} />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default RolesSection;