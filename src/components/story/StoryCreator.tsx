import React, { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Image, Type, X, Loader2, Check } from "lucide-react";
import { getSocket } from "@/lib/socket";
import { showSuccess, showError } from "@/utils/toast";

const GRADIENTS = [
  { name: "بنفسجي", value: "linear-gradient(135deg,#667eea,#764ba2)" },
  { name: "وردي", value: "linear-gradient(135deg,#f093fb,#f5576c)" },
  { name: "أزرق", value: "linear-gradient(135deg,#4facfe,#00f2fe)" },
  { name: "أخضر", value: "linear-gradient(135deg,#43e97b,#38f9d7)" },
  { name: "برتقالي", value: "linear-gradient(135deg,#fa709a,#fee140)" },
  { name: "خزامي", value: "linear-gradient(135deg,#a18cd1,#fbc2eb)" },
  { name: "خوخي", value: "linear-gradient(135deg,#fccb90,#d57eeb)" },
  { name: "أزرق سماوي", value: "linear-gradient(135deg,#e0c3fc,#8ec5fc)" },
  { name: "أحمر", value: "linear-gradient(135deg,#f5576c,#ff6f91)" },
  { name: "كحلي", value: "linear-gradient(135deg,#30cfd0,#330867)" },
];

const TEXT_COLORS = [
  { name: "أبيض", value: "#ffffff" },
  { name: "أسود", value: "#000000" },
  { name: "ذهبي", value: "#ffd700" },
  { name: "أحمر", value: "#ff4444" },
  { name: "أزرق", value: "#4488ff" },
];

type StoryMode = "text" | "media";

interface StoryCreatorProps {
  open: boolean;
  onClose: () => void;
}

const StoryCreator = ({ open, onClose }: StoryCreatorProps) => {
  const [mode, setMode] = useState<StoryMode>("text");
  const [caption, setCaption] = useState("");
  const [bgColor, setBgColor] = useState(GRADIENTS[0].value);
  const [textColor, setTextColor] = useState(TEXT_COLORS[0].value);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string>("");
  const [mediaType, setMediaType] = useState<"image" | "video" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const socket = getSocket();

  const resetForm = () => {
    setMode("text");
    setCaption("");
    setBgColor(GRADIENTS[0].value);
    setTextColor(TEXT_COLORS[0].value);
    setMediaFile(null);
    setMediaPreview("");
    setMediaType(null);
    setIsSubmitting(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      showError("حجم الملف يجب أن لا يتجاوز 50 ميجابايت");
      return;
    }

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");

    if (!isImage && !isVideo) {
      showError("يرجى اختيار صورة أو فيديو");
      return;
    }

    // ضغط الصور فقط (وليس الفيديو)
    if (isImage) {
      try {
        const { compressImage, COMPRESS_PRESETS, getCompressionSummary } = await import("@/lib/image-compress");
        const result = await compressImage(file, COMPRESS_PRESETS.story);
        setMediaFile(result.file);
        setMediaType("image");
        setMediaPreview(URL.createObjectURL(result.file));
        if (result.compressionRatio < 1) {
          showSuccess(getCompressionSummary(result));
        }
        return;
      } catch {
        // Fallback: use original
      }
    }

    setMediaFile(file);
    setMediaType(isImage ? "image" : "video");
    setMediaPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    if (mode === "text" && !caption.trim()) {
      showError("يرجى كتابة نص للقصة");
      return;
    }

    // منع الروابط في النص
    if (/https?:\/\/[^\s]+/i.test(caption)) {
      showError("لا يُسمح بإدراج روابط في النص");
      return;
    }

    setIsSubmitting(true);

    try {
      let finalMediaUrl = "";
      let finalMediaType: "image" | "video" | "text" = mode === "text" ? "text" : mediaType || "image";

      if (mode === "media" && mediaFile) {
        const token = localStorage.getItem("authToken");
        const reader = new FileReader();
        finalMediaUrl = await new Promise((resolve, reject) => {
          reader.onload = async () => {
            const base64Data = reader.result as string;
            const ext = mediaFile.name.split(".").pop() || "jpg";
            try {
              const uploadRes = await fetch("/api/upload", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ file: base64Data.split(",")[1], filename: `story.${ext}`, contentType: mediaFile.type }),
              });
              const uploadData = await uploadRes.json();
              if (uploadData.success) resolve(uploadData.url);
              else reject(new Error(uploadData.message || "فشل رفع الملف"));
            } catch (e) { reject(e); }
          };
          reader.onerror = () => reject(new Error("فشل قراءة الملف"));
          reader.readAsDataURL(mediaFile);
        });
      }

      socket.emit("stories:create", {
        mediaUrl: finalMediaUrl,
        mediaType: finalMediaType,
        caption: caption.trim(),
        bgColor: mode === "text" ? bgColor : undefined,
        textColor: mode === "text" ? textColor : undefined,
      }, (response: any) => {
        setIsSubmitting(false);
        if (response?.success) {
          showSuccess("تم نشر القصة بنجاح");
          handleClose();
        } else {
          showError(response?.error || "فشل نشر القصة");
        }
      });
    } catch (err) {
      console.error("Story create error:", err);
      showError("حدث خطأ أثناء نشر القصة");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md rounded-3xl border border-slate-200 bg-white p-0 dark:border-slate-800 dark:bg-slate-950 max-h-[90dvh] overflow-hidden" dir="rtl" aria-describedby="story-creator-description">
        <div id="story-creator-description" className="sr-only">إنشاء قصة جديدة - نموذج إضافة قصة</div>
        <DialogHeader className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-black text-slate-900 dark:text-white">
              إنشاء قصة جديدة
            </DialogTitle>
            <button onClick={handleClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        <div className="space-y-5 overflow-y-auto p-5" style={{ maxHeight: "calc(90dvh - 80px)" }}>
          {/* Mode Toggle */}
          <div className="flex gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              onClick={() => setMode("text")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-all ${
                mode === "text" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Type className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              نص
            </button>
            <button
              onClick={() => setMode("media")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-all ${
                mode === "media" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Image className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              صورة / فيديو
            </button>
          </div>

          {/* Text Mode */}
          {mode === "text" && (
            <>
              {/* Gradients */}
              <div className="space-y-2">
                <Label className="text-xs font-bold text-slate-500">الخلفية</Label>
                <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                  {GRADIENTS.map((g) => (
                    <button
                      key={g.value}
                      onClick={() => setBgColor(g.value)}
                      className={`relative h-8 sm:h-10 w-full rounded-xl border-2 transition-all ${
                        bgColor === g.value ? "border-primary scale-105" : "border-transparent"
                      }`}
                      style={{ background: g.value }}
                      title={g.name}
                    >
                      {bgColor === g.value && (
                        <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
          )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Color */}
              <div className="space-y-2">
                <Label className="text-xs font-bold text-slate-500">لون النص</Label>
                <div className="flex gap-3">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => setTextColor(c.value)}
                      className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all ${
                        textColor === c.value ? "border-primary scale-110" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c.value }}
                      title={c.name}
                    >
                      {textColor === c.value && (
                        <Check className={`h-4 w-4 ${c.value === "#ffffff" ? "text-black" : "text-white"}`} />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div
                className="flex h-32 sm:h-48 items-center justify-center rounded-2xl p-4 sm:p-6 text-center"
                style={{ background: bgColor }}
              >
                {caption ? (
                  <p className="text-base sm:text-xl font-bold leading-relaxed" style={{ color: textColor }}>
                    {caption}
                  </p>
                ) : (
                  <p className="text-sm text-white/60">سيظهر النص هنا...</p>
                )}
              </div>
            </>
          )}

          {/* Media Mode */}
          {mode === "media" && (
            <div className="space-y-3">
              {mediaPreview ? (
                <div className="relative">
                  {mediaType === "video" ? (
                    <video src={mediaPreview} className="h-40 sm:h-64 w-full rounded-2xl object-contain bg-black" controls />
                  ) : (
                    <img src={mediaPreview} alt="" className="h-40 sm:h-64 w-full rounded-2xl object-contain bg-slate-100 dark:bg-slate-800" />
                  )}
                  <button
                    onClick={() => { setMediaFile(null); setMediaPreview(""); setMediaType(null); }}
                    className="absolute left-2 top-2 rounded-full bg-black/50 p-1.5 text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-32 sm:h-48 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400 transition-colors hover:border-primary hover:bg-primary/5 dark:border-slate-700 dark:bg-slate-900"
                >
                  <Camera className="h-8 w-8 sm:h-10 sm:w-10" />
                  <span className="text-xs sm:text-sm font-bold">اختر صورة أو فيديو</span>
                  <span className="text-[10px] font-bold">حد أقصى 50 ميجابايت</span>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileSelect} />
            </div>
          )}

          {/* Caption */}
          <div className="space-y-2">
            <Label className="text-xs font-bold text-slate-500">النص / التعليق</Label>
            <Input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={mode === "text" ? "اكتب قصتك..." : "أضف تعليقاً..."}
              className="rounded-xl border-slate-200 text-sm dark:border-slate-700"
              maxLength={500}
            />
          </div>

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full rounded-2xl py-4 sm:py-6 text-sm font-black shadow-lg shadow-primary/20"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                جاري النشر...
              </>
            ) : (
              "نشر القصة"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StoryCreator;
