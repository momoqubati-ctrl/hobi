import React, { useEffect } from "react";
import { Plus, Loader2 } from "lucide-react";
import { useStoriesStore, getStoryUsers } from "@/lib/stories-store";
import { getSocket } from "@/lib/socket";

interface StoriesBarProps {
  onOpenCreator: () => void;
}

const StoriesBar = ({ onOpenCreator }: StoriesBarProps) => {
  const { stories, isLoading, isLoaded, fetchStories, openViewer } = useStoriesStore();
  const currentUser = React.useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch { return null; }
  }, []);

  useEffect(() => {
    if (!isLoaded && !isLoading) fetchStories();
  }, [isLoaded, isLoading, fetchStories]);

  const storyUsers = getStoryUsers(stories);
  const currentUserHasStory = storyUsers.find((u) => u.authorId === currentUser?.id);

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
        {/* Add Story Button */}
        {currentUser && (
          <button
            onClick={onOpenCreator}
            className="relative flex shrink-0 flex-col items-center gap-1"
          >
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600">
              {currentUserHasStory ? (
                <img
                  src={currentUserHasStory.authorAvatar || "/pic.png"}
                  alt=""
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                  <Plus className="h-6 w-6 text-primary" />
                </div>
              )}
              {!currentUserHasStory && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-white shadow-sm">
                  <Plus className="h-3 w-3" />
                </span>
              )}
            </div>
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
              {currentUserHasStory ? "قصتي" : "إضافة"}
            </span>
          </button>
        )}

        {/* User Stories */}
        {storyUsers.map((user, idx) => (
          <button
            key={user.authorId}
            onClick={() => openViewer(idx)}
            className="relative flex shrink-0 flex-col items-center gap-1"
          >
            <div
              className={`h-16 w-16 rounded-full p-0.5 ${
                user.hasUnviewed
                  ? "bg-gradient-to-br from-amber-400 via-pink-500 to-violet-600"
                  : "bg-slate-300 dark:bg-slate-700"
              }`}
            >
              <div className="h-full w-full rounded-full border-2 border-white bg-white dark:border-slate-900 dark:bg-slate-900">
                <img
                  src={user.authorAvatar || "/pic.png"}
                  alt={user.authorUsername}
                  className="h-full w-full rounded-full object-cover"
                />
              </div>
            </div>
            <span className="max-w-[64px] truncate text-[10px] font-bold text-slate-500 dark:text-slate-400">
              {user.authorUsername}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default StoriesBar;
