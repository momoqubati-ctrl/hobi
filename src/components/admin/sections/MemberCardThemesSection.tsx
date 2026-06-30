"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Upload, X, Image, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface MemberCardTheme {
  id: string;
  name: string;
  image_url: string;
  link: string;
  sort_order: number;
  is_active: boolean;
}

const MemberCardThemesSection = () => {
  const [themes, setThemes] = useState<MemberCardTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const authHeaders = useCallback(() => {
    const t = localStorage.getItem("authToken") || "";
    return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
  }, []);

  const fetchThemes = async () => {
    try {
      const res = await fetch("/api/admin/member-card-themes", { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setThemes(data.banners);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    fetchThemes().finally(() => setLoading(false));
  }, []);

  const handleUploadThemes = async (files: FileList) => {
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
        const themeRes = await fetch("/api/admin/member-card-themes", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            name: file.name.replace(/\.[^.]+$/, ""),
            image_url: uploadData.url,
          }),
        });
        const themeData = await themeRes.json();
        if (themeData.success) {
          uploaded++;
        } else {
          toast.error(`${file.name}: ${themeData.message || "فشل حفظ الثيم"}`);
        }
      }
      fetchThemes();
      if (uploaded > 0) toast.success(`تم رفع ${uploaded} ثيم${uploaded > 1 ? "ات" : ""} بنجاح`);
    } catch (e) {
      console.error(e);
      toast.error("حدث خطأ في رفع الثيمات");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteTheme = async (id: string) => {
    if (!confirm("هل تريد حذف هذا الثيم؟")) return;
    try {
      const res = await fetch(`/api/admin/member-card-themes/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setThemes((prev) => prev.filter((b) => b.id !== id));
        toast.success("تم حذف الثيم");
      } else {
        toast.error(data.message || "فشل حذف الثيم");
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
        <h2 className="text-lg font-bold">إدارة ثيم بطاقة العضو</h2>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleUploadThemes(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-bold hover:bg-green-600 transition disabled:opacity-50"
          >
            <Upload size={16} />
            {uploading ? "جاري الرفع..." : "رفع ثيمات"}
          </button>
        </div>
      </div>

      {themes.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Image size={56} className="mx-auto mb-4 opacity-50" />
          <p className="text-base font-medium">لا يوجد ثيمات بعد</p>
          <p className="text-sm mt-1">اضغط "رفع ثيمات" لإضافة صور الثيمات</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
          {themes.map((theme) => (
            <div
              key={theme.id}
              className="group relative rounded-lg overflow-hidden border border-border bg-muted"
            >
              <img
                src={theme.image_url}
                alt={theme.name}
                className="w-full h-auto"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                <button
                  onClick={() => handleDeleteTheme(theme.id)}
                  className="p-1.5 rounded-full bg-red-500/90 hover:bg-red-600 text-white transition"
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

export default MemberCardThemesSection;
