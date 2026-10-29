import React, { useState, useRef } from "react";
import {
  X,
  Sparkles,
  Sliders,
  Image as ImageIcon,
  Upload,
  Check,
  Eye,
  Camera,
  Layers,
  Wand2,
} from "lucide-react";
import {
  StudioEffectsConfig,
  VisualFilter,
  VirtualBackground,
} from "./callTypes";

interface StudioEffectsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  effects: StudioEffectsConfig;
  onChangeEffects: (effects: StudioEffectsConfig) => void;
}

interface FilterOption {
  id: VisualFilter;
  name: string;
  desc: string;
  previewClass: string;
}

const FILTER_OPTIONS: FilterOption[] = [
  {
    id: "none",
    name: "طبيعي",
    desc: "بدون أي مؤثرات لونية",
    previewClass: "bg-slate-800",
  },
  {
    id: "soft-glow",
    name: "ناعم / تجميل",
    desc: "نعومة للبشرة وإضاءة متوازنة",
    previewClass: "bg-gradient-to-tr from-rose-950 via-amber-900 to-rose-900",
  },
  {
    id: "warm-cinema",
    name: "سينمائي دافئ",
    desc: "ألوان دافئة مستوحاة من الأفلام",
    previewClass: "bg-gradient-to-tr from-amber-950 via-yellow-900 to-orange-950",
  },
  {
    id: "neon",
    name: "نيون ليلي",
    desc: "تدرجات سايبربانك مشعة",
    previewClass: "bg-gradient-to-tr from-fuchsia-950 via-purple-900 to-cyan-950",
  },
  {
    id: "noir",
    name: "أبيض وأسود كلاسيكي",
    desc: "تباين نوار فوتوغرافي عميق",
    previewClass: "bg-gradient-to-tr from-zinc-950 via-neutral-900 to-slate-800",
  },
  {
    id: "vivid-hdr",
    name: "تباين عالي (HDR)",
    desc: "ألوان مشبعة وتفاصيل فائقة الوضوح",
    previewClass: "bg-gradient-to-tr from-blue-950 via-emerald-900 to-cyan-900",
  },
];

interface BackgroundOption {
  id: VirtualBackground;
  name: string;
  type: "none" | "blur" | "preset";
  bgStyle?: string;
  imageUrl?: string;
}

const BACKGROUND_OPTIONS: BackgroundOption[] = [
  {
    id: "none",
    name: "بدون عزل",
    type: "none",
    bgStyle: "bg-slate-900 border border-slate-700/60",
  },
  {
    id: "light-blur",
    name: "عزل ضبابي خفيف",
    type: "blur",
    bgStyle: "bg-gradient-to-br from-cyan-950/80 to-slate-900 backdrop-blur-sm border border-cyan-500/30",
  },
  {
    id: "strong-blur",
    name: "عزل بوكيه استوديو",
    type: "blur",
    bgStyle: "bg-gradient-to-br from-indigo-950/90 to-purple-950 backdrop-blur-xl border border-indigo-500/40",
  },
  {
    id: "gaming-room",
    name: "غرفة قيمنج نيون",
    type: "preset",
    imageUrl:
      "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=600&auto=format&fit=crop&q=80",
  },
  {
    id: "modern-office",
    name: "مكتب عصري راقي",
    type: "preset",
    imageUrl:
      "https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&auto=format&fit=crop&q=80",
  },
  {
    id: "space",
    name: "فضاء وسديم كوني",
    type: "preset",
    imageUrl:
      "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=600&auto=format&fit=crop&q=80",
  },
  {
    id: "night-nature",
    name: "طبيعة ليلية ساحرة",
    type: "preset",
    imageUrl:
      "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=600&auto=format&fit=crop&q=80",
  },
];

// دالة لتوليد CSS Filter string بناءً على الاختيار وقوة التأثير
export function getCssFilterString(
  filter: VisualFilter,
  intensity: number
): string {
  const factor = intensity / 100;
  switch (filter) {
    case "soft-glow":
      return `brightness(${1 + 0.08 * factor}) contrast(${
        1 - 0.05 * factor
      }) saturate(${1 + 0.15 * factor}) blur(${0.3 * factor}px)`;
    case "warm-cinema":
      return `sepia(${0.35 * factor}) contrast(${
        1 + 0.12 * factor
      }) saturate(${1 + 0.25 * factor}) hue-rotate(${-10 * factor}deg)`;
    case "neon":
      return `contrast(${1 + 0.35 * factor}) saturate(${
        1 + 0.7 * factor
      }) hue-rotate(${170 * factor}deg) brightness(${1 + 0.1 * factor})`;
    case "noir":
      return `grayscale(${1 * factor}) contrast(${
        1 + 0.3 * factor
      }) brightness(${1 - 0.05 * factor})`;
    case "vivid-hdr":
      return `contrast(${1 + 0.4 * factor}) saturate(${
        1 + 0.45 * factor
      }) brightness(${1 + 0.05 * factor})`;
    case "none":
    default:
      return "none";
  }
}

export const StudioEffectsDrawer: React.FC<StudioEffectsDrawerProps> = ({
  isOpen,
  onClose,
  effects,
  onChangeEffects,
}) => {
  const [activeTab, setActiveTab] = useState<"filters" | "backgrounds">(
    "filters"
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleCustomBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      onChangeEffects({
        ...effects,
        background: "custom",
        customBackgroundUrl: url,
      });
    }
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[10005] flex justify-center p-3 sm:p-4 pointer-events-auto animate-in slide-in-from-bottom duration-300 select-none"
      dir="rtl"
    >
      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl backdrop-blur-2xl bg-slate-950/90 border border-cyan-500/30 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_35px_rgba(6,182,212,0.2)] flex flex-col text-slate-100 max-h-[82vh]">
        {/* شريط الإغلاق والعنوان العلوي */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl flex items-center justify-center bg-gradient-to-tr from-cyan-500/20 via-teal-500/20 to-emerald-500/20 border border-cyan-500/40 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.25)]">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-black text-white tracking-wide">
                استوديو المؤثرات والفلاتر ✨
              </h3>
              <p className="text-[11px] text-slate-400 font-medium">
                تخصيص مباشر لصورة الكاميرا والخلفيات
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 border border-slate-700/40 transition-colors"
            title="إغلاق اللوحة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* التبديل بين التبويبات */}
        <div className="flex items-center gap-2 px-6 pt-3 pb-1 border-b border-slate-800/50">
          <button
            onClick={() => setActiveTab("filters")}
            className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-bold transition-all duration-200 ${
              activeTab === "filters"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.25)]"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
          >
            <Wand2 className="w-4 h-4" />
            <span>الفلاتر البصرية</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300">
              {FILTER_OPTIONS.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("backgrounds")}
            className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-bold transition-all duration-200 ${
              activeTab === "backgrounds"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.25)]"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>الخلفيات والعزل</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300">
              {BACKGROUND_OPTIONS.length + 1}
            </span>
          </button>
        </div>

        {/* محتوى التبويبات */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* 1. تبويب الفلاتر البصرية */}
          {activeTab === "filters" && (
            <div className="space-y-5 animate-in fade-in duration-200">
              {/* شريط التحكم بقوة الفلتر */}
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                    <Sliders className="w-4 h-4 text-cyan-400" />
                    <span>قوة تأثير الفلتر:</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-cyan-400">
                    {effects.filterIntensity}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={effects.filterIntensity}
                  disabled={effects.filter === "none"}
                  onChange={(e) =>
                    onChangeEffects({
                      ...effects,
                      filterIntensity: Number(e.target.value),
                    })
                  }
                  className="w-full h-2 rounded-lg bg-slate-800 accent-cyan-400 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                />
              </div>

              {/* شبكة بطاقات الفلاتر */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {FILTER_OPTIONS.map((opt) => {
                  const isSelected = effects.filter === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() =>
                        onChangeEffects({
                          ...effects,
                          filter: opt.id,
                        })
                      }
                      className={`relative flex flex-col items-center p-3.5 rounded-2xl transition-all duration-200 border text-center ${
                        isSelected
                          ? "bg-cyan-950/40 border-cyan-400 text-white shadow-[0_0_20px_rgba(6,182,212,0.3)] scale-[1.02]"
                          : "bg-slate-900/50 border-slate-800/90 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                      }`}
                    >
                      {/* معاينة الفلتر البصري المصغرة */}
                      <div
                        className={`w-full h-16 rounded-xl mb-2.5 overflow-hidden relative shadow-inner flex items-center justify-center ${opt.previewClass}`}
                      >
                        <Camera className="w-6 h-6 text-white/50" />
                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 p-1 rounded-full bg-cyan-400 text-slate-950 shadow-md">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                      </div>
                      <span className="text-xs font-bold tracking-tight">
                        {opt.name}
                      </span>
                      <span className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">
                        {opt.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. تبويب الخلفيات الافتراضية */}
          {activeTab === "backgrounds" && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {BACKGROUND_OPTIONS.map((bg) => {
                  const isSelected = effects.background === bg.id;
                  return (
                    <button
                      key={bg.id}
                      onClick={() =>
                        onChangeEffects({
                          ...effects,
                          background: bg.id,
                        })
                      }
                      className={`relative flex flex-col items-center p-3 rounded-2xl transition-all duration-200 border text-center ${
                        isSelected
                          ? "bg-emerald-950/40 border-emerald-400 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] scale-[1.02]"
                          : "bg-slate-900/50 border-slate-800/90 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                      }`}
                    >
                      {/* المعاينة */}
                      <div className="w-full h-20 rounded-xl mb-2 overflow-hidden relative flex items-center justify-center shadow-inner">
                        {bg.imageUrl ? (
                          <img
                            src={bg.imageUrl}
                            alt={bg.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div
                            className={`w-full h-full flex items-center justify-center ${bg.bgStyle}`}
                          >
                            <ImageIcon className="w-6 h-6 text-slate-400" />
                          </div>
                        )}

                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 p-1 rounded-full bg-emerald-400 text-slate-950 shadow-md">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                      </div>

                      <span className="text-xs font-bold">{bg.name}</span>
                    </button>
                  );
                })}

                {/* زر رفع خلفية مخصصة */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative flex flex-col items-center justify-center p-3 rounded-2xl cursor-pointer border-2 border-dashed transition-all duration-200 text-center ${
                    effects.background === "custom"
                      ? "bg-emerald-950/30 border-emerald-400 text-white"
                      : "bg-slate-900/40 border-slate-700 hover:border-cyan-400 text-slate-300 hover:text-cyan-300"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleCustomBgUpload}
                    className="hidden"
                  />
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-slate-800 text-cyan-400 mb-1.5">
                    <Upload className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-bold">+ رفع صورة خاصة</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">
                    JPG, PNG
                  </span>

                  {effects.background === "custom" &&
                    effects.customBackgroundUrl && (
                      <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none opacity-40">
                        <img
                          src={effects.customBackgroundUrl}
                          alt="Custom"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* الشريط السفلي للتأكيد */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-slate-900/80 border-t border-slate-800/80">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Eye className="w-4 h-4 text-cyan-400" />
            <span>التطبيق فوري على الكاميرا</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl font-bold text-xs bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 shadow-md transition-all active:scale-95"
          >
            تم واعتمد المؤثرات
          </button>
        </div>
      </div>
    </div>
  );
};

export default StudioEffectsDrawer;
