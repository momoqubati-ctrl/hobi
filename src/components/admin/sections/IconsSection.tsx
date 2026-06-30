"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Upload, X, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface IconItem {
  id: string;
  name: string;
  image_url: string;
  sort_order: number;
  is_active: boolean;
}

const IconsSection = () => {
  const [icons, setIcons] = useState<IconItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const authHeaders = useCallback(() => {
    const t = localStorage.getItem("authToken") || "";
    return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
  }, []);

  const fetchIcons = async () => {
    try {
      const res = await fetch("/api/admin/icons", { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setIcons(data.icons);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    fetchIcons().finally(() => setLoading(false));
  }, []);

  const handleUploadIcons = async (files: FileList) => {
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
        const iconRes = await fetch("/api/admin/icons", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            name: file.name.replace(/\.[^.]+$/, ""),
            image_url: uploadData.url,
          }),
        });
        const iconData = await iconRes.json();
        if (iconData.success) {
          uploaded++;
        } else {
          toast.error(`${file.name}: ${iconData.message || "فشل حفظ الايقونة"}`);
        }
      }
      fetchIcons();
      if (uploaded > 0) toast.success(`تم رفع ${uploaded} ايقونة${uploaded > 1 ? "ات" : ""} بنجاح`);
    } catch (e) {
      console.error(e);
      toast.error("حدث خطأ في رفع الايقونات");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteIcon = async (id: string) => {
    if (!confirm("هل تريد حذف هذه الايقونة؟")) return;
    try {
      const res = await fetch(`/api/admin/icons/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setIcons((prev) => prev.filter((i) => i.id !== id));
        toast.success("تم حذف الايقونة");
      } else {
        toast.error(data.message || "فشل حذف الايقونة");
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
        <h2 className="text-lg font-bold">إدارة الايقونات</h2>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleUploadIcons(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-bold hover:bg-green-600 transition disabled:opacity-50"
          >
            <Upload size={16} />
            {uploading ? "جاري الرفع..." : "رفع ايقونات"}
          </button>
        </div>
      </div>

      {icons.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-base font-medium">لا يوجد ايقونات بعد</p>
          <p className="text-sm mt-1">اضغط "رفع ايقونات" لإضافة صور الايقونات</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-3">
          {icons.map((icon) => (
            <div
              key={icon.id}
              className="group relative rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-center p-3 h-20 shadow-sm hover:shadow-md transition-all"
            >
              <img
                src={icon.image_url}
                alt={icon.name}
                className="max-w-full max-h-full object-contain"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                <button
                  onClick={() => handleDeleteIcon(icon.id)}
                  className="p-1.5 rounded-full bg-red-500/90 hover:bg-red-600 text-white transition shadow-lg"
                  title="حذف"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default IconsSection;
