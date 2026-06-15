"use client";

import React, { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Upload, Save, X, Smile } from "lucide-react";

interface AnimatedFace {
  id: string;
  shortcut: string;
  name: string;
  image_url: string;
  sort_order: number;
}

const AnimatedFacesSection = () => {
  const [faces, setFaces] = useState<AnimatedFace[]>([]);
  const [loading, setLoading] = useState(true);
  const [newShortcut, setNewShortcut] = useState("");
  const [newName, setNewName] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editShortcut, setEditShortcut] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : "";

  const authHeaders = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  const fetchFaces = async () => {
    try {
      const res = await fetch("/api/admin/animated-faces", { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setFaces(data.faces);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchFaces(); }, []);

  const handleUploadImage = async (file: File) => {
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error("فشل قراءة الملف"));
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/wall/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ file: base64, filename: file.name, contentType: file.type }),
      });
      const data = await res.json();
      if (data.success) setNewImageUrl(data.url);
    } catch (e) { console.error(e); }
    setUploading(false);
  };

  const handleCreate = async () => {
    if (!newShortcut.trim() || !newImageUrl) return;
    try {
      const res = await fetch("/api/admin/animated-faces", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ shortcut: newShortcut.trim(), name: newName.trim(), image_url: newImageUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setFaces((prev) => [...prev, data.face]);
        setNewShortcut("");
        setNewName("");
        setNewImageUrl("");
        setShowAdd(false);
      } else {
        alert(data.message);
      }
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("هل تريد حذف هذا الفيس؟")) return;
    try {
      const res = await fetch(`/api/admin/animated-faces/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) setFaces((prev) => prev.filter((f) => f.id !== id));
    } catch (e) { console.error(e); }
  };

  const handleUpdateShortcut = async (id: string) => {
    if (!editShortcut.trim()) return;
    try {
      const res = await fetch("/api/admin/animated-faces", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ shortcut: editShortcut.trim(), image_url: faces.find((f) => f.id === id)?.image_url }),
      });
      const data = await res.json();
      if (data.success) {
        setFaces((prev) => prev.map((f) => f.id === id ? { ...f, shortcut: editShortcut.trim() } : f));
        setEditingId(null);
      } else {
        alert(data.message);
      }
    } catch (e) { console.error(e); }
  };

  if (loading) return <div className="p-6 text-center text-muted-foreground">جاري التحميل...</div>;

  return (
    <div className="p-4 space-y-4 rtl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">الفيسات المتحركة</h2>
          <p className="text-xs text-muted-foreground">اختصارات تُرسل كفيسات متحركة في الغرف (مثال: ف1، ف2...)</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:bg-primary/90 transition"
        >
          <Plus size={14} /> فيس جديد
        </button>
      </div>

      {/* نموذج الإضافة */}
      {showAdd && (
        <div className="p-3 bg-muted/50 rounded-xl border border-border space-y-3">
          <div className="flex items-start gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) handleUploadImage(e.target.files[0]);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-20 h-20 rounded-xl border-2 border-dashed border-border hover:border-primary bg-background flex items-center justify-center overflow-hidden transition shrink-0"
            >
              {uploading ? (
                <span className="text-[10px] text-muted-foreground">...</span>
              ) : newImageUrl ? (
                <img src={newImageUrl} className="w-full h-full object-contain" alt="" />
              ) : (
                <Smile size={24} className="text-muted-foreground" />
              )}
            </button>
            <div className="flex-1 space-y-2">
              <input
                type="text"
                value={newShortcut}
                onChange={(e) => setNewShortcut(e.target.value)}
                placeholder="الاختصار (مثال: ف1)"
                className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-background"
              />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="الاسم (اختياري)"
                className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-background"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-bold hover:bg-green-600 transition">
              <Save size={12} /> حفظ
            </button>
            <button onClick={() => { setShowAdd(false); setNewImageUrl(""); }} className="flex items-center gap-1 px-3 py-1.5 bg-muted text-muted-foreground rounded-lg text-xs font-bold hover:bg-muted/80 transition">
              <X size={12} /> إلغاء
            </button>
          </div>
        </div>
      )}

      {/* قائمة الفيسات */}
      {faces.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          <Smile size={40} className="mx-auto mb-2 opacity-50" />
          لا يوجد فيسات بعد. اضغط "فيس جديد" لإضافة.
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {faces.map((face) => (
            <div key={face.id} className="group relative flex flex-col items-center p-3 bg-muted/50 rounded-xl border border-border hover:border-primary/30 transition">
              <img src={face.image_url} alt={face.name} className="w-16 h-16 object-contain mb-2" />
              {editingId === face.id ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={editShortcut}
                    onChange={(e) => setEditShortcut(e.target.value)}
                    className="w-16 text-center text-xs border border-border rounded px-1 py-0.5 bg-background"
                    onKeyDown={(e) => e.key === "Enter" && handleUpdateShortcut(face.id)}
                  />
                  <button onClick={() => handleUpdateShortcut(face.id)} className="text-green-500 hover:text-green-600">
                    <Save size={12} />
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingId(face.id); setEditShortcut(face.shortcut); }}
                  className="text-xs font-bold text-primary hover:underline"
                >
                  {face.shortcut}
                </button>
              )}
              {face.name && <span className="text-[10px] text-muted-foreground">{face.name}</span>}
              <button
                onClick={() => handleDelete(face.id)}
                className="absolute top-1 right-1 p-1 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AnimatedFacesSection;
