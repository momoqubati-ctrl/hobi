"use client";

import React, { useState, useEffect } from "react";
import { X, Check, Loader2, Sparkles } from "lucide-react";
import { showSuccess, showError } from "@/utils/toast";
import { getSocket } from "@/lib/socket";

interface SeatFrame {
  id: string;
  name: string;
  imageUrl: string;
}

// مجموعة إطارات المقاعد الصوتية الافتراضية الجاهزة والفخمة
const DEFAULT_SEAT_FRAMES: SeatFrame[] = [
  {
    id: "royal-gold",
    name: "التاج الملكي الذهبي",
    imageUrl: "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=150&auto=format&fit=crop&q=80",
  },
  {
    id: "neon-cyber",
    name: "نيون المستقبل السيبراني",
    imageUrl: "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=150&auto=format&fit=crop&q=80",
  },
  {
    id: "fire-dragon",
    name: "لهيب التنين المشتعل",
    imageUrl: "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=150&auto=format&fit=crop&q=80",
  },
  {
    id: "diamond-star",
    name: "الألماس المتلألئ",
    imageUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=150&auto=format&fit=crop&q=80",
  },
  {
    id: "emerald-glow",
    name: "الزمرد المتوهج",
    imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80",
  },
];

interface SeatFrameSelectorProps {
  onClose: () => void;
}

export const SeatFrameSelector: React.FC<SeatFrameSelectorProps> = ({ onClose }) => {
  const [selectedUrl, setSelectedUrl] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("user");
      if (stored) {
        const user = JSON.parse(stored);
        if (user.seatFrameUrl) {
          setSelectedUrl(user.seatFrameUrl);
        }
      }
    } catch {}
  }, []);

  const handleSelect = async (url: string) => {
    setSaving(true);
    try {
      const token = localStorage.getItem("authToken") || localStorage.getItem("token") || "";
      const res = await fetch("/api/user/seat-frame", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ seatFrameUrl: url }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedUrl(url);
        try {
          const stored = localStorage.getItem("user");
          if (stored) {
            const user = JSON.parse(stored);
            user.seatFrameUrl = data.seatFrameUrl;
            localStorage.setItem("user", JSON.stringify(user));
          }
        } catch {}

        const socket = getSocket();
        if (socket?.data?.user) {
          (socket.data.user as any).seatFrameUrl = data.seatFrameUrl;
        }

        showSuccess(url ? "تم تفعيل إطار المقعد الصوتي بنجاح!" : "تمت إزالة إطار المقعد");
      } else {
        showError(data.message || "تعذر تفعيل إطار المقعد");
      }
    } catch (e: any) {
      showError("حدث خطأ أثناء الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl text-white select-none">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-sm text-foreground">إطارات المقاعد الصوتية</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-400 mb-4 text-center">
          اختر الإطار الذي يظهر حول صورتك عندما تصعد على أي مقعد صوتي في الغرفة
        </p>

        <div className="grid grid-cols-3 gap-3 mb-5 max-h-[260px] overflow-y-auto no-scrollbar p-1">
          {/* خيار بدون إطار */}
          <div
            onClick={() => handleSelect("")}
            className={`relative flex flex-col items-center p-3 rounded-xl border cursor-pointer transition ${
              selectedUrl === ""
                ? "border-emerald-500 bg-emerald-500/10"
                : "border-slate-800 hover:border-slate-700 bg-slate-800/40"
            }`}
          >
            <div className="w-12 h-12 rounded-full border border-dashed border-slate-600 flex items-center justify-center text-xs text-slate-500">
              بدون
            </div>
            <span className="text-[10px] mt-2 text-slate-400 font-medium">افتراضي</span>
            {selectedUrl === "" && (
              <div className="absolute top-1 right-1 bg-emerald-500 rounded-full p-0.5 text-white">
                <Check className="w-3 h-3" />
              </div>
            )}
          </div>

          {/* قائمة الإطارات الجاهزة */}
          {DEFAULT_SEAT_FRAMES.map((frame) => {
            const isSelected = selectedUrl === frame.imageUrl;
            return (
              <div
                key={frame.id}
                onClick={() => handleSelect(frame.imageUrl)}
                className={`relative flex flex-col items-center p-2 rounded-xl border cursor-pointer transition transform hover:scale-105 ${
                  isSelected
                    ? "border-amber-400 bg-amber-400/10 shadow-lg shadow-amber-500/20"
                    : "border-slate-800 hover:border-slate-700 bg-slate-800/40"
                }`}
              >
                <div className="relative w-12 h-12 rounded-full overflow-hidden border border-slate-700">
                  <img
                    src={frame.imageUrl}
                    alt={frame.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="text-[9px] mt-2 text-slate-300 font-medium truncate max-w-[70px] text-center">
                  {frame.name}
                </span>

                {isSelected && (
                  <div className="absolute top-1 right-1 bg-amber-400 rounded-full p-0.5 text-black">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {saving && (
          <div className="flex items-center justify-center gap-2 text-xs text-amber-400 mb-3 animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            جاري حفظ الإطار...
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition"
        >
          تم
        </button>
      </div>
    </div>
  );
};
