import React, { useState } from "react";
import { Eye, Heart, X } from "lucide-react";

interface ViewersOverlayProps {
  viewers: any[];
  likers: any[];
  onClose: () => void;
}

const ViewerOverlay = ({ viewers, likers, onClose }: ViewersOverlayProps) => {
  const [tab, setTab] = useState<"viewers" | "likers">("viewers");
  const list = tab === "viewers" ? viewers : likers;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm overflow-hidden rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        {/* Header */}
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
              {tab === "viewers" ? (
                <><Eye className="h-4 w-4 text-primary" /> المشاهدون</>
              ) : (
                <><Heart className="h-4 w-4 text-red-500" /> المعجبون</>
              )}
            </h3>
            <button onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setTab("viewers")}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
                tab === "viewers"
                  ? "bg-primary text-white"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              <Eye className="h-3 w-3" />
              <span>{viewers.length}</span>
              مشاهدة
            </button>
            <button
              onClick={() => setTab("likers")}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${
                tab === "likers"
                  ? "bg-red-500 text-white"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              <Heart className="h-3 w-3" />
              <span>{likers.length}</span>
              إعجاب
            </button>
          </div>
        </div>

        {/* List */}
        <div className="max-h-[60dvh] space-y-1 overflow-y-auto p-2">
          {list.length === 0 ? (
            <p className="py-8 text-center text-xs font-bold text-slate-400">
              {tab === "viewers" ? "لا يوجد مشاهدون بعد" : "لا يوجد معجبون بعد"}
            </p>
          ) : (
            list.map((item, i) => (
              <div
                key={`${item.id}-${i}`}
                className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900"
              >
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-slate-200 dark:border-slate-700">
                  <img
                    src={item.avatar || "/pic.png"}
                    alt={item.username}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-200">
                    {item.username}
                  </p>
                  <p className="truncate text-[10px] font-bold text-slate-400">
                    {item.viewedAt
                      ? new Date(item.viewedAt).toLocaleString("ar", {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "2-digit",
                          month: "short",
                        })
                      : ""}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ViewerOverlay;
