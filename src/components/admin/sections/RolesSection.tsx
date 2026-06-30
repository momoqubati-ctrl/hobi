"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Loader2, Save } from 'lucide-react';
import { getAdminHeaders } from '../utils';
import { PERMISSION_TRANSLATIONS } from '../constants';
import { showSuccess, showError } from '@/utils/toast';

interface Role {
  id: string;
  name: string;
  rank: number;
  color?: string;
  ico?: string;
  permissions: Record<string, string | number | boolean>;
  is_staff?: boolean;
  auto_enabled?: boolean;
  auto_points?: number;
  is_hidden?: boolean;
}

interface PermissionValue {
  value: string | number | boolean;
}

const RolesSection = () => {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selected, setSelected] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, string | number | boolean>>({});

  useEffect(() => {
    setLoading(true);
    fetch('/api/admin/roles', { headers: getAdminHeaders() })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setRoles(data.roles);
          setSelected(data.roles[0]);
        }
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (selected) {
      setPermissions(selected.permissions || {});
    }
  }, [selected]);

  const handlePermissionChange = (key: string, value: string | number | boolean) => {
    setPermissions(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const matrix = {
        [selected.id]: permissions
      };
      const res = await fetch('/api/admin/permissions/bulk', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ matrix })
      });
      const data = await res.json();
      if (data.success) {
        showSuccess("تم حفظ صلاحيات الرتبة بنجاح");
        setRoles(prev => prev.map(r => r.id === selected.id ? { ...r, permissions } : r));
        setSelected({ ...selected, permissions });
      } else {
        showError(data.message || "فشل الحفظ");
      }
    } catch (err) {
      showError("حدث خطأ أثناء الحفظ");
    } finally {
      setSaving(false);
    }
  };

  if (!selected && !loading) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
      <Card className="border-none shadow-lg rounded-3xl h-fit">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800">
          <CardTitle className="text-lg font-black">الرتب</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          {roles.map(r => (
            <button
              key={r.id}
              onClick={() => setSelected(r)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-bold transition-all mb-1 ${selected?.id === r.id ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
            >
              <div className="flex items-center gap-2">
                {r.ico && (
                  <img src={r.ico} alt="" className="w-5 h-5 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                )}
                <span>{r.name}</span>
              </div>
              <Badge variant="secondary" className="text-[10px] rounded-lg">{r.rank}</Badge>
            </button>
          ))}
        </CardContent>
      </Card>

      {selected && (
        <Card className="border-none shadow-lg rounded-3xl overflow-hidden">
          <CardHeader className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 p-6">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-black text-primary">صلاحيات: {selected.name}</CardTitle>
                <p className="text-xs font-bold text-muted-foreground mt-1">تعديل قوى الرتبة في النظام</p>
              </div>
              <Button 
                onClick={handleSave} 
                disabled={saving}
                className="rounded-2xl font-bold px-8 shadow-lg shadow-primary/20"
              >
                {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                {saving ? 'جاري الحفظ...' : 'حفظ'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(permissions).map(([key, val]) => {
                const isBooleanLike = val === 0 || val === 1 || typeof val === 'boolean';
                const translatedKey = PERMISSION_TRANSLATIONS[key] || key;
                
                return (
                  <div key={key} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{translatedKey}</span>
                    {isBooleanLike ? (
                      <Switch 
                        checked={val === 1 || val === true} 
                        onCheckedChange={(checked) => handlePermissionChange(key, checked)}
                      />
                    ) : (
                      <Input 
                        className="w-24 h-9 text-center font-black rounded-xl" 
                        value={String(val)}
                        onChange={(e) => handlePermissionChange(key, e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default RolesSection;