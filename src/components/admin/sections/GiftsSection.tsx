"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Trash2, Upload, Save, X, Image, FolderOpen, Coins } from "lucide-react";
import { toast } from "sonner";

interface GiftCategory {
  id: string;
  name: string;
  sort_order: number;
  gift_count: number;
}

interface GiftItem {
  id: string;
  name: string;
  icon: string;
  price: number;
  category_id: string;
  category_name: string;
}

const GiftsSection = () => {
  const [categories, setCategories] = useState<GiftCategory[]>([]);
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newCatName, setNewCatName] = useState("");
  const [showNewCat, setShowNewCat] = useState(false);
  const [newGiftName, setNewGiftName] = useState("");
  const [newGiftPrice, setNewGiftPrice] = useState("");
  const [newGiftIcon, setNewGiftIcon] = useState("");
  const [showNewGift, setShowNewGift] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const authHeaders = useCallback(() => {
    const t = localStorage.getItem("authToken") || "";
    return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
  }, []);

  const fetchCategories = async () => {
    try {
      const res = await fetch("/api/admin/gift-categories", { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setCategories(data.categories);
      else toast.error(data.message || "فشل جلب الأقسام");
    } catch (e) { console.error(e); }
  };

  const fetchGifts = async (categoryId?: string) => {
    try {
      const url = categoryId ? `/api/admin/gifts?category_id=${categoryId}` : "/api/admin/gifts";
      const res = await fetch(url, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setGifts(data.gifts);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    Promise.all([fetchCategories(), fetchGifts()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchGifts(selectedCategoryId || undefined);
  }, [selectedCategoryId]);

  const handleUploadIcon = async (file: File): Promise<string> => {
    const t = localStorage.getItem("authToken") || "";
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = () => reject(new Error("فشل قراءة الملف"));
      reader.readAsDataURL(file);
    });
    const res = await fetch("/api/wall/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify({ file: base64, filename: file.name, contentType: file.type }),
    });
    const data = await res.json();
    if (data.success) return data.url;
    toast.error(data.message || "فشل رفع الملف");
    return "";
  };

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) {
      toast.error("الرجاء إدخال اسم القسم");
      return;
    }
    try {
      const res = await fetch("/api/admin/gift-categories", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: newCatName.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setCategories((prev) => [...prev, { ...data.category, gift_count: 0 }]);
        setNewCatName("");
        setShowNewCat(false);
        toast.success("تم إنشاء القسم بنجاح");
      } else {
        toast.error(data.message || "فشل إنشاء القسم");
      }
    } catch (e) {
      console.error(e);
      toast.error("حدث خطأ في الاتصال");
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("هل تريد حذف هذا القسم وجميع هداياه؟")) return;
    try {
      const res = await fetch(`/api/admin/gift-categories/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setCategories((prev) => prev.filter((c) => c.id !== id));
        if (selectedCategoryId === id) setSelectedCategoryId(null);
        fetchGifts();
        toast.success("تم حذف القسم");
      } else {
        toast.error(data.message || "فشل حذف القسم");
      }
    } catch (e) {
      console.error(e);
      toast.error("حدث خطأ في الاتصال");
    }
  };

  const handleCreateGift = async () => {
    if (!newGiftName.trim() || !newGiftPrice.trim()) {
      toast.error("الرجاء إدخال اسم الهدية والسعر");
      return;
    }
    const price = parseInt(newGiftPrice);
    if (isNaN(price) || price < 0) {
      toast.error("السعر يجب أن يكون رقماً صحيحاً");
      return;
    }
    try {
      const res = await fetch("/api/admin/gifts", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: newGiftName.trim(),
          icon: newGiftIcon || "/pic.png",
          price,
          category_id: selectedCategoryId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        fetchGifts(selectedCategoryId || undefined);
        setNewGiftName("");
        setNewGiftPrice("");
        setNewGiftIcon("");
        setShowNewGift(false);
        toast.success("تم إنشاء الهدية بنجاح");
      } else {
        toast.error(data.message || "فشل إنشاء الهدية");
      }
    } catch (e) {
      console.error(e);
      toast.error("حدث خطأ في الاتصال");
    }
  };

  const handleDeleteGift = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/gifts/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setGifts((prev) => prev.filter((g) => g.id !== id));
        toast.success("تم حذف الهدية");
      } else {
        toast.error(data.message || "فشل حذف الهدية");
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
        <h2 className="text-lg font-bold">إدارة الهدايا</h2>
        <button
          onClick={() => setShowNewCat(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:bg-primary/90 transition"
        >
          <Plus size={14} /> قسم جديد
        </button>
      </div>

      {showNewCat && (
        <div className="p-3 bg-muted/50 rounded-xl border border-border space-y-2">
          <div className="flex items-center gap-2">
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
        <div className="w-48 shrink-0 space-y-1">
          <button
            onClick={() => setSelectedCategoryId(null)}
            className={`w-full text-right px-3 py-2 rounded-lg text-xs font-bold transition ${
              !selectedCategoryId ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"
            }`}
          >
            الكل ({gifts.length})
          </button>
          {categories.map((cat) => (
            <div key={cat.id} className="group flex items-center gap-1">
              <button
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`flex-1 text-right px-3 py-2 rounded-lg text-xs font-bold transition ${
                  selectedCategoryId === cat.id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"
                }`}
              >
                <span className="truncate">{cat.name} ({cat.gift_count})</span>
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

        <div className="flex-1 min-w-0">
          {selectedCategoryId && (
            <div className="mb-3">
              <button
                onClick={() => setShowNewGift(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-bold hover:bg-green-600 transition"
              >
                <Plus size={14} /> إضافة هدية
              </button>
            </div>
          )}

          {showNewGift && selectedCategoryId && (
            <div className="mb-4 p-3 bg-muted/50 rounded-xl border border-border space-y-2">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    if (e.target.files?.[0]) {
                      const url = await handleUploadIcon(e.target.files[0]);
                      if (url) setNewGiftIcon(url);
                    }
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-12 h-12 rounded-lg border-2 border-dashed border-border hover:border-primary bg-background flex items-center justify-center overflow-hidden transition shrink-0"
                >
                  {newGiftIcon ? (
                    <img src={newGiftIcon} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <Plus size={18} className="text-muted-foreground" />
                  )}
                </button>
                <input
                  type="text"
                  value={newGiftName}
                  onChange={(e) => setNewGiftName(e.target.value)}
                  placeholder="اسم الهدية"
                  className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 bg-background"
                />
                <div className="flex items-center gap-1">
                  <Coins size={14} className="text-yellow-500" />
                  <input
                    type="number"
                    value={newGiftPrice}
                    onChange={(e) => setNewGiftPrice(e.target.value)}
                    placeholder="السعر"
                    className="w-20 text-sm border border-border rounded-lg px-3 py-1.5 bg-background"
                    min="0"
                  />
                </div>
                <button onClick={handleCreateGift} className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition">
                  <Save size={14} />
                </button>
                <button onClick={() => setShowNewGift(false)} className="p-1.5 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition">
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {!selectedCategoryId ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <FolderOpen size={40} className="mx-auto mb-2 opacity-50" />
              اختر قسم لعرض وإدارة الهدايا
            </div>
          ) : gifts.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <Image size={40} className="mx-auto mb-2 opacity-50" />
              لا يوجد هدايا في هذا القسم. اضغط "إضافة هدية" لإضافة.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {gifts.map((gift) => (
                <div key={gift.id} className="group relative rounded-xl overflow-hidden border border-border bg-muted p-3">
                  <div className="flex items-center justify-center h-20 mb-2">
                    <img src={gift.icon} alt={gift.name} className="max-h-full max-w-full object-contain" />
                  </div>
                  <p className="text-xs font-bold text-center truncate">{gift.name}</p>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <Coins size={12} className="text-yellow-500" />
                    <span className="text-xs font-bold text-yellow-500">{gift.price}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteGift(gift.id)}
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

export default GiftsSection;
