"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Upload, X, Image, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { canManageAdminSection } from "../powers/permissionDefs";

interface ProfileFrame {
  id: string;
  name: string;
  image_url: string;
  link: string;
  sort_order: number;
  is_active: boolean;
}

interface ProfileFramesSectionProps {
  permissions: string[];
}

const ProfileFramesSection = ({ permissions }: ProfileFramesSectionProps) => {
  const canEdit = canManageAdminSection(permissions, "profileframes", "edit");
  const canDelete = canManageAdminSection(permissions, "profileframes", "delete");
  const [frames, setFrames] = useState<ProfileFrame[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const authHeaders = useCallback(() => {
    const t = localStorage.getItem("authToken") || "";
    return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
  }, []);

  const fetchFrames = async () => {
    try {
      const res = await fetch("/api/admin/profile-frames", { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setFrames(data.banners);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    fetchFrames().finally(() => setLoading(false));
  }, []);

  const handleUploadFrames = async (files: FileList) => {
    if (files.length === 0) return;
    setUploading(true);
    let uploaded = 0;
    try {
      const t = localStorage.getItem("authToken") || "";
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = () => reject(new Error("فشل قراءة الملف"));
          reader.readAsDataURL(file);
        });
        const uploadRes = await fetch("/api/wall/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
          body: JSON.stringify({ file: base64, filename: file.name, contentType: file.type }),
        });
        const uploadData = await uploadRes.json();
        if (!uploadData.success) {
          toast.error(`${file.name}: ${uploadData.message || "فشل رفع الملف"}`);
          continue;
        }
        const frameRes = await fetch("/api/admin/profile-frames", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            name: file.name.replace(/\.[^.]+$/, ""),
            image_url: uploadData.url,
          }),
        });
        const frameData = await frameRes.json();
        if (frameData.success) {
          uploaded++;
        } else {
          toast.error(`${file.name}: ${frameData.message || "فشل حفظ الإطار"}`);
        }
      }
      fetchFrames();
      if (uploaded > 0) toast.success(`تم رفع ${uploaded} إطار${uploaded > 1 ? "ات" : ""} بنجاح`);
    } catch (e) {
      console.error(e);
      toast.error("حدث خطأ في رفع الاطارات");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteFrame = async (id: string) => {
    if (!confirm("هل تريد حذف هذا الإطار؟")) return;
    try {
      const res = await fetch(`/api/admin/profile-frames/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setFrames((prev) => prev.filter((b) => b.id !== id));
        toast.success("تم حذف الإطار");
      } else {
        toast.error(data.message || "فشل حذف الإطار");
      }
    } catch (e) {
      console.error(e);
      toast.error("حدث خطأ في الاتصال");
    }
  };

  if (loading) {
    return <div className="p-6 text-center text-muted-foreground">جاري التحميل...</div>;
  }

  return (
    <div className="p-4 space-y-4 rtl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">إدارة اطارات صورة البروفايل</h2>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleUploadFrames(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !canEdit}
            title={!canEdit ? "لا تملك صلاحية تعديل الإطارات" : undefined}
            className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-bold hover:bg-green-600 transition disabled:opacity-50"
          >
            <Upload size={16} />
            {uploading ? "جاري الرفع..." : "رفع اطارات"}
          </button>
        </div>
      </div>

      {frames.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Image size={56} className="mx-auto mb-4 opacity-50" />
          <p className="text-base font-medium">لا يوجد اطارات بعد</p>
          <p className="text-sm mt-1">اضغط "رفع اطارات" لإضافة صور الاطارات</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
          {frames.map((frame) => (
            <div
              key={frame.id}
              className="group relative rounded-lg overflow-hidden border border-border bg-muted"
            >
              <img
                src={frame.image_url}
                alt={frame.name}
                className="w-full h-auto"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                {canDelete && (
                  <button
                    onClick={() => handleDeleteFrame(frame.id)}
                    className="p-1.5 rounded-full bg-red-500/90 hover:bg-red-600 text-white transition"
                    title="حذف"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProfileFramesSection;
