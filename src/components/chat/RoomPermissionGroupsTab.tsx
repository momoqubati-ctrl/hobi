"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { showError, showSuccess } from "@/utils/toast";

const PERMISSION_FIELDS = [
  { key: "canKick", label: "طرد الأعضاء الأقل رتبة" },
  { key: "canMute", label: "إسكات عضو داخل الغرفة" },
  { key: "canManageMics", label: "إدارة مقاعد المايك" },
  { key: "canPin", label: "تثبيت الرسائل" },
  { key: "canClearMessages", label: "مسح رسائل الغرفة" },
  { key: "canBan", label: "حظر مؤقت من الغرفة" },
] as const;

type PermissionKey = (typeof PERMISSION_FIELDS)[number]["key"];
type RolePermissions = Record<PermissionKey, boolean>;

interface RoomCustomRole {
  id: string;
  name: string;
  color: string;
  powerLevel: number;
  permissions: RolePermissions;
}

interface RoomRoleMember {
  id: string;
  username: string;
}

interface RoomPermissionGroupsTabProps {
  roomId: string;
  members: RoomRoleMember[];
  getAuthHeaders: () => Record<string, string>;
}

const EMPTY_PERMISSIONS: RolePermissions = {
  canKick: false,
  canMute: false,
  canManageMics: false,
  canPin: false,
  canClearMessages: false,
  canBan: false,
};

const responseMessage = (data: unknown, fallback: string) =>
  typeof data === "object" && data !== null && "message" in data && typeof data.message === "string"
    ? data.message
    : fallback;

export function RoomPermissionGroupsTab({
  roomId,
  members,
  getAuthHeaders,
}: RoomPermissionGroupsTabProps) {
  const [roles, setRoles] = useState<RoomCustomRole[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#64748b");
  const [powerLevel, setPowerLevel] = useState("1000");
  const [permissions, setPermissions] = useState<RolePermissions>(EMPTY_PERMISSIONS);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [error, setError] = useState("");

  const loadRoles = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/roles`, {
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.roles) || !Array.isArray(data.assignments)) {
        throw new Error(responseMessage(data, "تعذر تحميل مجموعات الصلاحيات"));
      }
      setRoles(data.roles);
      setAssignments(Object.fromEntries(
        data.assignments.map((assignment: { userId: string; customRoleId: string }) => [
          assignment.userId,
          assignment.customRoleId,
        ]),
      ));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "تعذر تحميل مجموعات الصلاحيات";
      setError(message);
      showError(message);
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders, roomId]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  const createRole = async () => {
    setIsCreating(true);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/roles`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name,
          color,
          powerLevel: Number(powerLevel),
          permissions,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(responseMessage(data, "تعذر إنشاء مجموعة الصلاحيات"));
      }
      setName("");
      setColor("#64748b");
      setPowerLevel("1000");
      setPermissions(EMPTY_PERMISSIONS);
      showSuccess("تم إنشاء مجموعة الصلاحيات");
      await loadRoles();
    } catch (createError) {
      showError(createError instanceof Error ? createError.message : "تعذر إنشاء مجموعة الصلاحيات");
    } finally {
      setIsCreating(false);
    }
  };

  const updateRoleDraft = (roleId: string, update: Partial<RoomCustomRole>) => {
    setRoles((current) => current.map((role) => role.id === roleId ? { ...role, ...update } : role));
  };

  const saveRole = async (role: RoomCustomRole) => {
    setSavingRoleId(role.id);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/roles/${role.id}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: role.name,
          color: role.color,
          powerLevel: Number(role.powerLevel),
          permissions: role.permissions,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(responseMessage(data, "تعذر حفظ المجموعة"));
      }
      showSuccess("تم حفظ مجموعة الصلاحيات");
      await loadRoles();
    } catch (saveError) {
      showError(saveError instanceof Error ? saveError.message : "تعذر حفظ المجموعة");
      await loadRoles();
    } finally {
      setSavingRoleId(null);
    }
  };

  const deleteRole = async (roleId: string) => {
    if (!window.confirm("سيؤدي حذف المجموعة إلى إزالة إسنادها من الأعضاء. هل تريد المتابعة؟")) return;
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/roles/${roleId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(responseMessage(data, "تعذر حذف المجموعة"));
      }
      showSuccess("تم حذف المجموعة وإزالة إسنادها من الأعضاء");
      await loadRoles();
    } catch (deleteError) {
      showError(deleteError instanceof Error ? deleteError.message : "تعذر حذف المجموعة");
    }
  };

  const saveMemberAssignment = async () => {
    if (!selectedMemberId) {
      showError("اختر عضواً أولاً");
      return;
    }
    setSavingAssignment(true);
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(selectedMemberId)}/role`,
        {
          method: "PATCH",
          headers: getAuthHeaders(),
          body: JSON.stringify({ customRoleId: selectedRoleId || null }),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(responseMessage(data, "تعذر إسناد المجموعة"));
      }
      showSuccess("تم تحديث مجموعة العضو");
      await loadRoles();
    } catch (assignmentError) {
      showError(assignmentError instanceof Error ? assignmentError.message : "تعذر إسناد المجموعة");
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleMemberChange = (memberId: string) => {
    setSelectedMemberId(memberId);
    setSelectedRoleId(assignments[memberId] || "");
  };

  return (
    <div className="mt-5 space-y-5">
      <section className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
        <div>
          <h3 className="text-sm font-black text-foreground">إنشاء مجموعة جديدة</h3>
          <p className="mt-1 text-xs text-muted-foreground">الصلاحيات معطلة افتراضياً؛ اختر ما تحتاجه فقط.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_5rem_7rem]">
          <div className="space-y-1.5">
            <Label htmlFor="room-role-name">اسم المجموعة</Label>
            <Input
              id="room-role-name"
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="مثال: مشرف المحتوى"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="room-role-color">اللون</Label>
            <Input
              id="room-role-color"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-10 p-1"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="room-role-power">القوة</Label>
            <Input
              id="room-role-power"
              type="number"
              min={1}
              max={99999}
              value={powerLevel}
              onChange={(event) => setPowerLevel(event.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          {PERMISSION_FIELDS.map(({ key, label }) => (
            <label key={key} className="flex min-h-11 items-center justify-between gap-3 border-b border-border/40 py-2 text-sm">
              <span>{label}</span>
              <Switch
                checked={permissions[key]}
                onCheckedChange={(checked) => setPermissions((current) => ({ ...current, [key]: checked }))}
                aria-label={label}
              />
            </label>
          ))}
        </div>
        <Button type="button" onClick={createRole} disabled={isCreating || !name.trim()}>
          {isCreating ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
          إنشاء المجموعة
        </Button>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-black text-foreground">المجموعات الحالية</h3>
          <p className="mt-1 text-xs text-muted-foreground">القوة الأعلى تحدد الترتيب في قوائم الغرفة.</p>
        </div>
        {isLoading ? (
          <div role="status" aria-busy="true" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" size={16} /> جارٍ تحميل المجموعات...
          </div>
        ) : error ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
            <span>{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadRoles()}>إعادة المحاولة</Button>
          </div>
        ) : roles.length === 0 ? (
          <p role="status" className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            لم تُنشأ مجموعات لهذه الغرفة بعد.
          </p>
        ) : (
          <div className="space-y-3">
            {roles.map((role) => (
              <article key={role.id} className="space-y-3 rounded-xl border border-border/60 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_5rem_7rem]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`role-name-${role.id}`}>اسم المجموعة</Label>
                    <Input
                      id={`role-name-${role.id}`}
                      maxLength={64}
                      value={role.name}
                      onChange={(event) => updateRoleDraft(role.id, { name: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`role-color-${role.id}`}>اللون</Label>
                    <Input
                      id={`role-color-${role.id}`}
                      type="color"
                      value={role.color}
                      onChange={(event) => updateRoleDraft(role.id, { color: event.target.value })}
                      className="h-10 p-1"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`role-power-${role.id}`}>القوة</Label>
                    <Input
                      id={`role-power-${role.id}`}
                      type="number"
                      min={1}
                      max={99999}
                      value={role.powerLevel}
                      onChange={(event) => updateRoleDraft(role.id, { powerLevel: Number(event.target.value) })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                  {PERMISSION_FIELDS.map(({ key, label }) => (
                    <label key={key} className="flex min-h-11 items-center justify-between gap-3 border-b border-border/40 py-2 text-sm">
                      <span>{label}</span>
                      <Switch
                        checked={role.permissions[key]}
                        onCheckedChange={(checked) => updateRoleDraft(role.id, {
                          permissions: { ...role.permissions, [key]: checked },
                        })}
                        aria-label={`${label} — ${role.name}`}
                      />
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => void deleteRole(role.id)}>
                    <Trash2 size={15} /> حذف
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void saveRole(role)}
                    disabled={savingRoleId !== null || !role.name.trim() || !Number.isInteger(role.powerLevel) || role.powerLevel < 1 || role.powerLevel > 99999}
                  >
                    {savingRoleId === role.id ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
                    حفظ
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
        <div>
          <h3 className="text-sm font-black text-foreground">إسناد مجموعة لعضو</h3>
          <p className="mt-1 text-xs text-muted-foreground">يمكن إزالة المجموعة بإختيار «بدون مجموعة».</p>
        </div>
        {members.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">لا يوجد أعضاء متصلون في الغرفة حالياً.</p>
        ) : (
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="room-role-member">العضو</Label>
              <select
                id="room-role-member"
                value={selectedMemberId}
                onChange={(event) => handleMemberChange(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">اختر عضواً</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>{member.username}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="room-role-assignment">المجموعة</Label>
              <select
                id="room-role-assignment"
                value={selectedRoleId}
                onChange={(event) => setSelectedRoleId(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">بدون مجموعة</option>
                {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </div>
            <Button
              type="button"
              onClick={() => void saveMemberAssignment()}
              disabled={savingAssignment || !selectedMemberId || isLoading}
            >
              {savingAssignment ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
              إسناد
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
