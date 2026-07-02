import { create } from "zustand";
import { getSocket } from "./socket";

export type Story = {
  id: string;
  authorId: string;
  authorUsername: string;
  authorNameColor?: string;
  authorRole: string;
  authorAvatar: string;
  authorCover: string;
  mediaUrl: string | null;
  mediaType: "image" | "video" | "text";
  caption: string | null;
  linkUrl: string | null;
  bgColor: string;
  textColor: string;
  isActive: boolean;
  viewCount: number;
  likeCount: number;
  giftCount: number;
  shareCount: number;
  viewedByMe: boolean;
  likedByMe: boolean;
  createdAt: string;
  expiresAt: string;
};

export type StoryViewer = {
  id: string;
  username: string;
  avatar: string;
  viewedAt: string;
};

type StoriesState = {
  stories: Story[];
  isLoading: boolean;
  isLoaded: boolean;
  viewerOpen: boolean;
  viewerUserIndex: number;
  viewerStoryIndex: number;
  setStories: (stories: Story[]) => void;
  addStory: (story: Story) => void;
  removeStory: (storyId: string) => void;
  markViewed: (storyId: string) => void;
  markReacted: (storyId: string, type: string, reacted: boolean) => void;
  fetchStories: () => void;
  openViewer: (userIndex: number, storyIndex?: number) => void;
  closeViewer: () => void;
  nextStory: () => void;
  prevStory: () => void;
  nextUser: () => void;
  prevUser: () => void;
};

export const useStoriesStore = create<StoriesState>((set, get) => ({
  stories: [],
  isLoading: false,
  isLoaded: false,
  viewerOpen: false,
  viewerUserIndex: 0,
  viewerStoryIndex: 0,

  setStories: (stories) => set({ stories, isLoaded: true, isLoading: false }),

  addStory: (story) =>
    set((s) => ({ stories: [story, ...s.stories] })),

  removeStory: (storyId) =>
    set((s) => ({ stories: s.stories.filter((st) => st.id !== storyId) })),

  markViewed: (storyId) =>
    set((s) => ({
      stories: s.stories.map((st) =>
        st.id === storyId ? { ...st, viewedByMe: true, viewCount: st.viewCount + 1 } : st
      ),
    })),

  markReacted: (storyId, type, reacted) =>
    set((s) => ({
      stories: s.stories.map((st) =>
        st.id === storyId
          ? { ...st, likeCount: st.likeCount + (reacted ? 1 : -1) }
          : st
      ),
    })),

  fetchStories: () => {
    const state = get();
    if (state.isLoading) return;
    set({ isLoading: true });

    const socket = getSocket();
    socket.emit("stories:get", (response: any) => {
      if (response?.success) {
        set({ stories: response.stories, isLoaded: true, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    });
  },

  openViewer: (userIndex, storyIndex = 0) =>
    set({ viewerOpen: true, viewerUserIndex: userIndex, viewerStoryIndex: storyIndex }),

  closeViewer: () => set({ viewerOpen: false }),

  nextStory: () => {
    const { stories, viewerUserIndex, viewerStoryIndex } = get();
    const userStories = getStoriesByUser(stories, viewerUserIndex);
    if (viewerStoryIndex < userStories.length - 1) {
      set({ viewerStoryIndex: viewerStoryIndex + 1 });
    }
  },

  prevStory: () => {
    const { viewerStoryIndex } = get();
    if (viewerStoryIndex > 0) {
      set({ viewerStoryIndex: viewerStoryIndex - 1 });
    }
  },

  nextUser: () => {
    const { stories, viewerUserIndex } = get();
    const userIds = [...new Set(stories.map((s) => s.authorId))];
    if (viewerUserIndex < userIds.length - 1) {
      set({ viewerUserIndex: viewerUserIndex + 1, viewerStoryIndex: 0 });
    } else {
      set({ viewerOpen: false });
    }
  },

  prevUser: () => {
    const { viewerUserIndex } = get();
    if (viewerUserIndex > 0) {
      set({ viewerUserIndex: viewerUserIndex - 1, viewerStoryIndex: 0 });
    }
  },
}));

export function getStoriesByUser(stories: Story[], userIndex: number): Story[] {
  const userIds = [...new Set(stories.map((s) => s.authorId))];
  const authorId = userIds[userIndex];
  return stories.filter((s) => s.authorId === authorId);
}

export function getStoryUsers(stories: Story[]): { authorId: string; authorUsername: string; authorAvatar: string; authorNameColor?: string; hasUnviewed: boolean }[] {
  const seen = new Map<string, { authorId: string; authorUsername: string; authorAvatar: string; authorNameColor?: string; hasUnviewed: boolean }>();
  for (const s of stories) {
    if (!seen.has(s.authorId)) {
      seen.set(s.authorId, {
        authorId: s.authorId,
        authorUsername: s.authorUsername,
        authorAvatar: s.authorAvatar,
        authorNameColor: s.authorNameColor,
        hasUnviewed: !s.viewedByMe,
      });
    } else {
      const existing = seen.get(s.authorId)!;
      if (!s.viewedByMe) existing.hasUnviewed = true;
    }
  }
  return Array.from(seen.values());
}

export function initStoriesListeners() {
  const socket = getSocket();
  const store = useStoriesStore;

  const onConnect = () => { store.getState().fetchStories(); };
  const onNewStory = (story: Story) => { store.getState().addStory(story); };
  const onDeleted = ({ storyId }: { storyId: string }) => { store.getState().removeStory(storyId); };
  const onViewed = ({ storyId, viewCount }: { storyId: string; viewCount: number }) => { store.getState().markViewed(storyId); };
  const onReacted = ({ storyId, type, reacted }: { storyId: string; type: string; reacted: boolean }) => { store.getState().markReacted(storyId, type, reacted); };
  const onProfileUpdated = (data: any) => {
    if (data && data.userId) {
      const state = store.getState();
      const updatedStories = state.stories.map((st) => {
        if (st.authorId === data.userId) {
          return {
            ...st,
            authorAvatar: data.avatar || data.avatarUrl || st.authorAvatar,
            authorUsername: data.username || st.authorUsername,
            authorNameColor: data.nameColor !== undefined ? data.nameColor : st.authorNameColor,
          };
        }
        return st;
      });
      store.setState({ stories: updatedStories });
    }
  };

  socket.on("connect", onConnect);
  socket.on("stories:new", onNewStory);
  socket.on("stories:deleted", onDeleted);
  socket.on("stories:viewed", onViewed);
  socket.on("stories:reacted", onReacted);
  socket.on("user_profile_updated", onProfileUpdated);

  if (socket.connected) {
    store.getState().fetchStories();
  }

  return () => {
    socket.off("connect", onConnect);
    socket.off("stories:new", onNewStory);
    socket.off("stories:deleted", onDeleted);
    socket.off("stories:viewed", onViewed);
    socket.off("stories:reacted", onReacted);
    socket.off("user_profile_updated", onProfileUpdated);
  };
}
