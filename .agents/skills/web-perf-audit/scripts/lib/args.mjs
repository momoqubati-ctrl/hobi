// Minimal --flag / --flag=value / --flag value parser. No deps.
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = true; // boolean flag
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

/** Split a comma-separated flag value into a trimmed, de-duped list. */
export function list(value) {
  if (!value || value === true) return [];
  return [...new Set(String(value).split(",").map((s) => s.trim()).filter(Boolean))];
}

/** Parse an integer flag with a fallback. */
export function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
