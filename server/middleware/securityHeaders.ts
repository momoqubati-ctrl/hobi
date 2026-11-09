import { defineEventHandler, getRequestHeader, setResponseHeader, H3Event } from "h3";

const getContentSecurityPolicy = (isApi: boolean): string => {
  if (isApi) {
    return "default-src 'none'; frame-ancestors 'none'; sandbox";
  }
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "connect-src 'self' ws: wss: https:",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
};

export default defineEventHandler((event: H3Event) => {
  const path = event.path || "";
  const isApi = path.startsWith("/api/");

  // 1. Prevent MIME Sniffing
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");

  // 2. Clickjacking protection (DENY for APIs, SAMEORIGIN for web pages)
  setResponseHeader(event, "X-Frame-Options", isApi ? "DENY" : "SAMEORIGIN");

  // 3. Referrer Policy
  setResponseHeader(event, "Referrer-Policy", "strict-origin-when-cross-origin");

  // 4. Permissions Policy
  setResponseHeader(event, "Permissions-Policy", "camera=(), microphone=(self), geolocation=()");

  // 5. HSTS (Strict-Transport-Security)
  if (process.env.NODE_ENV === "production" || getRequestHeader(event, "x-forwarded-proto") === "https") {
    setResponseHeader(event, "Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  // 6. Content Security Policy
  setResponseHeader(event, "Content-Security-Policy", getContentSecurityPolicy(isApi));

  // 7. CORS handling for REST requests
  const origin = getRequestHeader(event, "origin");
  if (origin) {
    const configuredOrigins = (process.env.ALLOWED_ORIGINS || process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let isHostingDomain = false;
    try {
      const parsed = new URL(origin);
      isHostingDomain = parsed.hostname.endsWith(".onrender.com") || parsed.hostname.endsWith(".vercel.app");
    } catch {}

    const isAllowed =
      configuredOrigins.includes(origin) ||
      configuredOrigins.includes("*") ||
      isHostingDomain ||
      configuredOrigins.length === 0 ||
      (process.env.NODE_ENV !== "production" &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));

    if (isAllowed) {
      setResponseHeader(event, "Access-Control-Allow-Origin", origin);
      setResponseHeader(event, "Access-Control-Allow-Credentials", "true");
      setResponseHeader(event, "Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      setResponseHeader(event, "Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    }
  }

  // Return early for OPTIONS preflight
  if (event.method === "OPTIONS") {
    return "";
  }
});
