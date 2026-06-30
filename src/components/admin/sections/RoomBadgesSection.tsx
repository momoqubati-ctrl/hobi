"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Upload, X, Image as ImageIcon, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

interface RoomBadge {
  id: string;
  name: string;
  power: number;
  icon: string;
  bg: string;
  bg_type: string;
  sort_order: number;
  is_active: boolean;
}

const DEFAULT_GRADIENT = "linear-gradient(60deg, #ff0000, #fff200, #ff0000, #ffffff)";

const RoomBadgesSection = () => {
  const [badges, setBadges] = useState<RoomBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: "",
    power: 0,
    icon: "",
    c1: "#ff0000",
    c2: "#fff200",
    c3: "#ff0000",
    c4: "#ffffff",
    bg: DEFAULT_GRADIENT,
    bg_type: "static",
  });

  const authHeaders = useCallback(() => {
    const t = localStorage.getItem("authToken") || "";
    return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
  }, []);

  const fetchBadges = async () => {
    try {
      const res = await fetch("/api/admin/room-badges", { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setBadges(data.badges);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    fetchBadges().finally(() => setLoading(false));
  }, []);

  const buildGradient = (c1: string, c2: string, c3: string, c4: string) =>
    `linear-gradient(60deg, ${c1}, ${c2}, ${c3}, ${c4})`;

  const syncBgFromColors = (colors: { c1: string; c2: string; c3: string; c4: string }) => {
    const bg = buildGradient(colors.c1, colors.c2, colors.c3, colors.c4);
    setForm((prev) => ({ ...prev, ...colors, bg }));
  };

  const handleColorChange = (key: "c1" | "c2" | "c3" | "c4", value: string) => {
    const newColors = { ...form, [key]: value };
    newColors.bg = buildGradient(newColors.c1, newColors.c2, newColors.c3, newColors.c4);
    setForm(newColors);
  };

  const uploadFile = async (file: File): Promise<string | null> => {
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
    if (!data.success) {
      toast.error(`${file.name}: ${data.message || "فشل رفع الملف"}`);
      return null;
    }
    return data.url;
  };

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await uploadFile(file);
    if (url) {
      setForm((prev) => ({ ...prev, icon: url }));
      toast.success("تم رفع الايقونة");
    }
    if (iconInputRef.current) iconInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("اسم الشارة مطلوب");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/room-badges", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: form.name,
          power: form.power,
          icon: form.icon,
          bg: form.bg,
          bg_type: form.bg_type,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("تم إنشاء الشارة");
        setShowForm(false);
        setForm({
          name: "", power: 0, icon: "",
          c1: "#ff0000", c2: "#fff200", c3: "#ff0000", c4: "#ffffff",
          bg: DEFAULT_GRADIENT, bg_type: "static",
        });
        fetchBadges();
      } else {
        toast.error(data.message || "فشل إنشاء الشارة");
      }
    } catch (e) {
      console.error(e);
      toast.error("حدث خطأ في الاتصال");
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("هل تريد حذف هذه الشارة؟")) return;
    try {
      const res = await fetch(`/api/admin/room-badges/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setBadges((prev) => prev.filter((b) => b.id !== id));
        toast.success("تم حذف الشارة");
      } else {
        toast.error(data.message || "فشل حذف الشارة");
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
        <h2 className="text-lg font-bold">إدارة شارات الغرف</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-bold hover:bg-green-600 transition"
        >
          <Plus size={16} />
          {showForm ? "إلغاء" : "إضافة شارة"}
        </button>
      </div>

      {showForm && (
        <div className="border border-border rounded-lg p-4 space-y-4 bg-muted/30">
          <h3 className="font-bold text-base">إضافة شارة جديدة</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">اسم الشارة</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                placeholder="اسم الشارة"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">رقم قوة الشارة</label>
              <input
                type="number"
                value={form.power}
                onChange={(e) => setForm((prev) => ({ ...prev, power: Number(e.target.value) }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">ايقونة الشارة</label>
              <div className="flex items-center gap-2">
                <input ref={iconInputRef} type="file" accept="image/*" className="hidden" onChange={handleIconUpload} />
                <button
                  onClick={() => iconInputRef.current?.click()}
                  className="px-3 py-2 rounded-lg border border-border bg-background text-sm hover:bg-muted transition"
                >
                  {form.icon ? "تغيير الايقونة" : "رفع ايقونة"}
                </button>
                {form.icon && (
                  <div className="relative w-10 h-10 rounded overflow-hidden border border-border">
                    <img src={form.icon} alt="icon" className="w-full h-full object-cover" />
                    <button
                      onClick={() => setForm((prev) => ({ ...prev, icon: "" }))}
                      className="absolute -top-1 -right-1 p-0.5 rounded-full bg-red-500 text-white"
                    >
                      <X size={10} />
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">نوع الخلفية</label>
              <div className="flex items-center gap-1 bg-background border border-border rounded-lg p-1 w-fit">
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, bg_type: "static" }))}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${form.bg_type === "static" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  ثابتة
                </button>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, bg_type: "animated" }))}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${form.bg_type === "animated" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  متحركة
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">الوان خلفية الشارة (Gradient)</label>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground">C1</span>
                <input
                  type="color"
                  value={form.c1}
                  onChange={(e) => handleColorChange("c1", e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer border border-border"
                />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground">C2</span>
                <input
                  type="color"
                  value={form.c2}
                  onChange={(e) => handleColorChange("c2", e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer border border-border"
                />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground">C3</span>
                <input
                  type="color"
                  value={form.c3}
                  onChange={(e) => handleColorChange("c3", e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer border border-border"
                />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground">C4</span>
                <input
                  type="color"
                  value={form.c4}
                  onChange={(e) => handleColorChange("c4", e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer border border-border"
                />
              </div>
            </div>
            <input
              type="text"
              value={form.bg}
              onChange={(e) => setForm((prev) => ({ ...prev, bg: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono mt-1"
              placeholder="linear-gradient(60deg, ...)"
            />
            <div
              className="h-8 rounded-lg border border-border mt-1"
              style={{
                background: form.bg || DEFAULT_GRADIENT,
                backgroundClip: "border-box",
                backgroundSize: form.bg_type === "animated" ? "220% auto" : undefined,
                animation: form.bg_type === "animated" ? "textclip 2s linear infinite" : undefined,
              }}
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg text-sm font-bold hover:bg-blue-600 transition disabled:opacity-50"
            >
              {submitting ? "جاري الحفظ..." : "حفظ الشارة"}
            </button>
          </div>
        </div>
      )}

      {badges.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <ImageIcon size={56} className="mx-auto mb-4 opacity-50" />
          <p className="text-base font-medium">لا يوجد شارات بعد</p>
          <p className="text-sm mt-1">اضغط "إضافة شارة" لإنشاء أول شارة</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {badges.map((badge) => (
            <div
              key={badge.id}
              className="group relative rounded-lg overflow-hidden border border-border bg-muted"
            >
              <div
                className="relative w-full h-32 flex items-center justify-center"
                style={{
                  background: badge.bg || DEFAULT_GRADIENT,
                  backgroundClip: "border-box",
                  backgroundSize: badge.bg_type === "animated" ? "220% auto" : undefined,
                  animation: badge.bg_type === "animated" ? "textclip 2s linear infinite" : undefined,
                }}
              >
                {badge.icon && (
                  <img src={badge.icon} alt="" className="w-12 h-12 object-contain" />
                )}
                <div className="absolute bottom-1 left-1 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">
                  #{badge.power}
                </div>
              </div>
              <div className="p-2 flex items-center justify-between">
                <span className="text-sm font-bold truncate">{badge.name}</span>
                <button
                  onClick={() => handleDelete(badge.id)}
                  className="p-1.5 rounded-full bg-red-500/90 hover:bg-red-600 text-white transition opacity-0 group-hover:opacity-100"
                  title="حذف"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RoomBadgesSection;
