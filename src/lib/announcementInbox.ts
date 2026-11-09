import {
  listPendingAnnouncements,
  type PendingAnnouncement,
  type PendingAnnouncementPage,
} from "./announcements";

export type PendingPageLoader = (
  cursor: string | null,
) => Promise<PendingAnnouncementPage>;

export function mergePendingAnnouncements(
  current: readonly PendingAnnouncement[],
  incoming: readonly PendingAnnouncement[],
  excludedIds: ReadonlySet<string> = new Set(),
): PendingAnnouncement[] {
  const announcements = new Map<string, PendingAnnouncement>();
  for (const announcement of current) {
    if (!excludedIds.has(announcement.id)) announcements.set(announcement.id, announcement);
  }
  for (const announcement of incoming) {
    if (!excludedIds.has(announcement.id)) announcements.set(announcement.id, announcement);
  }

  return [...announcements.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

export function removePendingAnnouncement(
  announcements: readonly PendingAnnouncement[],
  announcementId: string,
): PendingAnnouncement[] {
  return announcements.filter(({ id }) => id !== announcementId);
}

export async function loadAllPendingAnnouncements(
  loadPage: PendingPageLoader = listPendingAnnouncements,
): Promise<PendingAnnouncement[]> {
  const announcements: PendingAnnouncement[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const page = await loadPage(cursor);
    announcements.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seenCursors.has(cursor)) {
      throw new Error("تعذر تحميل جميع الإعلانات");
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  return mergePendingAnnouncements([], announcements);
}
