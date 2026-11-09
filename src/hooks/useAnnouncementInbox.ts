import { useCallback, useEffect, useRef, useState } from "react";
import {
  canReceiveAnnouncementsForRole,
  dismissAnnouncement,
  isPendingAnnouncement,
} from "@/lib/announcements";
import {
  loadAllPendingAnnouncements,
  mergePendingAnnouncements,
  removePendingAnnouncement,
} from "@/lib/announcementInbox";
import type { PendingAnnouncement } from "@/lib/announcements";
import { getSocket } from "@/lib/socket";
import {
  playIncomingAnnouncementSound,
  setupAnnouncementSoundUnlock,
} from "@/lib/announcementSound";

interface AnnouncementInboxResult {
  announcements: PendingAnnouncement[];
  dismissingIds: ReadonlySet<string>;
  isLoading: boolean;
  error: string | null;
  dismiss: (announcementId: string) => Promise<boolean>;
  retry: () => Promise<void>;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDismissedId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const id = payload.id;
  return typeof id === "string" && id ? id : null;
}

function hasMemberSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const token = window.localStorage.getItem("authToken")
      || window.localStorage.getItem("auth_token");
    if (!token) return false;
    const rawUser = window.localStorage.getItem("user")
      || window.localStorage.getItem("auth_user");
    if (!rawUser) return false;
    const user: unknown = JSON.parse(rawUser);
    return isRecord(user) && canReceiveAnnouncementsForRole(user.role);
  } catch {
    return false;
  }
}

export function useAnnouncementInbox() {
  const [announcements, setAnnouncements] = useState<PendingAnnouncement[]>([]);
  const [dismissingIds, setDismissingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const loadingRef = useRef(false);
  const reloadAfterCurrentRef = useRef(false);
  const dismissedDuringLoadRef = useRef(new Set<string>());
  const createdDuringLoadRef = useRef(new Map<string, PendingAnnouncement>());
  const dismissingIdsRef = useRef(new Set<string>());
  const soundedAnnouncementIdsRef = useRef(new Set<string>());

  const loadAll = useCallback(async () => {
    if (!mountedRef.current) return;
    if (!hasMemberSession()) {
      createdDuringLoadRef.current.clear();
      dismissedDuringLoadRef.current.clear();
      setAnnouncements([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    if (loadingRef.current) {
      reloadAfterCurrentRef.current = true;
      return;
    }

    loadingRef.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const fetched = await loadAllPendingAnnouncements();
      const createdDuringLoad = [...createdDuringLoadRef.current.values()];
      const excludedIds = new Set(dismissedDuringLoadRef.current);
      createdDuringLoadRef.current.clear();
      dismissedDuringLoadRef.current.clear();
      if (mountedRef.current && hasMemberSession()) {
        setAnnouncements(
          mergePendingAnnouncements([], [...fetched, ...createdDuringLoad], excludedIds),
        );
      }
    } catch (loadError) {
      if (mountedRef.current && hasMemberSession()) {
        setError(getErrorMessage(loadError, "تعذر تحميل الإعلانات"));
      }
    } finally {
      loadingRef.current = false;
      if (mountedRef.current) setIsLoading(false);
      if (reloadAfterCurrentRef.current) {
        reloadAfterCurrentRef.current = false;
        if (mountedRef.current) void loadAll();
      }
    }
  }, []);

  const dismiss = useCallback(async (announcementId: string): Promise<boolean> => {
    if (!hasMemberSession()) return false;
    if (dismissingIdsRef.current.has(announcementId)) return false;
    dismissingIdsRef.current.add(announcementId);
    setDismissingIds(new Set(dismissingIdsRef.current));
    setError(null);
    try {
      await dismissAnnouncement(announcementId);
      if (mountedRef.current) {
        setAnnouncements((current) => removePendingAnnouncement(current, announcementId));
      }
      return true;
    } catch (dismissError) {
      if (mountedRef.current) {
        setError(getErrorMessage(dismissError, "تعذر إغلاق الإعلان"));
      }
      return false;
    } finally {
      dismissingIdsRef.current.delete(announcementId);
      if (mountedRef.current) setDismissingIds(new Set(dismissingIdsRef.current));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const socket = getSocket();
    const cleanupSoundUnlock = setupAnnouncementSoundUnlock();

    const handleCreated = (payload: unknown) => {
      if (!mountedRef.current || !hasMemberSession() || !isPendingAnnouncement(payload)) return;
      if (!soundedAnnouncementIdsRef.current.has(payload.id)) {
        soundedAnnouncementIdsRef.current.add(payload.id);
        if (soundedAnnouncementIdsRef.current.size > 200) {
          const oldestId = soundedAnnouncementIdsRef.current.values().next().value;
          if (oldestId) soundedAnnouncementIdsRef.current.delete(oldestId);
        }
        playIncomingAnnouncementSound();
      }
      if (loadingRef.current) createdDuringLoadRef.current.set(payload.id, payload);
      setAnnouncements((current) =>
        mergePendingAnnouncements(current, [payload], dismissedDuringLoadRef.current),
      );
      setError(null);
    };

    const handleDismissed = (payload: unknown) => {
      if (!mountedRef.current || !hasMemberSession()) return;
      const announcementId = getDismissedId(payload);
      if (!announcementId) return;
      if (loadingRef.current) dismissedDuringLoadRef.current.add(announcementId);
      createdDuringLoadRef.current.delete(announcementId);
      setAnnouncements((current) => removePendingAnnouncement(current, announcementId));
      setError(null);
    };

    const handleAuthChange = () => {
      if (hasMemberSession()) {
        void loadAll();
        return;
      }
      createdDuringLoadRef.current.clear();
      dismissedDuringLoadRef.current.clear();
      soundedAnnouncementIdsRef.current.clear();
      setAnnouncements([]);
      setError(null);
      setIsLoading(false);
    };

    socket.on("announcement:created", handleCreated);
    socket.on("announcement:dismissed", handleDismissed);
    socket.on("connect", loadAll);
    window.addEventListener("app-auth-login", handleAuthChange);
    window.addEventListener("user-role-updated", handleAuthChange);
    void loadAll();

    return () => {
      mountedRef.current = false;
      socket.off("announcement:created", handleCreated);
      socket.off("announcement:dismissed", handleDismissed);
      socket.off("connect", loadAll);
      window.removeEventListener("app-auth-login", handleAuthChange);
      window.removeEventListener("user-role-updated", handleAuthChange);
      cleanupSoundUnlock();
    };
  }, [loadAll]);

  const result = {
    announcements,
    dismissingIds,
    isLoading,
    error,
    dismiss,
    retry: loadAll,
  };
  return result satisfies AnnouncementInboxResult;
}
