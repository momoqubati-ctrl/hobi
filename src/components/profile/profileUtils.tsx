import React from "react";

export interface UserLevelInfo {
  level: number;
  percentage: number;
  currentPoints: number;
  nextLevelPoints: number;
  remainingPoints: number;
}

export const getRankName = (evaluation: number = 0) => {
  const points = Number(evaluation) || 0;
  if (points >= 500) return "ماسي";
  if (points >= 200) return "برونزي";
  if (points >= 75) return "فضي";
  return "عضو نشط";
};

export const getNextRankAt = (evaluation: number = 0) => {
  const points = Number(evaluation) || 0;
  if (points >= 500) return 500;
  if (points >= 200) return 500;
  if (points >= 75) return 200;
  return 75;
};

export function calculateUserLevel(
  evaluation: number = 0,
  explicitLevel?: number,
  explicitPercentage?: number
): UserLevelInfo {
  const points = Math.max(0, Number(evaluation) || 0);

  if (explicitLevel && explicitLevel > 0) {
    const percentage =
      explicitPercentage !== undefined && explicitPercentage >= 0
        ? Math.min(100, Math.round(explicitPercentage))
        : points === 0
        ? 20
        : Math.min(100, Math.max(5, Math.round((points % 100))));

    return {
      level: explicitLevel,
      percentage,
      currentPoints: points,
      nextLevelPoints: explicitLevel * 100,
      remainingPoints: Math.max(0, explicitLevel * 100 - points),
    };
  }

  const thresholds = [
    0, 100, 250, 500, 1000, 2000, 3500, 5000, 7500, 10000, 15000, 25000, 50000, 100000
  ];

  let currentLevel = 1;
  let prevThreshold = 0;
  let nextThreshold = thresholds[1];

  for (let i = 0; i < thresholds.length - 1; i++) {
    if (points >= thresholds[i]) {
      currentLevel = i + 1;
      prevThreshold = thresholds[i];
      nextThreshold = thresholds[i + 1];
    } else {
      break;
    }
  }

  const range = Math.max(1, nextThreshold - prevThreshold);
  const progressInLevel = points - prevThreshold;
  const rawPercentage = Math.min(100, Math.max(0, Math.round((progressInLevel / range) * 100)));
  
  // إذا كانت النقاط 0، يظهر تقدم أولي 20% نحو المستوى التالي كما هو معروض في التصميم المرجعي
  const percentage = points === 0 ? 20 : Math.max(5, rawPercentage);

  return {
    level: currentLevel,
    percentage,
    currentPoints: points,
    nextLevelPoints: nextThreshold,
    remainingPoints: Math.max(0, nextThreshold - points),
  };
}

export const formatNumber = (value: number | undefined | null) => {
  if (value === undefined || value === null) return "لا توجد بيانات حالياً";
  const num = Number(value);
  if (isNaN(num)) return "لا توجد بيانات حالياً";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(num);
};

export function VerifiedBadge({ className = "w-5 h-5 text-blue-500 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-label="حساب موثق">
      <path d="M22.5 12.5c0-1.58-.8-2.97-2-3.8.4-1.5-.1-3.1-1.4-4.1s-2.9-.9-4.3-.2C13.8 3.3 12.4 2.5 11 2.5s-2.8.8-3.8 1.9c-1.4-.7-3-.8-4.3.2s-1.8 2.6-1.4 4.1c-1.2.8-2 2.2-2 3.8s.8 2.9 2 3.8c-.4 1.5.1 3.1 1.4 4.1 1.3 1 2.9.9 4.3.2 1 1.1 2.4 1.9 3.8 1.9s2.8-.8 3.8-1.9c1.4.7 3 .8 4.3-.2s1.8-2.6 1.4-4.1c1.2-.9 2-2.2 2-3.8zm-11.8 4.6l-4.2-4.2 1.4-1.4 2.8 2.8 6.8-6.8 1.4 1.4-8.2 8.2z" />
    </svg>
  );
}

export function LevelShieldBadge({ level = 1, className = "w-12 h-14" }: { level?: number; className?: string }) {
  return (
    <div className={`relative ${className} shrink-0 flex items-center justify-center select-none`}>
      <svg className="absolute inset-0 w-full h-full drop-shadow-[0_4px_14px_rgba(59,130,246,0.6)]" viewBox="0 0 48 56" fill="none">
        <defs>
          <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="50%" stopColor="#1d4ed8" />
            <stop offset="100%" stopColor="#1e1b4b" />
          </linearGradient>
          <linearGradient id="shieldBorder" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#93c5fd" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <path
          d="M24 2L44 9V26C44 40.5 35.5 50.8 24 54C12.5 50.8 4 40.5 4 26V9L24 2Z"
          fill="url(#shieldGrad)"
          stroke="url(#shieldBorder)"
          strokeWidth="2"
        />
        <path
          d="M24 6L40 12V25C40 37.5 33 46.5 24 49.5C15 46.5 8 37.5 8 25V12L24 6Z"
          fill="#3b82f6"
          fillOpacity="0.25"
        />
      </svg>
      <span className="relative z-10 text-xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
        {level}
      </span>
    </div>
  );
}
