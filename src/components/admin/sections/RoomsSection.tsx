"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import AdminDataTable from '../shared/AdminDataTable';
import { getAdminHeaders } from '../utils';
import { showSuccess, showError } from '@/utils/toast';
import { Plus, Pencil, Trash2, Search, Loader2 } from 'lucide-react';

interface RoomForm {
  name: string;
  slug: string;
  description: string;
  maxMembers: string;
  micSlots: string;
  isPublic: boolean;
  password: string;
  avatarUrl: string;
  ownerUsername: string;
  likesRequired: string;
  roomColor: string;
  isPinned: boolean;
  welcomeMessage: string;
  localSendMode: string;
}

const emptyForm: RoomForm = {
  name: "",
  slug: "",
  description: "",
  maxMembers: "50",
  micSlots: "5",
  isPublic: true,
  password: "",
  avatarUrl: "",
  ownerUsername: "",
  likesRequired: "0",
  roomColor: "#000000",
  isPinned: false,
  welcomeMessage: "",
  localSendMode: "real",
};

interface Room {
  id: string;
  slug: string;
  name: string;
  description: string;
  isPublic: boolean;
  maxMembers: number;
  micSlots: number;
  avatarUrl: string;
  owner: string;
  ownerName: string;
  color: string;
  welcome: string;
  broadcast: number;
  stageCount: number;
  messageMode: string;
}

const RoomDialog = ({
  isOpen, onClose, onSuccess, editRoom,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editRoom?: Room | null;
}) => {
  const [form, setForm] = useState<RoomForm>(emptyForm);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (editRoom) {
      setForm({
        name: editRoom.name || "",
        slug: editRoom.slug || "",
        description: editRoom.description || "",
        maxMembers: String(editRoom.maxMembers || 50),
        micSlots: String(editRoom.micSlots || 5),
        isPublic: editRoom.isPublic,
        password: "",
        avatarUrl: editRoom.avatarUrl || "",
        ownerUsername: editRoom.ownerName || "",
        likesRequired: "0",
        roomColor: editRoom.color || "#000000",
        isPinned: !!editRoom.broadcast,
        welcomeMessage: editRoom.welcome || "",
        localSendMode: editRoom.messageMode || "real",
      });
    } else {
      setForm(emptyForm);
    }
  }, [editRoom, isOpen]);

  const handleChange = (key: keyof RoomForm, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    setLoading(true);
    try {
      const method = editRoom ? 'PUT' : 'POST';
      const url = editRoom
        ? `/api/admin/rooms/${editRoom.id}`
        : '/api/admin/rooms';

      const res = await fetch(url, {
        method,
        headers: getAdminHeaders(),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(data.message);
        setForm(emptyForm);
        onSuccess();
        onClose();
      } else {
        showError(data.message);
      }
    } catch {
      showError("حدث خطأ أثناء حفظ الغرفة");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border-none shadow-2xl rtl">
        <DialogHeader>
          <DialogTitle className="text-xl font-black text-slate-800">
            {editRoom ? 'تعديل الغرفة' : 'إضافة غرفة جديدة'}
          </DialogTitle>
          <DialogDescription className="sr-only">نموذج إدارة الغرفة</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="font-bold text-slate-500 mr-1">اسم الغرفة *</Label>
              <Input
                placeholder="اسم الغرفة"
                className="h-11 rounded-2xl bg-slate-50 border-none font-bold"
                value={form.name}
                onChange={(e) => handleChange('name', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-slate-500 mr-1">الرابط (slug) *</Label>
              <Input
                placeholder="room-slug"
                className="h-11 rounded-2xl bg-slate-50 border-none font-bold"
                value={form.slug}
                onChange={(e) => handleChange('slug', e.target.value)}
                required={!editRoom}
                dir="ltr"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-slate-500 mr-1">الوصف</Label>
            <Textarea
              placeholder="وصف الغرفة..."
              className="rounded-2xl bg-slate-50 border-none font-bold resize-none"
              value={form.description}
              onChange={(e) => handleChange('description', e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="font-bold text-slate-500 mr-1">السعة القصوى</Label>
              <Input
                type="number"
                placeholder="50"
                className="h-11 rounded-2xl bg-slate-50 border-none font-bold"
                value={form.maxMembers}
                onChange={(e) => handleChange('maxMembers', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-slate-500 mr-1">عدد المايكات</Label>
              <Input
                type="number"
                placeholder="5"
                className="h-11 rounded-2xl bg-slate-50 border-none font-bold"
                value={form.micSlots}
                onChange={(e) => handleChange('micSlots', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-slate-500 mr-1">الإعجابات المطلوبة</Label>
              <Input
                type="number"
                placeholder="0"
                className="h-11 rounded-2xl bg-slate-50 border-none font-bold"
                value={form.likesRequired}
                onChange={(e) => handleChange('likesRequired', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="font-bold text-slate-500 mr-1">صورة الغرفة (رابط)</Label>
              <Input
                placeholder="https://..."
                className="h-11 rounded-2xl bg-slate-50 border-none font-bold"
                value={form.avatarUrl}
                onChange={(e) => handleChange('avatarUrl', e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-slate-500 mr-1">لون الغرفة</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-11 w-14 rounded-2xl border-none bg-slate-50 cursor-pointer"
                  value={form.roomColor}
                  onChange={(e) => handleChange('roomColor', e.target.value)}
                />
                <Input
                  placeholder="#000000"
                  className="h-11 rounded-2xl bg-slate-50 border-none font-bold"
                  value={form.roomColor}
                  onChange={(e) => handleChange('roomColor', e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-slate-500 mr-1">اسم مالك الغرفة</Label>
            <Input
              placeholder="system"
              className="h-11 rounded-2xl bg-slate-50 border-none font-bold"
              value={form.ownerUsername}
              onChange={(e) => handleChange('ownerUsername', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-slate-500 mr-1">رسالة الترحيب</Label>
            <Textarea
              placeholder="رسالة الترحيب بالغرفة..."
              className="rounded-2xl bg-slate-50 border-none font-bold resize-none"
              value={form.welcomeMessage}
              onChange={(e) => handleChange('welcomeMessage', e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-slate-500 mr-1">نوع الإرسال</Label>
            <Select value={form.localSendMode} onValueChange={(v) => handleChange('localSendMode', v)}>
              <SelectTrigger className="h-11 rounded-2xl bg-slate-50 border-none font-bold">
                <SelectValue placeholder="اختر نوع الإرسال" />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-slate-100">
                <SelectItem value="real" className="font-bold">واقعي (Real)</SelectItem>
                <SelectItem value="fake" className="font-bold">وهمي (Fake)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="font-bold text-slate-500 mr-1">كلمة المرور</Label>
            <Input
              type="password"
              placeholder="اترك فارغاً إن كانت عامة"
              className="h-11 rounded-2xl bg-slate-50 border-none font-bold"
              value={form.password}
              onChange={(e) => handleChange('password', e.target.value)}
              dir="ltr"
            />
          </div>

          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-3">
              <Switch
                checked={form.isPublic}
                onCheckedChange={(v) => handleChange('isPublic', v)}
              />
              <Label className="font-bold text-slate-500">عامة</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.isPinned}
                onCheckedChange={(v) => handleChange('isPinned', v)}
              />
              <Label className="font-bold text-slate-500">مثبتة (بث عام)</Label>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="flex-1 h-12 rounded-2xl font-black text-slate-400"
            >
              إلغاء
            </Button>
            <Button
              type="submit"
              disabled={loading || !form.name.trim()}
              className="flex-1 h-12 rounded-2xl font-black shadow-lg shadow-primary/20"
            >
              {loading ? <Loader2 className="animate-spin" /> : editRoom ? 'تحديث الغرفة' : 'إضافة الغرفة'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const RoomsSection = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Room | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchRooms = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/rooms?search=${search}`, { headers: getAdminHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setRooms(data.rooms);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [search]);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/rooms/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: getAdminHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(data.message);
        setDeleteTarget(null);
        fetchRooms();
      } else {
        showError(data.message);
      }
    } catch {
      showError("حدث خطأ أثناء حذف الغرفة");
    } finally {
      setDeleting(false);
    }
  };

  const openCreate = () => {
    setEditingRoom(null);
    setDialogOpen(true);
  };

  const openEdit = (room: Room) => {
    setEditingRoom(room);
    setDialogOpen(true);
  };

  const columns = [
    {
      key: "name",
      label: "الغرفة",
      render: (_: any, r: Room) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl overflow-hidden border border-slate-100 shrink-0">
            <img src={r.avatarUrl || '/room.png'} className="w-full h-full object-cover" alt="" />
          </div>
          <div>
            <div className="font-black text-slate-800 dark:text-white">{r.name}</div>
            <div className="text-[10px] font-bold text-slate-400" dir="ltr">/{r.slug}</div>
          </div>
        </div>
      ),
    },
    {
      key: "ownerName",
      label: "المالك",
      render: (val: any) => (
        <span className="font-bold text-primary text-sm">{val || 'الإدارة'}</span>
      ),
    },
    {
      key: "maxMembers",
      label: "السعة",
      render: (val: any) => (
        <span className="font-black text-slate-500">{val ?? '-'}</span>
      ),
    },
    {
      key: "micSlots",
      label: "المايكات",
      render: (val: any) => (
        <span className="font-black text-slate-500">{val ?? '-'}</span>
      ),
    },
    {
      key: "isPublic",
      label: "الحالة",
      render: (val: boolean) => (
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-black ${
          val ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
        }`}>
          {val ? 'عامة' : 'خاصة'}
        </span>
      ),
    },
    {
      key: "actions",
      label: "إجراءات",
      render: (_: any, r: Room) => (
        <div className="flex items-center justify-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl text-blue-500 hover:bg-blue-50"
            onClick={() => openEdit(r)}
          >
            <Pencil size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl text-red-500 hover:bg-red-50"
            onClick={() => setDeleteTarget(r)}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card className="border-none shadow-xl rounded-3xl overflow-hidden">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800 p-6 bg-white dark:bg-slate-900">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <CardTitle className="text-xl font-black">إدارة الغرف</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="بحث بالاسم أو المعرف..."
                  className="w-full md:w-64 h-11 pr-10 rounded-2xl bg-slate-50 border-none focus:ring-2 focus:ring-primary/20 font-bold"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchRooms()}
                />
              </div>
              <Button onClick={fetchRooms} className="h-11 px-4 rounded-2xl font-bold">
                <Search size={16} className="ml-1" />
                بحث
              </Button>
              <Button onClick={openCreate} className="h-11 px-5 rounded-2xl font-black shadow-lg shadow-primary/20">
                <Plus size={18} className="ml-1" />
                إضافة غرفة
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <AdminDataTable columns={columns} rows={rooms} loading={loading} />
        </CardContent>
      </Card>

      <RoomDialog
        isOpen={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingRoom(null); }}
        onSuccess={fetchRooms}
        editRoom={editingRoom}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="rounded-3xl border-none shadow-2xl rtl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-black text-slate-800">حذف الغرفة</AlertDialogTitle>
            <AlertDialogDescription className="font-bold text-slate-500">
              هل أنت متأكد من حذف الغرفة "{deleteTarget?.name}"؟ هذا الإجراء لا يمكن التراجع عنه.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-2xl font-bold">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-2xl font-bold bg-red-500 hover:bg-red-600 text-white"
            >
              {deleting ? <Loader2 className="animate-spin h-4 w-4" /> : 'نعم، احذف الغرفة'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default RoomsSection;
