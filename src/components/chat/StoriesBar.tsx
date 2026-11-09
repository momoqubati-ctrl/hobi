import React, { useEffect } from "react";
import { Plus, Loader2 } from "lucide-react";
import { useStoriesStore, getStoryUsers } from "@/lib/stories-store";
import { PermissionGate } from "@/components/ui/PermissionGate";

interface StoriesBarProps {
  onOpenCreator: () => void;
}

const StoriesBar = ({ onOpenCreator }: StoriesBarProps) => {
  const { stories, isLoading, isLoaded, fetchStories, openViewer } = useStoriesStore();
  const currentUser = React.useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!isLoaded && !isLoading) fetchStories();
  }, [isLoaded, isLoading, fetchStories]);

  const storyUsers = getStoryUsers(stories);
  const currentUserHasStory = storyUsers.find((u) => u.authorId === currentUser?.id);
  const otherUsers = currentUser
    ? storyUsers.filter((u) => u.authorId !== currentUser.id)
    : storyUsers;

  if (isLoading && !isLoaded) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (storyUsers.length === 0 && !currentUser) return null;

  return (
    <div className="relative" dir="ltr">
      <div className="flex gap-3 overflow-x-auto px-4 py-3 scrollbar-none">
        {/* User's own Story Circle (قصتي / إضافة) */}
        {currentUser && (
          <div className="relative flex shrink-0 flex-col items-center gap-1">
            {currentUserHasStory ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const myIdx = storyUsers.findIndex((u) => u.authorId === currentUser?.id);
                    if (myIdx !== -1) openViewer(myIdx);
                    else onOpenCreator();
                  }}
                  className="relative flex h-16 w-16 items-center justify-center rounded-full transition-transform active:scale-95"
                >
                  <div
                    className={`h-full w-full rounded-full p-0.5 transition-colors ${
                      currentUserHasStory.hasUnviewed
                        ? "bg-gradient-to-br from-amber-400 via-pink-500 to-violet-600 shadow-sm"
                        : "bg-slate-300 dark:bg-slate-700"
                    }`}
                  >
                    <div className="h-full w-full rounded-full border-2 border-white bg-white dark:border-slate-900 dark:bg-slate-900 overflow-hidden">
                      <img
                        src={currentUserHasStory.authorAvatar || currentUser?.avatar || currentUser?.pic || "/pic.png"}
                        alt="قصتي"
                        className="h-full w-full rounded-full object-cover"
                      />
                    </div>
                  </div>
                </button>
                <PermissionGate requiredPermissions={["story_publish.use"]}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenCreator();
                    }}
                    className="absolute bottom-5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white shadow-md hover:scale-110 active:scale-95 transition-transform"
                    title="إضافة قصة جديدة"
                    aria-label="إضافة قصة جديدة"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </PermissionGate>
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                  قصتي
                </span>
              </>
            ) : (
              <>
                <PermissionGate requiredPermissions={["story_publish.use"]}>
                  <button
                    type="button"
                    onClick={onOpenCreator}
                    className="relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600 transition-transform active:scale-95"
                    aria-label="إضافة قصة جديدة"
                  >
                    <div className="flex h-full w-full items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                      <Plus className="h-6 w-6 text-primary" />
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-white shadow-sm">
                      <Plus className="h-3 w-3" />
                    </span>
                  </button>
                  <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                    إضافة
                  </span>
                </PermissionGate>
              </>
            )}
          </div>
        )}

        {/* Other Users' Stories */}
        {otherUsers.map((user) => {
          const originalIdx = storyUsers.findIndex((u) => u.authorId === user.authorId);
          return (
            <button
              key={user.authorId}
              type="button"
              onClick={() => openViewer(originalIdx)}
              className="relative flex shrink-0 flex-col items-center gap-1 transition-transform active:scale-95"
            >
              <div
                className={`h-16 w-16 rounded-full p-0.5 transition-colors ${
                  user.hasUnviewed
                    ? "bg-gradient-to-br from-amber-400 via-pink-500 to-violet-600 shadow-sm"
                    : "bg-slate-300 dark:bg-slate-700"
                }`}
              >
                <div className="h-full w-full rounded-full border-2 border-white bg-white dark:border-slate-900 dark:bg-slate-900 overflow-hidden">
                  <img
                    src={user.authorAvatar || "/pic.png"}
                    alt={user.authorUsername}
                    className="h-full w-full rounded-full object-cover"
                  />
                </div>
              </div>
              <span
                className="max-w-[64px] truncate text-[10px] font-bold"
                style={
                  user.authorNameColor && user.authorNameColor !== "#000000"
                    ? { color: user.authorNameColor }
                    : { color: "var(--slate-500)" }
                }
              >
                {user.authorUsername}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default StoriesBar;
