import { useState, useEffect } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { getSocket } from "@/lib/socket";
import { toast } from "sonner";
import { Image, X, Loader2 } from "lucide-react";

interface IconPickerPopoverProps {
  trigger: React.ReactNode;
  profileId: string;
  type: "banner" | "gift_icon" | "promotion_icon";
  currentIconUrl?: string;
  onSelect: (iconUrl: string) => void;
  onRemove?: () => void;
}

type IconItem = {
  id: string;
  name: string;
  image_url: string;
  sort_order: number;
};

const TYPE_CONFIG = {
  banner: {
    title: "اختيار بنر",
    label: "البنر",
    fetchUrl: "/api/swiper-banners",
    responseKey: "banners",
    emptyText: "لا توجد بنرات متاحة",
    toastSuccess: "تم تخصيص البنر بنجاح",
    toastRemove: "تم إزالة البنر بنجاح",
  },
  gift_icon: {
    title: "اختيار ايقونة",
    label: "الايقونة",
    fetchUrl: "/api/icons",
    responseKey: "icons",
    emptyText: "لا توجد ايقونات متاحة",
    toastSuccess: "تم تخصيص الايقونة بنجاح",
    toastRemove: "تم إزالة الايقونة بنجاح",
  },
  promotion_icon: {
    title: "اختيار ايقونة ترقية",
    label: "ايقونة الترقية",
    fetchUrl: "/api/icons",
    responseKey: "icons",
    emptyText: "لا توجد ايقونات متاحة",
    toastSuccess: "تم تخصيص ايقونة الترقية بنجاح",
    toastRemove: "تم إزالة ايقونة الترقية بنجاح",
  },
};

export function IconPickerPopover({
  trigger,
  profileId,
  type,
  currentIconUrl,
  onSelect,
  onRemove,
}: IconPickerPopoverProps) {
  const socket = getSocket();
  const [open, setOpen] = useState(false);
  const [icons, setIcons] = useState<IconItem[]>([]);
  const [loading, setLoading] = useState(false);

  const config = TYPE_CONFIG[type];

  useEffect(() => {
    if (!open) return;

    setLoading(true);
    fetch(config.fetchUrl)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setIcons(data[config.responseKey] || []);
        }
      })
      .catch(() => {
        toast.error("تعذر جلب القائمة");
      })
      .finally(() => setLoading(false));
  }, [open, config.fetchUrl, config.responseKey]);

  const handleSelect = (iconUrl: string) => {
    const eventName =
      type === "banner"
        ? "profile:gift_banner"
        : type === "gift_icon"
          ? "profile:gift_gift_icon"
          : "profile:gift_promotion_icon";

    socket.emit(eventName, { profileId, iconUrl }, (res: any) => {
      if (res?.success) {
        toast.success(config.toastSuccess);
        onSelect(iconUrl);
        setOpen(false);
      } else {
        toast.error(res?.error || "تعذر تنفيذ العملية");
      }
    });
  };

  const handleRemove = () => {
    const eventName =
      type === "banner"
        ? "profile:remove_banner"
        : type === "gift_icon"
          ? "profile:remove_gift_icon"
          : "profile:remove_promotion_icon";

    socket.emit(eventName, { profileId }, (res: any) => {
      if (res?.success) {
        toast.success(config.toastRemove);
        onRemove?.();
        setOpen(false);
      } else {
        toast.error(res?.error || "تعذر تنفيذ العملية");
      }
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[320px] max-h-[400px] overflow-y-auto p-3"
        dir="rtl"
      >
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-black text-foreground">{config.title}</h4>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded-md hover:bg-muted transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {currentIconUrl && (
          <div className="mb-3 p-2 rounded-lg bg-muted/50 border border-border">
            <p className="text-[10px] font-bold text-muted-foreground mb-1">الحالي:</p>
            <div className="flex items-center gap-2">
              <img
                src={currentIconUrl}
                alt="current"
                className="h-8 w-8 rounded object-cover"
              />
              <button
                onClick={handleRemove}
                className="text-[10px] font-bold text-red-500 hover:text-red-600 transition"
              >
                إزالة
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : icons.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Image className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-xs font-bold">{config.emptyText}</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-1.5">
            {icons.map((icon) => (
              <button
                key={icon.id}
                onClick={() => handleSelect(icon.image_url)}
                className={`relative group p-0.5 rounded-lg border-2 transition hover:scale-105 ${
                  currentIconUrl === icon.image_url
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <img
                  src={icon.image_url}
                  alt=""
                  className="w-full h-14 rounded object-contain bg-muted"
                />
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
