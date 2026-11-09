// Percentile helpers for CrUX histograms.
//
// CrUX publishes p75 directly plus a THREE-bin histogram (good / needs
// improvement / poor). Any other percentile can only be *approximated* by
// linear interpolation inside a bin, and cannot be computed at all when it
// falls in the open-ended final bin. Everything here is therefore explicitly
// labelled: measured p75 vs `approx (histogram-derived)` vs null.
//
// Never present an interpolated value as if it were measured.

/** Normalize a CrUX histogram entry list to [{start, end|null, density}]. */
export function normalizeHistogram(hist) {
  if (!Array.isArray(hist)) return [];
  return hist.map((b) => ({
    start: num(b.start),
    end: b.end === undefined || b.end === null ? null : num(b.end),
    density: Number(b.density) || 0,
  }));
}

/** Proportion of experiences in each bin: { good, needsImprovement, poor }. */
export function distribution(hist) {
  const bins = normalizeHistogram(hist);
  if (bins.length < 3) return null;
  return {
    good: round4(bins[0].density),
    needsImprovement: round4(bins[1].density),
    poor: round4(bins[2].density),
  };
}

/**
 * Approximate an arbitrary percentile from a CrUX histogram.
 * Returns { value, approximate: true } or null when it lands in the
 * open-ended final bin (no upper edge to interpolate against).
 */
export function approxPercentile(hist, p) {
  const bins = normalizeHistogram(hist);
  if (!bins.length) return null;
  const target = p / 100;
  let cumulative = 0;
  for (const bin of bins) {
    const next = cumulative + bin.density;
    if (target <= next || bin === bins[bins.length - 1]) {
      if (bin.end === null) return null; // open-ended tail: not derivable
      if (bin.density <= 0) return { value: bin.end, approximate: true };
      const within = (target - cumulative) / bin.density;
      const clamped = Math.max(0, Math.min(1, within));
      const value = bin.start + (bin.end - bin.start) * clamped;
      return { value: round4(value), approximate: true };
    }
    cumulative = next;
  }
  return null;
}

/** Exact percentile from a raw sample array (used only for locally measured samples). */
export function percentile(samples, p) {
  const xs = samples.filter((n) => typeof n === "number" && !Number.isNaN(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const rank = (p / 100) * (xs.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (rank - lo);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
