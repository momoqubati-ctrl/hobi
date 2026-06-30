"use client";

import React, { useState, useEffect } from "react";
import { X, Check, Loader2 } from "lucide-react";
import { showSuccess, showError } from "@/utils/toast";
import { getSocket } from "@/lib/socket";
import { useRealtimeStore } from "@/lib/realtime-store";

interface Frame {
  id: string;
  name: string;
  image_url: string;
}

interface FrameSelectorProps {
  onClose: () => void;
}

const FrameSelector = ({ onClose }: FrameSelectorProps) => {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUrl, setSelectedUrl] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const getAuthHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`,
    "Content-Type": "application/json",
  });

  useEffect(() => {
    const currentUser = JSON.parse(localStorage.getItem("user") || "null");
    if (currentUser?.avatarFrameUrl) {
      setSelectedUrl(currentUser.avatarFrameUrl);
    }
    fetch("/api/profile-frames")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setFrames(data.frames);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = async (url: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/user/frame", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ frameUrl: url }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedUrl(url);
        const storedUser = JSON.parse(localStorage.getItem("user") || "null");
        if (storedUser) {
          storedUser.avatarFrameUrl = data.avatarFrameUrl;
          localStorage.setItem("user", JSON.stringify(storedUser));
        }
        const frameUrl = data.avatarFrameUrl;
        getSocket().emit("update_profile", { avatarFrameUrl: frameUrl });
        useRealtimeStore.getState().mergeOnlineUser({
          id: storedUser?.id || "",
          username: storedUser?.name || storedUser?.username || "",
          avatarFrameUrl: frameUrl,
        });
        window.dispatchEvent(new CustomEvent("frame-updated"));
        showSuccess("تم اختيار الإطار");
        onClose();
      } else {
        showError(data.message || "فشل تحديث الإطار");
      }
    } catch {
      showError("حدث خطأ في الاتصال");
    }
    setSaving(false);
  };

  const handleRemove = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/user/frame", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ frameUrl: "" }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedUrl("");
        const storedUser = JSON.parse(localStorage.getItem("user") || "null");
        if (storedUser) {
          storedUser.avatarFrameUrl = "";
          localStorage.setItem("user", JSON.stringify(storedUser));
        }
        getSocket().emit("update_profile", { avatarFrameUrl: "" });
        useRealtimeStore.getState().mergeOnlineUser({
          id: storedUser?.id || "",
          username: storedUser?.name || storedUser?.username || "",
          avatarFrameUrl: "",
        });
        window.dispatchEvent(new CustomEvent("frame-updated"));
        showSuccess("تم إزالة الإطار");
        onClose();
      } else {
        showError(data.message || "فشل إزالة الإطار");
      }
    } catch {
      showError("حدث خطأ في الاتصال");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold">اختيار إطار الصورة</h4>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition">
          <X size={18} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 size={24} className="animate-spin ml-2" />
          جاري التحميل...
        </div>
      ) : frames.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">لا توجد اطارات متاحة حالياً</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {frames.map((frame) => (
            <button
              key={frame.id}
              onClick={() => handleSelect(frame.image_url)}
              disabled={saving}
              className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                selectedUrl === frame.image_url
                  ? "border-primary shadow-md shadow-primary/20"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <img src={frame.image_url} alt={frame.name} className="w-full h-auto" />
              {selectedUrl === frame.image_url && (
                <div className="absolute top-1 right-1 p-0.5 rounded-full bg-primary text-white">
                  <Check size={12} />
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {selectedUrl && (
        <div className="flex justify-center">
          <button
            onClick={handleRemove}
            disabled={saving}
            className="px-4 py-2 text-xs font-bold text-red-500 hover:bg-red-500/10 rounded-lg transition"
          >
            {saving ? "جاري الحفظ..." : "إزالة الإطار"}
          </button>
        </div>
      )}
    </div>
  );
};

export default FrameSelector;
