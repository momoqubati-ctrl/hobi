import React, { useState, useEffect, useRef } from "react";
import { ProfileModal } from "@/components/profile/ProfileModal";
import { mockSocketInstance } from "./mockSocket";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

interface BenchmarkRun {
  id: number;
  type: "TB-01 (Journey)" | "TB-02 (Motion/FPS)";
  targetUser: string;
  simulatedLatency: number;
  t0_click: number;
  t1_state: number;
  t2_socket_emit: number;
  t3_skeleton_mount: number;
  t4_data_resolved: number;
  t5_final_render: number;
  totalJourneyMs: number;
  fps: number;
  droppedFrames: number;
  maxFrameDurationMs: number;
}

export function ProfileModalHarness() {
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(true);
  const [simulatedLatency, setSimulatedLatency] = useState<number>(0);
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [liveFps, setLiveFps] = useState<number>(0);
  const [isRecording, setIsRecording] = useState<boolean>(false);

  // Timings refs
  const t0Ref = useRef<number>(0);
  const t1Ref = useRef<number>(0);
  const t3Ref = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const frameTimesRef = useRef<number[]>([]);

  // Update socket latency
  useEffect(() => {
    mockSocketInstance.setLatency(simulatedLatency);
  }, [simulatedLatency]);

  // Set fake user in localStorage so ProfileModal can determine effective admin
  useEffect(() => {
    localStorage.setItem(
      "user",
      JSON.stringify({
        id: "user-admin-self",
        username: "المدير_العام",
        role: "owner",
        power: "ispower",
        permissions: ["admin", "cpanel"],
      })
    );
  }, []);

  // Frame rate recorder during transitions
  const startFpsTracking = () => {
    frameTimesRef.current = [];
    let lastTime = performance.now();

    const trackFrame = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;
      frameTimesRef.current.push(delta);

      if (frameTimesRef.current.length > 5) {
        const recent = frameTimesRef.current.slice(-10);
        const avgDelta = recent.reduce((a, b) => a + b, 0) / recent.length;
        setLiveFps(Math.round(1000 / avgDelta));
      }

      rafIdRef.current = requestAnimationFrame(trackFrame);
    };

    rafIdRef.current = requestAnimationFrame(trackFrame);
  };

  const stopFpsTracking = (): { avgFps: number; dropped: number; maxFrame: number } => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    const deltas = frameTimesRef.current;
    if (deltas.length === 0) return { avgFps: 60, dropped: 0, maxFrame: 16.6 };

    const totalTime = deltas.reduce((a, b) => a + b, 0);
    const avgFps = Math.round((deltas.length / totalTime) * 1000);
    const dropped = deltas.filter((d) => d > 18.0).length; // > 18ms means dropped on 60Hz
    const maxFrame = Math.round(Math.max(...deltas) * 10) / 10;

    return { avgFps, dropped, maxFrame };
  };

  const handleOpenProfile = (userId: string) => {
    const t0 = performance.now();
    t0Ref.current = t0;
    setIsRecording(true);
    startFpsTracking();

    setActiveProfileId(userId);
    t1Ref.current = performance.now();

    // Use MutationObserver to detect DOM mounting of DialogContent (T3) and final render (T5)
    const observer = new MutationObserver(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog && t3Ref.current === 0) {
        t3Ref.current = performance.now();
      }

      // Check if real user display name appears inside the modal (T5)
      const userHeading = dialog?.querySelector("h2");
      if (userHeading && userHeading.textContent && userHeading.textContent.trim().length > 0) {
        const t5 = performance.now();
        observer.disconnect();

        // Give animation a moment to settle (350ms transition)
        setTimeout(() => {
          const fpsStats = stopFpsTracking();
          const t2 = mockSocketInstance.lastEmitTimestamps.get("profile:view") || t1Ref.current;
          const t3 = t3Ref.current || t1Ref.current + 10;
          const t4 = t2 + simulatedLatency;

          const newRun: BenchmarkRun = {
            id: Date.now(),
            type: "TB-01 (Journey)",
            targetUser: userId,
            simulatedLatency,
            t0_click: 0,
            t1_state: Math.round((t1Ref.current - t0) * 10) / 10,
            t2_socket_emit: Math.round((t2 - t0) * 10) / 10,
            t3_skeleton_mount: Math.round((t3 - t0) * 10) / 10,
            t4_data_resolved: Math.round((t4 - t0) * 10) / 10,
            t5_final_render: Math.round((t5 - t0) * 10) / 10,
            totalJourneyMs: Math.round((t5 - t0) * 10) / 10,
            fps: fpsStats.avgFps,
            droppedFrames: fpsStats.dropped,
            maxFrameDurationMs: fpsStats.maxFrame,
          };

          setRuns((prev) => [newRun, ...prev]);
          setIsRecording(false);
          t3Ref.current = 0;
        }, 400);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  };

  const handleCloseProfile = () => {
    startFpsTracking();
    setActiveProfileId(null);
    setTimeout(() => {
      const stats = stopFpsTracking();
      const newRun: BenchmarkRun = {
        id: Date.now(),
        type: "TB-02 (Motion/FPS)",
        targetUser: "Closing Animation",
        simulatedLatency,
        t0_click: 0,
        t1_state: 0,
        t2_socket_emit: 0,
        t3_skeleton_mount: 0,
        t4_data_resolved: 0,
        t5_final_render: 0,
        totalJourneyMs: 0,
        fps: stats.avgFps,
        droppedFrames: stats.dropped,
        maxFrameDurationMs: stats.maxFrame,
      };
      setRuns((prev) => [newRun, ...prev]);
    }, 350);
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-slate-950 text-slate-100 p-8 font-sans" dir="rtl">
        {/* Header */}
        <div className="max-w-5xl mx-auto mb-8 border-b border-slate-800 pb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
              بيئة القياس المعزولة لمكون الملف الشخصي (TB-01 & TB-02 Isolated Harness)
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              تعمل بدون خادم خلفي، وبدون اتصال بقاعدة البيانات، وتعتمد على محاكاة السوكت المعزولة.
            </p>
          </div>
          <div className="flex items-center gap-4 bg-slate-900 border border-slate-800 px-4 py-2 rounded-xl">
            <span className="text-xs text-slate-400">FPS اللحظي:</span>
            <span className={`text-xl font-mono font-bold ${liveFps < 50 ? "text-amber-400" : "text-emerald-400"}`}>
              {liveFps > 0 ? liveFps : "--"}
            </span>
          </div>
        </div>

        {/* Controls Grid */}
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Action 1: Open Standard */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">اختبار TB-01</div>
              <h3 className="text-base font-bold text-white mb-2">فتح بروفايل مستخدم عادي</h3>
              <p className="text-xs text-slate-400 mb-4">
                يقيس دورة الحياة $T_0 \to T_5$ كاملة ببيانات محاكاة مطابقة لقاعدة البيانات.
              </p>
            </div>
            <button
              onClick={() => handleOpenProfile("user-standard-1")}
              disabled={isRecording || activeProfileId !== null}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-xl transition shadow-lg shadow-blue-500/20 text-sm"
            >
              فتح بروفايل (سارة أحمد)
            </button>
          </div>

          {/* Action 2: Open Admin */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-1">اختبار TB-02</div>
              <h3 className="text-base font-bold text-white mb-2">فتح بروفايل مدير النظام (Self)</h3>
              <p className="text-xs text-slate-400 mb-4">
                يختبر تصيير أدوات الإدارة والإحصائيات الكبيرة وتأثير الأنماط الرسومية.
              </p>
            </div>
            <button
              onClick={() => handleOpenProfile("user-admin-self")}
              disabled={isRecording || activeProfileId !== null}
              className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium rounded-xl transition shadow-lg shadow-purple-500/20 text-sm"
            >
              فتح بروفايل (المدير العام)
            </button>
          </div>

          {/* Settings */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
            <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1">إعدادات المحاكاة</div>
            <h3 className="text-base font-bold text-white mb-3">تأخير السوكت المحاكى</h3>
            <div className="space-y-3">
              <div className="flex gap-2">
                {[0, 50, 150].map((ms) => (
                  <button
                    key={ms}
                    onClick={() => setSimulatedLatency(ms)}
                    className={`flex-1 py-1.5 text-xs rounded-lg font-mono transition border ${
                      simulatedLatency === ms
                        ? "bg-amber-500/20 border-amber-500 text-amber-300 font-bold"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-750"
                    }`}
                  >
                    {ms}ms
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                {simulatedLatency === 0 ? "استجابة فورية (قياس سرعة الواجهة الصرفة)" : `محاكاة تأخير شبكي قدره ${simulatedLatency}ms`}
              </p>
              {activeProfileId && (
                <button
                  onClick={handleCloseProfile}
                  className="w-full mt-2 py-2 px-3 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-medium transition"
                >
                  إغلاق النافذة وقياس إطارات الإغلاق
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Telemetry Results Table */}
        <div className="max-w-5xl mx-auto bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="font-bold text-white text-sm flex items-center gap-2">
              📊 سجل نتائج القياسات اللحظية (Benchmark Results Log)
            </h3>
            {runs.length > 0 && (
              <button
                onClick={() => setRuns([])}
                className="text-xs text-slate-400 hover:text-rose-400 transition"
              >
                مسح السجل
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">#</th>
                  <th className="py-3 px-4">نوع الاختبار</th>
                  <th className="py-3 px-4">المستخدم</th>
                  <th className="py-3 px-4">تأخير السوكت</th>
                  <th className="py-3 px-4 font-mono">T1 (State)</th>
                  <th className="py-3 px-4 font-mono">T2 (Emit)</th>
                  <th className="py-3 px-4 font-mono">T3 (Skeleton)</th>
                  <th className="py-3 px-4 font-mono">T5 (Render)</th>
                  <th className="py-3 px-4 font-mono text-emerald-400">إجمالي الرحلة</th>
                  <th className="py-3 px-4 font-mono text-blue-400">FPS</th>
                  <th className="py-3 px-4 font-mono text-rose-400">Dropped Frames</th>
                  <th className="py-3 px-4 font-mono">Max Frame</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-8 text-center text-slate-500 font-sans">
                      لا توجد قياسات مسجلة بعد. اضغط على أزرار فتح البروفايل لبدء الاختبار.
                    </td>
                  </tr>
                ) : (
                  runs.map((r, i) => (
                    <tr key={r.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-2.5 px-4 text-slate-500">{runs.length - i}</td>
                      <td className="py-2.5 px-4 font-sans font-medium text-slate-300">{r.type}</td>
                      <td className="py-2.5 px-4 font-sans text-slate-400">{r.targetUser}</td>
                      <td className="py-2.5 px-4 text-slate-400">{r.simulatedLatency}ms</td>
                      <td className="py-2.5 px-4 text-slate-300">{r.t1_state}ms</td>
                      <td className="py-2.5 px-4 text-slate-300">{r.t2_socket_emit}ms</td>
                      <td className="py-2.5 px-4 text-slate-300">{r.t3_skeleton_mount}ms</td>
                      <td className="py-2.5 px-4 text-slate-300">{r.t5_final_render}ms</td>
                      <td className="py-2.5 px-4 font-bold text-emerald-400">{r.totalJourneyMs}ms</td>
                      <td className="py-2.5 px-4 font-bold text-blue-400">{r.fps}</td>
                      <td className={`py-2.5 px-4 font-bold ${r.droppedFrames > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                        {r.droppedFrames}
                      </td>
                      <td className="py-2.5 px-4 text-slate-300">{r.maxFrameDurationMs}ms</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* The Component Under Test */}
        <ProfileModal
          profileId={activeProfileId}
          onClose={handleCloseProfile}
          isAdmin={isAdmin}
          onMessage={(id) => console.log("[Harness] Message clicked for:", id)}
        />

        <Sonner position="top-center" />
      </div>
    </TooltipProvider>
  );
}
