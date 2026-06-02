import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, Heart, X } from "lucide-react";

export type Viewer = {
  id: string;
  username: string;
  avatar: string;
  viewedAt: string;
};

interface ViewersDialogProps {
  open: boolean;
  onClose: () => void;
  viewers: Viewer[];
  likers: Viewer[];
}

const ViewersDialog = ({ open, onClose, viewers, likers }: ViewersDialogProps) => {
  const [tab, setTab] = useState<"viewers" | "likers">("viewers");

  const list = tab === "viewers" ? viewers : likers;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm rounded-3xl border border-slate-200 bg-white p-0 dark:border-slate-800 dark:bg-slate-950" dir="rtl">
        <DialogHeader className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
              {tab === "viewers" ? (
                <><Eye className="h-4 w-4 text-primary" /> المشاهدون</>
              ) : (
                <><Heart className="h-4 w-4 text-red-500" /> المعجبون</>
              )}
            </DialogTitle>
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
        </DialogHeader>

        <div className="max-h-[60dvh] space-y-1 overflow-y-auto p-2">
          {list.length === 0 ? (
            <p className="py-8 text-center text-xs font-bold text-slate-400">
              {tab === "viewers" ? "لا يوجد مشاهدون بعد" : "لا يوجد معجبون بعد"}
            </p>
          ) : (
            list.map((item) => (
              <div
                key={`${item.id}-${item.viewedAt}`}
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
                    {new Date(item.viewedAt).toLocaleString("ar", {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "short",
                    })}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ViewersDialog;
