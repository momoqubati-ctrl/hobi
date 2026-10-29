import React, { useEffect, useState } from "react";

interface SoundWaveProps {
  isActive?: boolean;
  color?: "cyan" | "emerald";
  barCount?: number;
  analyser?: AnalyserNode | null;
}

export const SoundWave: React.FC<SoundWaveProps> = ({
  isActive = true,
  color = "emerald",
  barCount = 14,
  analyser = null,
}) => {
  const [heights, setHeights] = useState<number[]>(() =>
    Array.from({ length: barCount }, () => 15)
  );

  useEffect(() => {
    if (!isActive) {
      setHeights(Array.from({ length: barCount }, () => 12));
      return;
    }

    // إذا وُجد AnalyserNode حقيقي من ميكروفون المستخدم
    if (analyser) {
      let animationFrameId: number;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateBars = () => {
        analyser.getByteFrequencyData(dataArray);
        // نأخذ عينات متفرقة من الترددات الصوتية لتغذية الأعمدة
        const step = Math.floor(bufferLength / barCount) || 1;
        const newHeights = Array.from({ length: barCount }, (_, i) => {
          const val = dataArray[i * step] || 0;
          return Math.max(12, Math.min(95, Math.round((val / 255) * 100)));
        });
        setHeights(newHeights);
        animationFrameId = requestAnimationFrame(updateBars);
      };

      updateBars();
      return () => cancelAnimationFrame(animationFrameId);
    }

    // بديل ديناميكي سلس إذا لم يكن الـ analyser متاحاً بعد
    const interval = setInterval(() => {
      setHeights(
        Array.from({ length: barCount }, () => Math.floor(Math.random() * 70) + 18)
      );
    }, 120);

    return () => clearInterval(interval);
  }, [isActive, barCount, analyser]);

  const colorClass =
    color === "emerald"
      ? "bg-gradient-to-t from-emerald-500 to-teal-300 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
      : "bg-gradient-to-t from-cyan-500 to-blue-400 shadow-[0_0_10px_rgba(6,182,212,0.5)]";

  return (
    <div className="flex items-center justify-center gap-1.5 h-14 px-4 py-2">
      {heights.map((h, i) => (
        <span
          key={i}
          className={`w-1 rounded-full transition-all duration-100 ease-out ${colorClass}`}
          style={{
            height: `${isActive ? h : 12}%`,
            opacity: isActive ? 0.9 : 0.35,
          }}
        />
      ))}
    </div>
  );
};
export default SoundWave;
