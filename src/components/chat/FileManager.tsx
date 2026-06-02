"use client";

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Upload, Trash2, Edit3, FolderPlus, File, Image, Film, Music, Archive, FileText, ChevronRight, HardDrive } from 'lucide-react';
import { Badge } from "@/components/ui/badge";

interface FileItem {
  id: string;
  name: string;
  folderPath: string;
  isFolder: boolean;
  mimeType: string | null;
  size: number;
  storagePath: string | null;
  createdAt: string;
}

const getStoredUser = () => {
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
};

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "الآن";
  if (diff < 3600000) return `منذ ${Math.floor(diff / 60000)} د`;
  if (diff < 86400000) return `منذ ${Math.floor(diff / 3600000)} س`;
  return d.toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
};

const FileIcon = ({ mimeType, isFolder, name }: { mimeType?: string | null; isFolder: boolean; name: string }) => {
  if (isFolder) return <FolderIcon />;
  if (!mimeType) return <File size={32} className="text-slate-400" />;
  if (mimeType.startsWith("image/")) return <Image size={32} className="text-green-500" />;
  if (mimeType.startsWith("video/")) return <Film size={32} className="text-purple-500" />;
  if (mimeType.startsWith("audio/")) return <Music size={32} className="text-pink-500" />;
  if (mimeType.includes("zip") || mimeType.includes("rar")) return <Archive size={32} className="text-amber-500" />;
  if (mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("sheet") || name.endsWith(".txt") || name.endsWith(".csv")) return <FileText size={32} className="text-blue-500" />;
  return <File size={32} className="text-slate-400" />;
};

const FolderIcon = () => <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>;

const FileManager = () => {
  const currentUser = getStoredUser();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState("/");
  const [pathHistory, setPathHistory] = useState<string[]>(["/"]);
  const [quota, setQuota] = useState({ used: 0, total: 500 * 1024 * 1024, filesCount: 0 });
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const fetchFiles = useCallback(async (folder: string) => {
    if (!currentUser) return;
    try {
      const res = await fetch(`/api/files?userId=${currentUser.id}&folder=${encodeURIComponent(folder)}`);
      const data = await res.json();
      if (data.success) setFiles(data.files);
    } catch (err) {
      console.error("Failed to fetch files", err);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  const fetchQuota = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(`/api/files/quota?userId=${currentUser.id}`);
      const data = await res.json();
      if (data.success) setQuota({ used: data.used, total: data.total, filesCount: data.filesCount });
    } catch {}
  }, [currentUser?.id]);

  useEffect(() => { fetchFiles(currentPath); fetchQuota(); }, [currentPath, fetchFiles, fetchQuota]);

  const navigateToFolder = (folderPath: string, folderName: string) => {
    const newPath = folderPath === "/" ? `/${folderName}/` : `${folderPath}${folderName}/`;
    setPathHistory(prev => [...prev, newPath]);
    setCurrentPath(newPath);
  };

  const goBack = () => {
    if (pathHistory.length <= 1) return;
    const newHistory = pathHistory.slice(0, -1);
    setPathHistory(newHistory);
    setCurrentPath(newHistory[newHistory.length - 1]);
  };

  const refresh = () => { fetchFiles(currentPath); fetchQuota(); };

  const handleCreateFolder = async () => {
    const name = prompt("اسم المجلد الجديد:");
    if (!name?.trim()) return;
    try {
      const res = await fetch("/api/files/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser!.id, name: name.trim(), parentPath: currentPath }),
      });
      const data = await res.json();
      if (data.success) refresh();
      else alert(data.message);
    } catch {}
  };

  const handleRename = async (file: FileItem) => {
    const newName = prompt("الاسم الجديد:", file.name);
    if (!newName?.trim() || newName.trim() === file.name) return;
    try {
      const res = await fetch(`/api/files/${file.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser!.id, name: newName.trim() }),
      });
      const data = await res.json();
      if (data.success) refresh();
      else alert(data.message);
    } catch {}
  };

  const handleDelete = async (file: FileItem) => {
    if (!confirm(`حذف "${file.name}"؟ ${file.isFolder ? "سيتم حذف كل الملفات داخله." : ""}`)) return;
    try {
      const res = await fetch(`/api/files/${file.id}?userId=${currentUser!.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) refresh();
      else alert(data.message);
    } catch {}
  };

  const handleUpload = async () => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      let uploadFile = file;

      // ضغط الصور فقط
      if (file.type.startsWith("image/") && !file.type.includes("svg")) {
        try {
          const { compressImage, COMPRESS_PRESETS } = await import("@/lib/image-compress");
          const result = await compressImage(file, COMPRESS_PRESETS.wallPost);
          uploadFile = result.file;
        } catch {}
      }

      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        try {
          const res = await fetch("/api/files/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: currentUser!.id, file: base64, filename: uploadFile.name, folder: currentPath }),
          });
          const data = await res.json();
          if (data.success) refresh();
          else alert(data.message);
        } catch {}
      };
      reader.readAsDataURL(uploadFile);
    };
    fileInput.click();
  };

  const getBreadcrumbs = () => {
    const parts = currentPath.split("/").filter(Boolean);
    return [{ name: "الرئيسية", path: "/" }, ...parts.map((p, i) => ({ name: p, path: "/" + parts.slice(0, i + 1).join("/") + "/" }))];
  };
  const breadcrumbs = getBreadcrumbs();

  const isImage = (f: FileItem) => f.mimeType?.startsWith("image/");

  return (
    <div className="flex flex-col h-full rtl">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-1.5">
          {pathHistory.length > 1 && (
            <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500">
              <ChevronRight size={18} />
            </button>
          )}
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={b.path}>
              {i > 0 && <span className="text-slate-300 text-[10px]">/</span>}
              <button
                onClick={() => { setPathHistory(prev => [...prev.slice(0, i + 1)]); setCurrentPath(b.path); }}
                className={`text-[11px] font-bold px-1.5 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 ${
                  i === breadcrumbs.length - 1 ? "text-primary" : "text-slate-500"
                }`}
              >
                {b.name}
              </button>
            </React.Fragment>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleCreateFolder} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500" title="مجلد جديد">
            <FolderPlus size={16} />
          </button>
          <button onClick={handleUpload} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-primary" title="رفع ملف">
            <Upload size={16} />
          </button>
          <button onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500" title="تغيير العرض">
            <File size={16} />
          </button>
        </div>
      </div>

      {/* Quota bar */}
      <div className="px-4 py-2 border-b border-border/30 bg-slate-50/30 dark:bg-slate-900/30">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-bold text-muted-foreground flex items-center gap-1">
            <HardDrive size={10} /> {formatSize(quota.used)} / {formatSize(quota.total)}
          </span>
          <span className="text-[9px] font-bold text-muted-foreground">{quota.filesCount} ملف</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, (quota.used / quota.total) * 100)}%` }} />
        </div>
      </div>

      {/* Upload button (mobile-friendly) */}
      <div className="px-4 py-2 border-b border-border/30">
        <Button onClick={handleUpload} size="sm" className="w-full rounded-xl text-xs font-black gap-1.5 h-8">
          <Upload size={14} /> رفع ملف
        </Button>
      </div>

      {/* File grid / list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" size={20} /></div>
        ) : files.length === 0 ? (
          <div className="text-center py-16">
            <File size={40} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm font-bold text-slate-400">المجلد فارغ</p>
            <p className="text-[10px] text-slate-400 mt-1">ارفع ملفات أو أنشئ مجلداً جديداً</p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-3">
            {files.map((f) => (
              <div
                key={f.id}
                className="group relative flex flex-col items-center gap-2 p-4 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-all border border-transparent hover:border-border/50"
                onClick={() => { if (f.isFolder) navigateToFolder(f.folderPath, f.name); }}
              >
                {f.isFolder ? (
                  <FolderIcon />
                ) : isImage(f) ? (
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-100">
                    <img src={`/${f.storagePath}`} alt={f.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  </div>
                ) : (
                  <FileIcon mimeType={f.mimeType} isFolder={false} name={f.name} />
                )}
                <span className="text-[10px] font-bold text-center truncate w-full">{f.name}</span>
                <span className="text-[8px] text-muted-foreground">{f.isFolder ? formatTime(f.createdAt) : formatSize(f.size)}</span>

                {/* Actions overlay */}
                <div className="absolute top-2 left-2 hidden group-hover:flex gap-1">
                  <button onClick={(e) => { e.stopPropagation(); handleRename(f); }} className="p-1 rounded-md bg-white dark:bg-slate-800 shadow border border-border/50 text-slate-500 hover:text-primary">
                    <Edit3 size={12} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(f); }} className="p-1 rounded-md bg-white dark:bg-slate-800 shadow border border-border/50 text-slate-500 hover:text-red-500">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {files.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-all"
                onClick={() => { if (f.isFolder) navigateToFolder(f.folderPath, f.name); }}
              >
                {f.isFolder ? <FolderIcon /> : <FileIcon mimeType={f.mimeType} isFolder={false} name={f.name} />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{f.name}</p>
                  <p className="text-[9px] text-muted-foreground">{f.isFolder ? formatTime(f.createdAt) : `${formatSize(f.size)} • ${formatTime(f.createdAt)}`}</p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={(e) => { e.stopPropagation(); handleRename(f); }} className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-primary">
                    <Edit3 size={13} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(f); }} className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-red-500">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileManager;
