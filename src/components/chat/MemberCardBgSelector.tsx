"use client";

import React, { useState, useEffect } from "react";
import { X, Check, Loader2, Image, Palette } from "lucide-react";
import { showSuccess, showError } from "@/utils/toast";
import { getSocket } from "@/lib/socket";
import { useRealtimeStore } from "@/lib/realtime-store";

interface Theme {
  id: string;
  name: string;
  image_url: string;
}

interface MemberCardBgSelectorProps {
  onClose: () => void;
}

const PRESET_COLORS = [
  "#FF0000", "#FF4500", "#FF8C00", "#FFD700",
  "#ADFF2F", "#00FF00", "#00CED1", "#1E90FF",
  "#0000FF", "#8A2BE2", "#FF00FF", "#DC143C",
  "#FF69B4", "#F0E68C", "#7FFFD4", "#C0C0C0",
];

const MemberCardBgSelector = ({ onClose }: MemberCardBgSelectorProps) => {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBg, setSelectedBg] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"color" | "image">("color");
  const [customColor, setCustomColor] = useState("#000000");

  const getAuthHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`,
    "Content-Type": "application/json",
  });

  useEffect(() => {
    const currentUser = JSON.parse(localStorage.getItem("user") || "null");
    if (currentUser?.memberCardBgUrl) {
      setSelectedBg(currentUser.memberCardBgUrl);
      if (currentUser.memberCardBgUrl.startsWith("#")) {
        setTab("color");
        setCustomColor(currentUser.memberCardBgUrl);
      } else {
        setTab("image");
      }
    }
    fetch("/api/member-card-themes")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setThemes(data.themes);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const saveBg = async (bgUrl: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/user/member-card-bg", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ memberCardBgUrl: bgUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedBg(bgUrl);
        const storedUser = JSON.parse(localStorage.getItem("user") || "null");
        if (storedUser) {
          storedUser.memberCardBgUrl = data.memberCardBgUrl;
          localStorage.setItem("user", JSON.stringify(storedUser));
        }
        const resultUrl = data.memberCardBgUrl;
        getSocket().emit("update_profile", { memberCardBgUrl: resultUrl });
        useRealtimeStore.getState().mergeOnlineUser({
          id: storedUser?.id || "",
          username: storedUser?.name || storedUser?.username || "",
          memberCardBgUrl: resultUrl,
        });
        window.dispatchEvent(new CustomEvent("frame-updated"));
        showSuccess(bgUrl ? "تم اختيار الخلفية" : "تم إزالة الخلفية");
        onClose();
      } else {
        showError(data.message || "فشل تحديث الخلفية");
      }
    } catch {
      showError("حدث خطأ في الاتصال");
    }
    setSaving(false);
  };

  const handleColorSelect = (color: string) => {
    saveBg(color);
  };

  const handleImageSelect = (url: string) => {
    saveBg(url);
  };

  const handleRemove = () => {
    saveBg("");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold">خلفية بطاقة العضو</h4>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition">
          <X size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1">
        <button
          onClick={() => setTab("color")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-md transition ${
            tab === "color" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Palette size={14} />
          لون ثابت
        </button>
        <button
          onClick={() => setTab("image")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-md transition ${
            tab === "image" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Image size={14} />
          صورة
        </button>
      </div>

      {tab === "color" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-8 gap-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => handleColorSelect(color)}
                disabled={saving}
                className={`w-full aspect-square rounded-lg border-2 transition-all ${
                  selectedBg === color
                    ? "border-primary scale-110 shadow-md"
                    : "border-border hover:scale-105"
                }`}
                style={{ backgroundColor: color }}
              >
                {selectedBg === color && (
                  <div className="flex items-center justify-center h-full">
                    <Check size={14} className="text-white drop-shadow-md" />
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Custom color */}
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={customColor}
              onChange={(e) => setCustomColor(e.target.value)}
              className="w-10 h-10 rounded-lg border border-border cursor-pointer"
            />
            <button
              onClick={() => handleColorSelect(customColor)}
              disabled={saving}
              className="flex-1 py-2 text-xs font-bold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition disabled:opacity-50"
            >
              تطبيق اللون
            </button>
          </div>
        </div>
      ) : (
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 size={24} className="animate-spin ml-2" />
              جاري التحميل...
            </div>
          ) : themes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-sm">لا توجد ثيمات متاحة حالياً</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {themes.map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => handleImageSelect(theme.image_url)}
                  disabled={saving}
                  className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                    selectedBg === theme.image_url
                      ? "border-primary shadow-md shadow-primary/20"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <img src={theme.image_url} alt={theme.name} className="w-full h-auto" />
                  {selectedBg === theme.image_url && (
                    <div className="absolute top-1 right-1 p-0.5 rounded-full bg-primary text-white">
                      <Check size={12} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedBg && (
        <div className="flex justify-center">
          <button
            onClick={handleRemove}
            disabled={saving}
            className="px-4 py-2 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-lg transition"
          >
            {saving ? "جاري الحفظ..." : "إزالة الخلفية"}
          </button>
        </div>
      )}
    </div>
  );
};

export default MemberCardBgSelector;
