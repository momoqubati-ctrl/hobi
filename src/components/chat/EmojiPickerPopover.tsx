import React, { useState, useRef, useEffect } from "react";
import { SmilePlus, ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchAnimatedFaces, AnimatedFace } from "@/lib/animatedFaceData";
import { useRealtimeStore } from "@/lib/realtime-store";
import { hasPermissionAccess } from "@/lib/permissionAccess";

const EMOJI_CATEGORIES = [
  {
    id: "animated",
    label: "فيسات متحركة",
    icon: "🎭",
    emojis: []
  },
  {
    id: "smileys",
    label: "وجوه وأشخاص",
    icon: "😀",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚",
      "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️",
      "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓",
      "🤗", "🤔", "🫣", "🤭", "🫢", "🫡", "🤫", "🫠", "🥱", "😴", "🤤", "😪", "😵", "😵‍💫", "🤐", "🥴", "🤢", "🤮", "🤧", "😷"
    ]
  },
  {
    id: "gestures",
    label: "حركات وجسم",
    icon: "👍",
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️",
      "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪"
    ]
  },
  {
    id: "hearts",
    label: "قلوب ورموز",
    icon: "❤️",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❤️‍🔥", "❤️‍🩹", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝",
      "💟", "💤", "💣", "💭", "💬", "❓", "❔", "❗️", "❕", "❌", "💯", "💥", "🎉", "🎊", "🎈", "🎁"
    ]
  },
  {
    id: "animals",
    label: "حيوانات وطبيعة",
    icon: "🐱",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🐤", "🦆",
      "🦅", "🦉", "🦇", "🐺", "🐝", "🦋", "🐌", "🐞", "🐜", "🕷️", "🕸️", "🦂", "🐢", "🐍", "🦎", "🐙", "🦑", "🦞", "🦀", "🐠"
    ]
  },
  {
    id: "food",
    label: "أطعمة وأشربة",
    icon: "🍕",
    emojis: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", " Tomato", "🍅", "🍆", "🥑", "🥦",
      "🍕", "🍔", "🍟", "🌭", "🥪", "🌮", "🌯", "🍳", "🍲", "🍿", "🍱", "🍣", "🍦", "🍩", "🍪", "🎂", "🍫", "🍬", "🍭", "☕"
    ]
  },
  {
    id: "travel",
    label: "سفر وأماكن",
    icon: "🚗",
    emojis: [
      "🚗", "🚕", "🚙", "🚌", "🏎️", "🚓", "🚑", "🚒", "🚐", "🚚", "🚜", "🛵", "🏍️", "🚲", "⚓", "⛵", "🚤", "🚢", "✈️", "🚀",
      "🚨", "🗺️", "🧭", "🏔️", "🌋", "🗻", "🏕️", "🏖️", "🏜️", "🏝️", "🏙️", "🏰", "⛪", "🕌", "🗽", "🗼", "💒", "🏢", "🏡", "🌌"
    ]
  },
  {
    id: "objects",
    label: "أشياء وأدوات",
    icon: "💡",
    emojis: [
      "⌚", "📱", "💻", "🖥️", "📸", "🎥", "📞", "☎️", "📻", "🎙️", "⏰", "⏳", "🔋", "🔌", "💡", " flashlight", "🔦", "🕯️", "💵", "💵",
      "🪙", "💰", "💳", "💎", "🔧", "🔨", "⚙️", "🧱", "🔗", "📎", "🔑", "🗝️", "🛡️", "⚔️", "🔬", "🔭", "💉", "💊", "🚪", "🛏️"
    ]
  },
  {
    id: "flags",
    label: "أعلام ودول",
    icon: "🚩",
    emojis: [
      "🏁", "🚩", "🎌", "🏴", "🏳️", "🏳️‍🌈", "🇸🇦", "🇪🇬", "🇦🇪", "🇶🇦", "🇰🇼", "🇧🇭", "🇴🇲", "🇯🇴", "🇵🇸", "🇱🇧", "🇸🇾", "🇮🇶", "🇾🇪", "🇩🇿"
    ]
  }
];

const EMOJI_KEYWORDS: Record<string, string[]> = {
  "ضحك": ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊"],
  "حب": ["😍", "🥰", "😘", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💕", "💞", "💓", "💗", "💖", "💘", "💝"],
  "حزين": ["😔", "😟", "😕", "🙁", "☹️", "🥺", "😢", "😭", "💔"],
  "غضب": ["😤", "😠", "😡", "🤬"],
  "قوة": ["💪", "⚡", "🔥"],
  "لايك": ["👍", "👌", "✌️"],
  "نعم": ["👍", "👌", "✌️"],
  "شكرا": ["🙏", "👏", "🙌"],
  "أهلا": ["👋"],
};

interface EmojiPanelProps {
  onEmojiSelect: (emoji: string) => void;
  onAnimatedFaceSelect?: (faceUrl: string) => void;
  search: string;
  setSearch: (val: string) => void;
  activeCategory: string;
  setActiveCategory: (val: string) => void;
  isOpen: boolean;
}

export const EmojiPanel: React.FC<EmojiPanelProps> = ({
  onEmojiSelect,
  onAnimatedFaceSelect,
  search,
  setSearch,
  activeCategory,
  setActiveCategory,
  isOpen
}) => {
  const [animatedFaces, setAnimatedFaces] = useState<AnimatedFace[]>([]);
  const permissions = useRealtimeStore((state) => state.userPermissions);
  const canUseAnimatedFaces = hasPermissionAccess(permissions, "chat_effects.use");
  const visibleCategory = !canUseAnimatedFaces && activeCategory === "animated" ? "smileys" : activeCategory;

  useEffect(() => {
    if (canUseAnimatedFaces && visibleCategory === "animated" && animatedFaces.length === 0) {
      fetchAnimatedFaces().then(setAnimatedFaces);
    }
  }, [canUseAnimatedFaces, visibleCategory, animatedFaces.length]);

  const getFilteredEmojis = () => {
    if (!search) {
      const cat = EMOJI_CATEGORIES.find(c => c.id === visibleCategory);
      return cat ? cat.emojis : [];
    }

    const matchingFromKeywords = Object.entries(EMOJI_KEYWORDS)
      .filter(([key]) => key.includes(search) || search.includes(key))
      .flatMap(([, list]) => list);

    const allEmojis = EMOJI_CATEGORIES.flatMap(c => c.emojis);
    const results = allEmojis.filter(emoji => matchingFromKeywords.includes(emoji));
    
    return results.length > 0 ? results : allEmojis.slice(0, 40);
  };

  const displayList = getFilteredEmojis();

  return (
    <div
      className={`w-full bg-inherit transition-all duration-300 ease-in-out origin-bottom overflow-hidden border-b border-border/40 ${
        isOpen ? "max-h-[220px] p-3 opacity-100" : "max-h-0 p-0 opacity-0 pointer-events-none"
      }`}
    >
      <div className="flex flex-col gap-3 max-w-7xl mx-auto">
        {/* Top Bar with Search & Category Header */}
        <div className="flex flex-col sm:flex-row gap-2 justify-between items-center border-b border-border/40 pb-2">
          {/* Categories Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto max-w-full pb-1 no-scrollbar select-none order-2 sm:order-1">
            {EMOJI_CATEGORIES.filter((category) => canUseAnimatedFaces || category.id !== "animated").map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setActiveCategory(cat.id);
                  setSearch("");
                }}
                className={`px-3 py-1.5 rounded-xl text-lg transition-all relative shrink-0 ${
                  visibleCategory === cat.id && !search
                    ? "bg-slate-100 dark:bg-slate-800 scale-105"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                }`}
                title={cat.label}
              >
                <span>{cat.icon}</span>
                {visibleCategory === cat.id && !search && (
                  <span className="absolute bottom-0 inset-x-3 h-0.5 bg-primary rounded-full" />
                )}
              </button>
            ))}
          </div>

          {/* Search Bar */}
          <div className="relative w-full sm:w-48 order-1 sm:order-2">
            <input
              type="text"
              placeholder="ابحث هنا..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-xs bg-slate-100 dark:bg-slate-800 border-none rounded-xl px-2.5 py-2 pr-7 focus:outline-none focus:ring-1 focus:ring-primary font-bold text-foreground"
              dir="rtl"
            />
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        {/* Emojis Grid */}
        <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-2 max-h-[140px] overflow-y-auto p-1 no-scrollbar select-none">
          {visibleCategory === "animated" ? (
            animatedFaces.map((face) => (
              <button
                key={face.id}
                type="button"
                onClick={() => onAnimatedFaceSelect?.(face.image_url)}
                className="hover:scale-125 active:scale-95 transition-transform flex items-center justify-center p-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                title={face.shortcut}
              >
                <img src={face.image_url} alt={face.name} className="object-contain" style={{ width: "40px", height: "40px" }} />
              </button>
            ))
          ) : (
            displayList.map((emoji, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onEmojiSelect(emoji)}
                className="text-2xl hover:scale-125 active:scale-95 transition-transform flex items-center justify-center p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {emoji}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// Default export acts as standard wrapper for other places (backwards compatibility)
interface EmojiPickerPopoverProps {
  onEmojiSelect: (emoji: string) => void;
  onAnimatedFaceSelect?: (faceUrl: string) => void;
  className?: string;
}

const EmojiPickerPopover: React.FC<EmojiPickerPopoverProps> = ({ onEmojiSelect, onAnimatedFaceSelect, className }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("animated");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        if (!target.closest("form") && !target.closest("[data-msg-actions]")) {
          setOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className={className} ref={containerRef}>
      {open ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-10 w-10 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition shadow-md shrink-0 z-50 relative animate-in zoom-in duration-100"
          title="إغلاق"
        >
          <ArrowLeft size={20} />
        </button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-xl text-muted-foreground hover:bg-muted hover:text-yellow-500 shrink-0 z-50 relative"
          onClick={() => setOpen(true)}
          title="إيموجي"
        >
          <SmilePlus size={20} />
        </Button>
      )}

      <div
        className={`absolute bottom-full left-0 right-0 w-full z-[-1] bg-white dark:bg-slate-900 border-t border-border shadow-xl p-3 transition-all duration-300 ease-out transform ${
          open ? "translate-y-0 opacity-100 pointer-events-auto" : "translate-y-full opacity-0 pointer-events-none"
        }`}
      >
        <EmojiPanel
          onEmojiSelect={onEmojiSelect}
          onAnimatedFaceSelect={onAnimatedFaceSelect}
          search={search}
          setSearch={setSearch}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          isOpen={open}
        />
      </div>
    </div>
  );
};

export default EmojiPickerPopover;
