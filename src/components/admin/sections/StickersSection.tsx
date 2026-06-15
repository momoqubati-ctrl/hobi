"use client";

import React, { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Upload, Save, X, Image, FolderOpen } from "lucide-react";

interface StickerCategory {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
  sticker_count: number;
}

interface StickerItem {
  id: string;
  category_id: string;
  name: string;
  image_url: string;
  sort_order: number;
  category_name: string;
}

const StickersSection = () => {
  const [categories, setCategories] = useState<StickerCategory[]>([]);
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("");
  const [showNewCat, setShowNewCat] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingCatIcon, setUploadingCatIcon] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const catIconInputRef = useRef<HTMLInputElement>(null);
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : "";

  const authHeaders = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  const fetchCategories = async () => {
    try {
      const res = await fetch("/api/admin/sticker-categories", { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setCategories(data.categories);
    } catch (e) { console.error(e); }
  };

  const fetchStickers = async (categoryId?: string) => {
    try {
      const url = categoryId ? `/api/admin/stickers?category_id=${categoryId}` : "/api/admin/stickers";
      const res = await fetch(url, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setStickers(data.stickers);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    Promise.all([fetchCategories(), fetchStickers()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchStickers(selectedCategoryId || undefined);
  }, [selectedCategoryId]);

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    try {
      const res = await fetch("/api/admin/sticker-categories", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: newCatName.trim(), icon: newCatIcon || "/pic.png" }),
      });
      const data = await res.json();
      if (data.success) {
        setCategories((prev) => [...prev, { ...data.category, sticker_count: 0 }]);
        setNewCatName("");
        setNewCatIcon("");
        setShowNewCat(false);
      }
    } catch (e) { console.error(e); }
  };

  const handleUploadCatIcon = async (file: File) => {
    setUploadingCatIcon(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error("فشل قراءة الملف"));
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/wall/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ file: base64, filename: file.name, contentType: file.type }),
      });
      const data = await res.json();
      if (data.success) setNewCatIcon(data.url);
    } catch (e) { console.error(e); }
    setUploadingCatIcon(false);
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("هل تريد حذف هذا القسم وجميع ملصقاته؟")) return;
    try {
      const res = await fetch(`/api/admin/sticker-categories/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setCategories((prev) => prev.filter((c) => c.id !== id));
        if (selectedCategoryId === id) setSelectedCategoryId(null);
        fetchStickers();
      }
    } catch (e) { console.error(e); }
  };

  const handleUploadStickers = async (files: FileList) => {
    if (!selectedCategoryId || files.length === 0) return;
    setUploading(true);
    try {
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
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ file: base64, filename: file.name, contentType: file.type }),
        });
        const uploadData = await uploadRes.json();
        if (uploadData.success) {
          await fetch("/api/admin/stickers", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              category_id: selectedCategoryId,
              name: file.name.replace(/\.[^.]+$/, ""),
              image_url: uploadData.url,
            }),
          });
        }
      }
      fetchStickers(selectedCategoryId);
    } catch (e) { console.error(e); }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteSticker = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/stickers/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setStickers((prev) => prev.filter((s) => s.id !== id));
      }
    } catch (e) { console.error(e); }
  };

  if (loading) {
    return <div className="p-6 text-center text-muted-foreground">جاري التحميل...</div>;
  }

  return (
    <div className="p-4 space-y-4 rtl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">إدارة الملصقات</h2>
        <button
          onClick={() => setShowNewCat(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:bg-primary/90 transition"
        >
          <Plus size={14} /> قسم جديد
        </button>
      </div>

      {/* نموذج إنشاء قسم جديد */}
      {showNewCat && (
        <div className="p-3 bg-muted/50 rounded-xl border border-border space-y-2">
          <div className="flex items-center gap-2">
            <input
              ref={catIconInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) handleUploadCatIcon(e.target.files[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => catIconInputRef.current?.click()}
              disabled={uploadingCatIcon}
              className="w-14 h-14 rounded-lg border-2 border-dashed border-border hover:border-primary bg-background flex items-center justify-center overflow-hidden transition shrink-0"
            >
              {uploadingCatIcon ? (
                <span className="text-[10px] text-muted-foreground">...</span>
              ) : newCatIcon ? (
                <img src={newCatIcon} className="w-full h-full object-cover" alt="" />
              ) : (
                <Plus size={20} className="text-muted-foreground" />
              )}
            </button>
            <input
              type="text"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="اسم القسم"
              className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 bg-background"
              onKeyDown={(e) => e.key === "Enter" && handleCreateCategory()}
            />
            <button onClick={handleCreateCategory} className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition">
              <Save size={14} />
            </button>
            <button onClick={() => setShowNewCat(false)} className="p-1.5 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-4">
        {/* قائمة الأقسام */}
        <div className="w-48 shrink-0 space-y-1">
          <button
            onClick={() => setSelectedCategoryId(null)}
            className={`w-full text-right px-3 py-2 rounded-lg text-xs font-bold transition ${
              !selectedCategoryId ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"
            }`}
          >
            الكل ({stickers.length})
          </button>
          {categories.map((cat) => (
            <div key={cat.id} className="group flex items-center gap-1">
              <button
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`flex-1 text-right px-3 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${
                  selectedCategoryId === cat.id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"
                }`}
              >
                <img src={cat.icon} className="w-6 h-6 rounded-md object-cover shrink-0" alt="" />
                <span className="truncate">{cat.name} ({cat.sticker_count})</span>
              </button>
              <button
                onClick={() => handleDeleteCategory(cat.id)}
                className="p-1 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        {/* منطقة الملصقات */}
        <div className="flex-1 min-w-0">
          {selectedCategoryId && (
            <div className="mb-3 flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleUploadStickers(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-bold hover:bg-green-600 transition disabled:opacity-50"
              >
                <Upload size={14} />
                {uploading ? "جاري الرفع..." : "رفع ملصقات"}
              </button>
            </div>
          )}

          {!selectedCategoryId ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <FolderOpen size={40} className="mx-auto mb-2 opacity-50" />
              اختر قسم لعرض وإدارة الملصقات
            </div>
          ) : stickers.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <Image size={40} className="mx-auto mb-2 opacity-50" />
              لا يوجد ملصقات في هذا القسم. اضغط "رفع ملصقات" لإضافة.
            </div>
          ) : (
            <div className="grid grid-cols-6 gap-2">
              {stickers.map((sticker) => (
                <div key={sticker.id} className="group relative aspect-square rounded-xl overflow-hidden border border-border bg-muted">
                  <img src={sticker.image_url} alt={sticker.name} className="w-full h-full object-contain p-1" />
                  <button
                    onClick={() => handleDeleteSticker(sticker.id)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StickersSection;
