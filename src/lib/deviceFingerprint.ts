const DEVICE_ID_KEY = "hobi_device_id";
const DEVICE_SIGNATURE_KEY = "hobi_device_signature";

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function collectBrowserFingerprint(): string {
  const parts: string[] = [
    navigator.userAgent || "",
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth || 24),
    navigator.language || "",
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    String(navigator.hardwareConcurrency || 0),
    navigator.platform || "",
  ];
  return parts.join("|||");
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = generateUUID();
    try { localStorage.setItem(DEVICE_ID_KEY, id); } catch {}
  }
  return id;
}

export function getDeviceSignature(): string {
  let sig = localStorage.getItem(DEVICE_SIGNATURE_KEY);
  if (!sig) {
    const fp = collectBrowserFingerprint();
    const id = getDeviceId();
    sig = simpleHash(fp + ":" + id) + simpleHash(id + ":" + fp);
    try { localStorage.setItem(DEVICE_SIGNATURE_KEY, sig); } catch {}
  }
  return sig;
}
