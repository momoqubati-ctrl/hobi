"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search, Save, Loader2, Plus, Trash2, Crown, Shield, Palette, X, Check,
  Image, Trash, Edit3, Users, ToggleLeft, ToggleRight, ArrowRight,
  Calendar, Hash, Star, ChevronRight
} from 'lucide-react';
import { getAdminHeaders } from '../utils';
import { showSuccess, showError } from '@/utils/toast';
import {
  BASIC_GROUPS,
  VISUAL_RESOURCES,
  ACTION_LABELS,
  getActionsForResource,
  isPermissionActionImplemented,
  togglePermissionValue,
} from './permissionDefs';
import { isValidAnnouncementDailyLimit } from '@/lib/chatFeaturePermissions';
import { useRealtimeStore } from "@/lib/realtime-store";
import { hasPermissionAccess } from "@/lib/permissionAccess";

// ────────────────────────── Types ──────────────────────────
interface RoleRow {
  id: string;
  name: string;
  rank: number;
  color?: string;
  ico?: string;
  is_default?: boolean;
  is_owner?: boolean;
  is_site_owner?: boolean;
  is_active: boolean;
  auto_enabled?: number;
  auto_promote?: number;
  auto_points?: number;
  announcement_daily_limit?: number;
  member_count: number;
  created_at: string;
  updated_at?: string;
  permissions: Record<string, boolean>;
}

interface MemberRow {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  assigned_at: string;
  expires_at?: string;
}

interface IconEntry {
  id: string;
  name: string;
  image_url: string;
}

type Matrix = Record<string, Record<string, boolean>>;

// view state: 'list' = role table, 'edit' = permissions matrix for one role
type ViewMode = 'list' | 'create' | 'edit';

const isProtectedRole = (role?: Pick<RoleRow, 'is_owner' | 'is_site_owner'> | null) =>
  Boolean(role?.is_owner || role?.is_site_owner);

// ────────────────────────── Helpers ──────────────────────────
const ACTION_COLORS: Record<string, string> = {
  read: "text-blue-600 border-blue-400 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500",
  edit: "text-amber-600 border-amber-400 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500",
  delete: "text-red-600 border-red-400 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500",
  all: "text-violet-600 border-violet-400 data-[state=checked]:bg-violet-500 data-[state=checked]:border-violet-500",
  use: "text-emerald-600 border-emerald-400 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500",
};

const ACTION_SHORT: Record<string, string> = {
  read: "ق", edit: "ت", delete: "ح", all: "ك", use: "ا",
};

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" });
}

// ════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ════════════════════════════════════════════════════════════
const PermissionsMatrix = () => {
  const permissions = useRealtimeStore((state) => state.userPermissions);
  const canManageRoles = hasPermissionAccess(permissions, "admin_roles.edit");
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [matrix, setMatrix] = useState<Matrix>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // view mode
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeRole, setActiveRole] = useState<RoleRow | null>(null);

  // create form
  const [newRole, setNewRole] = useState({ name: "", rank: "0", icon: "", color: "#6366f1", auto_enabled: false, auto_points: "0", expires_at: "" });
  const [icons, setIcons] = useState<IconEntry[]>([]);
  const [loadingIcons, setLoadingIcons] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);

  // edit icon
  const [editIcon, setEditIcon] = useState<string>("");
  const [editIconPicker, setEditIconPicker] = useState(false);
  const [savingIcon, setSavingIcon] = useState(false);
  const [dailyLimitDraft, setDailyLimitDraft] = useState("0");

  // members modal
  const [membersModal, setMembersModal] = useState<{ open: boolean; role: RoleRow | null; members: MemberRow[]; loading: boolean }>({
    open: false, role: null, members: [], loading: false,
  });

  // toggling active state
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { if (viewMode === 'create' || viewMode === 'edit') fetchIcons(); }, [viewMode]);
  useEffect(() => {
    if (viewMode === 'edit' && activeRole) {
      setEditIcon(activeRole.ico || "");
      setDailyLimitDraft(String(activeRole.announcement_daily_limit ?? 0));
    }
  }, [viewMode, activeRole]);

  // ── Fetch ────────────────────────────────────────────────
  // تطبيع قيم الصلاحيات من jsonb إلى boolean
  const normalizePerms = (raw: Record<string, any>): Record<string, boolean> => {
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw || {})) {
      out[k] = v === true || v === 1 || v === 'true' || v === '1';
    }
    return out;
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/roles', { headers: getAdminHeaders() });
      const data = await res.json();
      if (data.success) {
        setRoles(data.roles);
        // لا نعيد بناء المصفوفة إذا كنا في وضع التعديل حتى لا نفقد التغييرات
        if (viewMode !== 'edit') {
          const init: Matrix = {};
          data.roles.forEach((r: RoleRow) => { init[r.id] = normalizePerms(r.permissions || {}); });
          setMatrix(init);
        }
        // مزامنة الرتبة النشطة
        if (activeRole) {
          const updated = data.roles.find((r: RoleRow) => r.id === activeRole.id);
          if (updated) setActiveRole(updated);
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const fetchIcons = async () => {
    setLoadingIcons(true);
    try {
      const res = await fetch('/api/admin/icons', { headers: getAdminHeaders() });
      const data = await res.json();
      if (data.success) setIcons(data.icons);
    } catch { /* ignore */ }
    finally { setLoadingIcons(false); }
  };

  const fetchMembers = async (role: RoleRow) => {
    setMembersModal({ open: true, role, members: [], loading: true });
    try {
      const res = await fetch(`/api/admin/roles/${role.id}/members`, { headers: getAdminHeaders() });
      const data = await res.json();
      if (data.success) {
        setMembersModal(prev => ({ ...prev, members: data.members, loading: false }));
      } else {
        setMembersModal(prev => ({ ...prev, loading: false }));
        showError(data.message);
      }
    } catch {
      setMembersModal(prev => ({ ...prev, loading: false }));
      showError("فشل جلب الأعضاء");
    }
  };

  // ── Actions ──────────────────────────────────────────────
  const toggleRoleActive = async (role: RoleRow) => {
    if (!hasPermissionAccess(useRealtimeStore.getState().userPermissions, "admin_roles.edit")) return;
    if (isProtectedRole(role)) return;
    setTogglingId(role.id);
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'PUT',
        headers: getAdminHeaders(),
        body: JSON.stringify({ id: role.id, is_active: !role.is_active }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(role.is_active ? "تم تعطيل الرتبة" : "تم تفعيل الرتبة");
        fetchData();
      } else showError(data.message);
    } catch { showError("فشل تغيير حالة الرتبة"); }
    finally { setTogglingId(null); }
  };

  const createRole = async () => {
    if (!hasPermissionAccess(useRealtimeStore.getState().userPermissions, "admin_roles.edit")) return;
    if (!newRole.name.trim()) { showError("اسم الرتبة مطلوب"); return; }
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'POST', headers: getAdminHeaders(),
        body: JSON.stringify(newRole)
      });
      const data = await res.json();
      if (data.success) {
        showSuccess("تم إنشاء الرتبة");
        setViewMode('list');
        setNewRole({ name: "", rank: "0", icon: "", color: "#6366f1", auto_enabled: false, auto_points: "0", expires_at: "" });
        fetchData();
      } else showError(data.message);
    } catch { showError("فشل إنشاء الرتبة"); }
  };

  const deleteRole = async (roleId: string, name: string) => {
    if (!hasPermissionAccess(useRealtimeStore.getState().userPermissions, "admin_roles.edit")) return;
    if (roles.some(role => role.id === roleId && isProtectedRole(role))) return;
    if (!confirm(`هل أنت متأكد من حذف الرتبة "${name}"؟`)) return;
    try {
      const res = await fetch(`/api/admin/roles/${roleId}`, { method: 'DELETE', headers: getAdminHeaders() });
      const data = await res.json();
      if (data.success) { showSuccess("تم حذف الرتبة"); fetchData(); }
      else showError(data.message);
    } catch { showError("فشل حذف الرتبة"); }
  };

  const handleSaveIcon = async () => {
    if (!hasPermissionAccess(useRealtimeStore.getState().userPermissions, "admin_roles.edit")) return;
    if (!activeRole || isProtectedRole(activeRole)) return;
    setSavingIcon(true);
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'PUT',
        headers: getAdminHeaders(),
        body: JSON.stringify({ id: activeRole.id, icon: editIcon || null }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess("تم حفظ الأيقونة بنجاح");
        setRoles(prev => prev.map(r => r.id === activeRole.id ? { ...r, ico: editIcon || undefined } : r));
        setActiveRole(prev => prev ? { ...prev, ico: editIcon || undefined } : prev);
      } else showError(data.message);
    } catch { showError("فشل حفظ الأيقونة"); }
    finally { setSavingIcon(false); }
  };

  // ── Permissions helpers ───────────────────────────────────
  const handleToggle = (roleId: string, permKey: string) => {
    if (!hasPermissionAccess(useRealtimeStore.getState().userPermissions, "admin_roles.edit")) return;
    if (activeRole?.id === roleId && isProtectedRole(activeRole)) return;
    const separator = permKey.lastIndexOf(".");
    if (separator < 0) return;

    setMatrix(prev => {
      return {
        ...prev,
        [roleId]: togglePermissionValue(
          prev[roleId] || {},
          permKey.slice(0, separator),
          permKey.slice(separator + 1),
        ),
      };
    });
  };

  const handleToggleAllActions = (roleId: string, resKey: string, enable: boolean) => {
    if (!hasPermissionAccess(useRealtimeStore.getState().userPermissions, "admin_roles.edit")) return;
    if (activeRole?.id === roleId && isProtectedRole(activeRole)) return;
    setMatrix(prev => {
      const next = { ...prev, [roleId]: { ...(prev[roleId] || {}) } };
      const actions = getActionsForResource(resKey).filter(action => isPermissionActionImplemented(resKey, action));
      actions.forEach(action => { next[roleId][`${resKey}.${action}`] = enable; });
      if (enable && actions.includes("all")) {
        ["read", "edit", "delete"].forEach(action => {
          if (isPermissionActionImplemented(resKey, action)) next[roleId][`${resKey}.${action}`] = true;
        });
      }
      return next;
    });
  };

  const handleSavePermissions = async () => {
    if (!hasPermissionAccess(useRealtimeStore.getState().userPermissions, "admin_roles.edit")) return;
    if (!activeRole || isProtectedRole(activeRole)) return;
    const dailyLimit = Number(dailyLimitDraft);
    if (!dailyLimitDraft.trim() || !isValidAnnouncementDailyLimit(dailyLimit)) {
      showError("يجب أن يكون الحد اليومي عددًا صحيحًا بين 0 و1000");
      return;
    }
    setSaving(true);
    try {
      // حفظ الأيقونة إذا تغيرت
      if (editIcon !== (activeRole.ico || "")) {
        const iconRes = await fetch('/api/admin/roles', {
          method: 'PUT',
          headers: getAdminHeaders(),
          body: JSON.stringify({ id: activeRole.id, icon: editIcon || null }),
        });
        const iconData = await iconRes.json();
        if (!iconData.success) {
          showError("فشل حفظ الأيقونة: " + iconData.message);
          setSaving(false);
          return;
        }
      }
      // حفظ الصلاحيات
      const savedPerms = matrix[activeRole.id] || {};
      const roleMatrix = { [activeRole.id]: savedPerms };
      const res = await fetch('/api/admin/permissions/bulk', {
        method: 'POST', headers: getAdminHeaders(),
        body: JSON.stringify({
          matrix: roleMatrix,
          announcementDailyLimits: { [activeRole.id]: dailyLimit },
        })
      });
      const data = await res.json();
      if (data.success) {
        showSuccess("تم حفظ الصلاحيات والأيقونة بنجاح");
        // تحديث حالة الرتب المحلية فوراً
        setRoles(prev => prev.map(r =>
          r.id === activeRole.id
            ? {
                ...r,
                permissions: savedPerms,
                announcement_daily_limit: dailyLimit,
                ico: editIcon || undefined,
              }
            : r
        ));
        setActiveRole(prev => prev
          ? {
              ...prev,
              permissions: savedPerms,
              announcement_daily_limit: dailyLimit,
              ico: editIcon || undefined,
            }
          : prev);
      } else showError(data.message);
    } catch { showError("حدث خطأ أثناء الحفظ"); }
    finally { setSaving(false); }
  };

  // ── Filter helpers ────────────────────────────────────────
  const filteredGroups = BASIC_GROUPS.map(g => ({
    ...g, resources: g.resources.filter(r => !search || r.label.includes(search) || r.key.includes(search)),
  })).filter(g => g.resources.length > 0);

  const filteredVisual = VISUAL_RESOURCES.filter(r => !search || r.label.includes(search) || r.key.includes(search));

  // ── Loading ───────────────────────────────────────────────
  if (!canManageRoles && viewMode !== "list") {
    return (
      <div role="status" className="rounded-3xl border border-dashed border-border bg-white py-12 text-center text-sm text-muted-foreground dark:bg-slate-900">
        لا تملك صلاحية تعديل الرتب والصلاحيات.
      </div>
    );
  }

  if (loading) return (
    <div className="py-20 text-center">
      <Loader2 className="animate-spin mx-auto w-8 h-8 text-primary" />
      <p className="mt-3 text-sm text-muted-foreground">جارٍ تحميل الرتب...</p>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  //  VIEW: EDIT PERMISSIONS
  // ══════════════════════════════════════════════════════════
  if (viewMode === 'edit' && activeRole) {
    return (
      <div className="space-y-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => { setViewMode('list'); setActiveRole(null); setSearch(""); setEditIcon(""); setEditIconPicker(false); }}
            className="flex items-center gap-1 text-primary hover:underline font-bold"
          >
            <ArrowRight size={14} className="rotate-180" /> الرتب
          </button>
          <ChevronRight size={14} className="text-slate-400 rotate-180" />
          <span className="font-bold text-slate-700 dark:text-slate-200">
            {activeRole.name}
          </span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            {/* Icon with edit button */}
            <div className="relative">
              <div className="w-12 h-12 rounded-2xl border-2 border-slate-100 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800 flex items-center justify-center shadow">
                {editIcon ? (
                  <img src={editIcon} alt="" className="w-9 h-9 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  <Crown size={20} className="text-slate-400" />
                )}
              </div>
              <button
                type="button"
                onClick={() => setEditIconPicker(true)}
                className="absolute -bottom-1 -left-1 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shadow-lg hover:bg-primary/90 transition-colors"
                title="تغيير الأيقونة"
              >
                <Image size={12} />
              </button>
              {/* Edit Icon Picker Popup */}
              {editIconPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setEditIconPicker(false)} />
                  <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-4 max-h-80 overflow-y-auto w-72 sm:w-96">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-bold text-sm text-slate-700 dark:text-slate-300">اختر أيقونة</h4>
                      <div className="flex items-center gap-1">
                        {editIcon && (
                          <Button variant="ghost" size="sm" onClick={() => { setEditIcon(""); handleSaveIcon(); }} className="h-7 text-red-400 hover:text-red-600 rounded-full">
                            <Trash size={12} />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setEditIconPicker(false)} className="h-7 w-7 p-0 rounded-full"><X size={14} /></Button>
                      </div>
                    </div>
                    {loadingIcons ? (
                      <div className="py-8 text-center"><Loader2 className="animate-spin mx-auto w-6 h-6 text-primary" /></div>
                    ) : icons.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">لا توجد أيقونات.</p>
                    ) : (
                      <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
                        {icons.map(icon => (
                          <button key={icon.id} type="button"
                            onClick={() => { setEditIcon(icon.image_url); setEditIconPicker(false); }}
                            className={`flex items-center justify-center p-2 h-12 w-12 rounded-xl border-2 transition-all hover:border-primary hover:bg-primary/5 ${editIcon === icon.image_url ? 'border-primary bg-primary/10 ring-2 ring-primary/30' : 'border-transparent bg-slate-50 dark:bg-slate-800'}`}
                            title={icon.name || undefined}
                          >
                            <img src={icon.image_url} alt={icon.name || ''} className="max-w-full max-h-full object-contain" loading="lazy" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 dark:text-slate-100">
                صلاحيات رتبة: <span style={{ color: activeRole.color }}>{activeRole.name}</span>
              </h2>
              <p className="text-xs text-muted-foreground">قم بتحديد الصلاحيات الممنوحة لهذه الرتبة</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setViewMode('list'); setActiveRole(null); setSearch(""); setEditIcon(""); setEditIconPicker(false); }} className="rounded-2xl h-10 gap-2">
              <X size={16} /> إلغاء
            </Button>
            {canManageRoles && <Button onClick={handleSavePermissions} disabled={saving} className="rounded-2xl h-10 gap-2 font-black shadow-lg shadow-primary/20">
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              حفظ الصلاحيات
            </Button>}
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <Input
            placeholder="بحث في الصلاحيات..."
            className="h-10 pr-10 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <Card className="max-w-sm border border-border shadow-sm">
          <CardContent className="space-y-2 p-4">
            <label htmlFor="announcement-daily-limit" className="text-sm font-bold text-foreground">
              الحد اليومي للإعلانات
            </label>
            <Input
              id="announcement-daily-limit"
              type="number"
              min={0}
              max={1000}
              step={1}
              value={dailyLimitDraft}
              disabled={isProtectedRole(activeRole)}
              onChange={(event) => setDailyLimitDraft(event.target.value)}
              aria-describedby="announcement-daily-limit-help"
              className="h-10"
            />
            <p id="announcement-daily-limit-help" className="text-xs text-muted-foreground">
              0 يمنع الإرسال. الحصة مشتركة بين الأنواع المسموحة وتُصفّر يوميًا بتوقيت الرياض.
            </p>
          </CardContent>
        </Card>

        {/* Permissions Table (single role) */}
        <Card className="border-none shadow-xl rounded-3xl overflow-hidden">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 sticky top-0 z-10">
                <tr>
                  <th className="px-5 py-3 font-black text-right min-w-[220px]">الصلاحية / المورد</th>
                  <th className="px-4 py-3 font-black text-center min-w-[180px]">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {/* Visual */}
                {filteredVisual.length > 0 && (
                  <>
                    <tr className="bg-emerald-50/40 dark:bg-emerald-950/20">
                      <td className="px-5 py-2" colSpan={2}>
                        <span className="font-black text-emerald-600 dark:text-emerald-400 text-xs">الزينة والمظاهر</span>
                        <Badge variant="outline" className="text-[8px] mr-2 rounded-md border-emerald-200 text-emerald-600">استخدام</Badge>
                      </td>
                    </tr>
                    {filteredVisual.map(res => (
                      <tr key={res.key} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-5 py-2.5 font-bold text-slate-700 dark:text-slate-300 text-xs">
                          <div className="flex items-center gap-2 group/row">
                            <span>{res.label}</span>
                            {!isPermissionActionImplemented(res.key, "use") && (
                              <Badge variant="outline" className="rounded-md border-amber-300 text-[8px] text-amber-700">لم تطبق بعد</Badge>
                            )}
                            <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                              <button type="button" disabled={!isPermissionActionImplemented(res.key, "use")} onClick={() => handleToggleAllActions(activeRole.id, res.key, true)} className="p-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-600 transition-colors disabled:cursor-not-allowed disabled:opacity-40" title="تفعيل"><Check size={10} /></button>
                              <button type="button" disabled={!isPermissionActionImplemented(res.key, "use")} onClick={() => handleToggleAllActions(activeRole.id, res.key, false)} className="p-1 rounded bg-red-50 hover:bg-red-100 text-red-500 transition-colors disabled:cursor-not-allowed disabled:opacity-40" title="تعطيل"><X size={10} /></button>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Checkbox
                              checked={!!matrix[activeRole.id]?.[`${res.key}.use`]}
                              onCheckedChange={() => handleToggle(activeRole.id, `${res.key}.use`)}
                              className={`rounded-sm border-slate-300 w-5 h-5 ${ACTION_COLORS.use}`}
                              disabled={!isPermissionActionImplemented(res.key, "use")}
                              aria-label={`${res.label} - استخدام`}
                            />
                            <span className="text-[10px] font-bold text-emerald-500">استخدام</span>
                            {!isPermissionActionImplemented(res.key, "use") && (
                              <span className="text-[8px] font-bold text-amber-700">لم تطبق بعد</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                )}

                {/* Basic Groups */}
                {filteredGroups.map(group => (
                  <React.Fragment key={group.label}>
                    <tr className="bg-primary/5 dark:bg-primary/10">
                      <td className="px-5 py-2" colSpan={2}>
                        <span className="font-black text-primary text-xs">{group.label}</span>
                        <Badge variant="secondary" className="text-[8px] mr-2 rounded-md">{group.resources.length} موارد</Badge>
                      </td>
                    </tr>
                    {group.resources.map(res => (
                      <tr key={res.key} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors border-b border-slate-50 dark:border-slate-800">
                        <td className="px-5 py-2.5 font-bold text-slate-700 dark:text-slate-300 text-xs">
                          <div className="flex items-center gap-2 group/row">
                            <span>{res.label}</span>
                            {getActionsForResource(res.key).every(action => !isPermissionActionImplemented(res.key, action)) && (
                              <Badge variant="outline" className="rounded-md border-amber-300 text-[8px] text-amber-700">لم تطبق بعد</Badge>
                            )}
                            <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                              <button type="button" disabled={getActionsForResource(res.key).every(action => !isPermissionActionImplemented(res.key, action))} onClick={() => handleToggleAllActions(activeRole.id, res.key, true)} className="p-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-600 transition-colors disabled:cursor-not-allowed disabled:opacity-40" title="تفعيل"><Check size={10} /></button>
                              <button type="button" disabled={getActionsForResource(res.key).every(action => !isPermissionActionImplemented(res.key, action))} onClick={() => handleToggleAllActions(activeRole.id, res.key, false)} className="p-1 rounded bg-red-50 hover:bg-red-100 text-red-500 transition-colors disabled:cursor-not-allowed disabled:opacity-40" title="تعطيل"><X size={10} /></button>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {getActionsForResource(res.key).map(action => (
                              <div key={action} className="flex flex-col items-center gap-0.5">
                                <Checkbox
                                  checked={!!matrix[activeRole.id]?.[`${res.key}.${action}`]}
                                  onCheckedChange={() => handleToggle(activeRole.id, `${res.key}.${action}`)}
                                  className={`rounded-sm border-slate-300 w-5 h-5 ${ACTION_COLORS[action]}`}
                                  disabled={!isPermissionActionImplemented(res.key, action)}
                                  aria-label={`${res.label} - ${ACTION_LABELS[action]}${isPermissionActionImplemented(res.key, action) ? "" : " - لم تطبق بعد"}`}
                                />
                                <span className={`text-[8px] font-bold ${action === 'all' ? 'text-violet-500' : 'text-slate-400'}`}>{ACTION_SHORT[action]}</span>
                                {!isPermissionActionImplemented(res.key, action) && (
                                  <span className="max-w-12 text-center text-[7px] font-bold leading-tight text-amber-700">لم تطبق بعد</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  VIEW: CREATE ROLE
  // ══════════════════════════════════════════════════════════
  if (viewMode === 'create') {
    return (
      <div className="space-y-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setViewMode('list')} className="flex items-center gap-1 text-primary hover:underline font-bold">
            <ArrowRight size={14} className="rotate-180" /> الرتب
          </button>
          <ChevronRight size={14} className="text-slate-400 rotate-180" />
          <span className="font-bold text-slate-700 dark:text-slate-200">إضافة رتبة جديدة</span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-800 dark:text-slate-100">إضافة رتبة جديدة</h2>
            <p className="text-xs text-muted-foreground mt-0.5">أنشئ رتبة جديدة وحدد خصائصها</p>
          </div>
        </div>

        <Card className="border-2 border-primary/20 shadow-xl rounded-3xl bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {/* Name */}
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1.5 block">اسم الرتبة *</label>
                <Input value={newRole.name} onChange={e => setNewRole(p => ({ ...p, name: e.target.value }))} placeholder="مثال: VIP" className="rounded-2xl h-11" />
              </div>
              {/* Rank */}
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1.5 block">رقم الترقية</label>
                <Input type="number" value={newRole.rank} onChange={e => setNewRole(p => ({ ...p, rank: e.target.value }))} placeholder="100" className="rounded-2xl h-11" />
              </div>
              {/* Color */}
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1.5 block">اللون</label>
                <div className="flex items-center gap-2">
                  <Input type="color" value={newRole.color} onChange={e => setNewRole(p => ({ ...p, color: e.target.value }))} className="rounded-2xl h-11 p-1 w-16 cursor-pointer" />
                  <Input value={newRole.color} onChange={e => setNewRole(p => ({ ...p, color: e.target.value }))} placeholder="#6366f1" className="rounded-2xl h-11 flex-1 font-mono text-sm" />
                </div>
              </div>
              {/* Expires At */}
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1.5 block">تاريخ انتهاء الصلاحية (اختياري)</label>
                <Input type="date" value={newRole.expires_at} onChange={e => setNewRole(p => ({ ...p, expires_at: e.target.value }))} className="rounded-2xl h-11" />
              </div>
              {/* Icon */}
              <div className="relative">
                <label className="text-xs font-bold text-slate-500 mb-1.5 block">الأيقونة</label>
                <div className="flex gap-2 items-center">
                  {newRole.icon && (
                    <div className="w-11 h-11 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shrink-0 bg-white dark:bg-slate-800 flex items-center justify-center">
                      <img src={newRole.icon} alt="icon" className="w-8 h-8 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    </div>
                  )}
                  <div className="flex-1 flex gap-1">
                    <Button type="button" variant="outline" onClick={() => setShowIconPicker(true)} className="rounded-2xl h-11 gap-2 flex-1">
                      <Image size={16} /> {newRole.icon ? "تغيير" : "اختر أيقونة"}
                    </Button>
                    {newRole.icon && (
                      <Button type="button" variant="ghost" onClick={() => setNewRole(p => ({ ...p, icon: "" }))} className="rounded-2xl h-11 text-red-400 hover:text-red-600">
                        <Trash size={16} />
                      </Button>
                    )}
                  </div>
                </div>
                {/* Icon Picker Popup */}
                {showIconPicker && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowIconPicker(false)} />
                    <div className="absolute top-full right-0 mt-2 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-4 max-h-80 overflow-y-auto w-72 sm:w-96">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-bold text-sm text-slate-700 dark:text-slate-300">اختر أيقونة</h4>
                        <Button variant="ghost" size="sm" onClick={() => setShowIconPicker(false)} className="h-7 w-7 p-0 rounded-full"><X size={14} /></Button>
                      </div>
                      {loadingIcons ? (
                        <div className="py-8 text-center"><Loader2 className="animate-spin mx-auto w-6 h-6 text-primary" /></div>
                      ) : icons.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">لا توجد أيقونات.</p>
                      ) : (
                        <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
                          {icons.map(icon => (
                            <button key={icon.id} type="button"
                              onClick={() => { setNewRole(p => ({ ...p, icon: icon.image_url })); setShowIconPicker(false); }}
                              className={`flex items-center justify-center p-2 h-12 w-12 rounded-xl border-2 transition-all hover:border-primary hover:bg-primary/5 ${newRole.icon === icon.image_url ? 'border-primary bg-primary/10 ring-2 ring-primary/30' : 'border-transparent bg-slate-50 dark:bg-slate-800'}`}
                              title={icon.name || undefined}
                            >
                              <img src={icon.image_url} alt={icon.name || ''} className="max-w-full max-h-full object-contain" loading="lazy" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
              {/* Auto */}
              <div className="flex flex-col justify-center gap-3 pt-1">
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="create_auto" checked={newRole.auto_enabled} onChange={e => setNewRole(p => ({ ...p, auto_enabled: e.target.checked }))} className="w-4 h-4 rounded accent-primary" />
                  <label htmlFor="create_auto" className="text-sm font-bold text-slate-600 dark:text-slate-300 cursor-pointer">ترقية آلية</label>
                </div>
                {newRole.auto_enabled && (
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-1 block">نقاط الترقية</label>
                    <Input type="number" value={newRole.auto_points} onChange={e => setNewRole(p => ({ ...p, auto_points: e.target.value }))} placeholder="500" className="rounded-2xl h-10" />
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
              <Button variant="ghost" onClick={() => setViewMode('list')} className="rounded-2xl h-10">إلغاء</Button>
              <Button onClick={createRole} className="rounded-2xl h-10 font-bold gap-2 shadow-lg shadow-primary/20">
                <Check size={16} /> إنشاء الرتبة
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  VIEW: ROLES TABLE (default list view)
  // ══════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100">إدارة الرتب والصلاحيات</h2>
          <p className="text-sm text-muted-foreground font-medium mt-0.5">عرض وإدارة جميع رتب النظام وصلاحياتها</p>
        </div>
        {canManageRoles && <Button onClick={() => setViewMode('create')} className="rounded-2xl h-11 px-5 gap-2 font-black shadow-lg">
          <Plus size={18} /> إضافة رتبة جديدة
        </Button>}
      </div>

      {/* Table Card */}
      <Card className="border-none shadow-xl rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          {roles.length === 0 ? (
            <div className="py-20 text-center text-muted-foreground">
              <Shield size={48} className="mx-auto mb-4 opacity-20" />
              <p className="font-bold">لا توجد رتب</p>
              <p className="text-sm mt-1">قم بإضافة رتبة جديدة للبدء</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <tr>
                    <th className="px-5 py-3.5 font-black text-right">#</th>
                    <th className="px-4 py-3.5 font-black text-right">الرتبة</th>
                    <th className="px-4 py-3.5 font-black text-center">الترتيب</th>
                    <th className="px-4 py-3.5 font-black text-center">الأعضاء</th>
                    <th className="px-4 py-3.5 font-black text-center">النوع</th>
                    <th className="px-4 py-3.5 font-black text-center">تاريخ الإنشاء</th>
                    <th className="px-4 py-3.5 font-black text-center">الحالة</th>
                    <th className="px-4 py-3.5 font-black text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {roles.map((role, idx) => (
                    <tr key={role.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors group">
                      {/* Index */}
                      <td className="px-5 py-3 text-slate-400 font-mono text-xs">{idx + 1}</td>

                      {/* Role name + icon */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 overflow-hidden">
                            {role.ico ? (
                              <img src={role.ico} alt="" className="w-7 h-7 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            ) : (
                              <Crown size={16} className="text-slate-400" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="font-black text-sm" style={{ color: role.color || undefined }}>{role.name}</p>
                              {role.is_default && (
                                <Badge variant="secondary" className="rounded-lg text-[9px]">افتراضية للأعضاء</Badge>
                              )}
                              {role.is_owner && (
                                <Badge variant="outline" className="rounded-lg text-[9px] border-amber-400 text-amber-700">مالك الاستضافة - نظامية ثابتة</Badge>
                              )}
                              {role.is_site_owner && (
                                <Badge variant="outline" className="rounded-lg text-[9px] border-blue-400 text-blue-700">مالك الموقع - مجموعة نظامية ثابتة</Badge>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 font-mono">{role.id.slice(0, 8)}…</p>
                          </div>
                        </div>
                      </td>

                      {/* Rank */}
                      <td className="px-4 py-3 text-center">
                        <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-1">
                          <Hash size={11} className="text-slate-400" />
                          <span className="font-black text-xs text-slate-700 dark:text-slate-200">{role.rank}</span>
                        </div>
                      </td>

                      {/* Members */}
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => fetchMembers(role)}
                          className="inline-flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-xl px-3 py-1 transition-colors font-bold text-xs"
                          title="عرض الأعضاء"
                        >
                          <Users size={12} />
                          {role.member_count ?? 0}
                        </button>
                      </td>

                      {/* Type */}
                      <td className="px-4 py-3 text-center">
                        {role.auto_enabled ? (
                          <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 rounded-xl text-[10px] gap-1">
                            <Star size={9} /> ترقية آلية
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="rounded-xl text-[10px]">يدوي</Badge>
                        )}
                      </td>

                      {/* Created At */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">{formatDate(role.created_at)}</span>
                        </div>
                      </td>

                      {/* Status Toggle */}
                      <td className="px-4 py-3 text-center">
                        {canManageRoles ? <button
                          onClick={() => toggleRoleActive(role)}
                          disabled={togglingId === role.id || role.is_default || isProtectedRole(role)}
                          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                            role.is_active
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200'
                          }`}
                          title={isProtectedRole(role) ? "المجموعة النظامية ثابتة ولا يمكن تعديلها" : role.is_default ? "لا يمكن تعطيل رتبة الأعضاء الافتراضية" : role.is_active ? "انقر لتعطيل" : "انقر لتفعيل"}
                        >
                          {togglingId === role.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : role.is_active ? (
                            <ToggleRight size={14} />
                          ) : (
                            <ToggleLeft size={14} />
                          )}
                          {role.is_active ? "فعّال" : "معطّل"}
                        </button> : (
                          <span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold ${
                            role.is_active
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                          }`}>
                            {role.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                            {role.is_active ? "فعّال" : "معطّل"}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {canManageRoles && !isProtectedRole(role) && <button
                            onClick={() => {
                              setActiveRole(role);
                              // إذا لم تكن البيانات موجودة في المصفوفة نُهيّئها من الرتبة
                              // (تجنب الكتابة الفوقية على التغييرات الحالية)
                              if (!matrix[role.id]) {
                                setMatrix(prev => ({ ...prev, [role.id]: normalizePerms(role.permissions || {}) }));
                              }
                              setViewMode('edit');
                              setSearch("");
                            }}
                            className="w-8 h-8 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center transition-all"
                            title="تعديل الصلاحيات"
                          >
                            <Edit3 size={14} />
                          </button>}
                          {canManageRoles && !role.is_default && !isProtectedRole(role) && (
                            <button
                              onClick={() => deleteRole(role.id, role.name)}
                              className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-500 flex items-center justify-center transition-all"
                              title="حذف الرتبة"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Members Modal */}
      {membersModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setMembersModal(p => ({ ...p, open: false }))}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg max-h-[75vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                {membersModal.role?.ico && (
                  <img src={membersModal.role.ico} alt="" className="w-8 h-8 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                )}
                <div>
                  <h3 className="font-black text-slate-800 dark:text-slate-100">
                    أعضاء رتبة: <span style={{ color: membersModal.role?.color }}>{membersModal.role?.name}</span>
                  </h3>
                  <p className="text-xs text-muted-foreground">{membersModal.members.length} عضو</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setMembersModal(p => ({ ...p, open: false }))} className="rounded-xl">
                <X size={18} />
              </Button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4">
              {membersModal.loading ? (
                <div className="py-12 text-center"><Loader2 className="animate-spin mx-auto w-7 h-7 text-primary" /></div>
              ) : membersModal.members.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <Users size={40} className="mx-auto mb-3 opacity-20" />
                  <p className="font-bold">لا يوجد أعضاء في هذه الرتبة</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {membersModal.members.map(m => (
                    <div key={m.id} className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                      <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0 overflow-hidden flex items-center justify-center">
                        {m.avatar_url ? (
                          <img src={m.avatar_url} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        ) : (
                          <span className="text-base font-black text-slate-400">{(m.display_name || m.username || "?")[0].toUpperCase()}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">{m.display_name || m.username}</p>
                        <p className="text-[11px] text-slate-400 truncate">@{m.username}</p>
                      </div>
                      <div className="text-left shrink-0">
                        <div className="flex items-center gap-1 text-[10px] text-slate-400">
                          <Calendar size={9} />
                          {formatDate(m.assigned_at)}
                        </div>
                        {m.expires_at && (
                          <div className="flex items-center gap-1 text-[10px] text-amber-500 mt-0.5">
                            <Calendar size={9} />
                            ينتهي: {formatDate(m.expires_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PermissionsMatrix;
