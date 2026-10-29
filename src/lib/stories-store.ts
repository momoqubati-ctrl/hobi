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
  followedByMe?: boolean;
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
  updateViewCount: (storyId: string, viewCount: number, isMe?: boolean) => void;
  markReacted: (storyId: string, type: string, reacted: boolean, isMe?: boolean) => void;
  markFollowed: (authorId: string, followed: boolean) => void;
  fetchStories: (force?: boolean) => void;
  resetStories: () => void;
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
        st.id === storyId ? { ...st, viewedByMe: true } : st
      ),
    })),

  updateViewCount: (storyId, viewCount, isMe = false) =>
    set((s) => ({
      stories: s.stories.map((st) =>
        st.id === storyId
          ? {
              ...st,
              viewCount,
              ...(isMe ? { viewedByMe: true } : {}),
            }
          : st
      ),
    })),

  markReacted: (storyId, type, reacted, isMe = false) =>
    set((s) => ({
      stories: s.stories.map((st) =>
        st.id === storyId
          ? {
              ...st,
              likeCount: Math.max(0, st.likeCount + (reacted ? 1 : -1)),
              ...(isMe ? { likedByMe: reacted } : {}),
            }
          : st
      ),
    })),

  markFollowed: (authorId, followed) =>
    set((s) => ({
      stories: s.stories.map((st) =>
        st.authorId === authorId ? { ...st, followedByMe: followed } : st
      ),
    })),

  fetchStories: (force = false) => {
    const state = get();
    if (state.isLoading) return;
    if (state.isLoaded && !force) return;
    set({ isLoading: true });

    let viewerId = "";
    try {
      const rawUser = localStorage.getItem("user") || localStorage.getItem("auth_user");
      if (rawUser) {
        const u = JSON.parse(rawUser);
        viewerId = u?.id ? String(u.id) : "";
      }
    } catch {}

    const socket = getSocket();

    // مهلة أمان لمنع التعليق
    const timeoutId = setTimeout(() => {
      const s = get();
      if (s.isLoading && !s.isLoaded) {
        set({ isLoading: false });
      }
    }, 5000);

    socket.emit("stories:get", { viewerId }, (response: any) => {
      clearTimeout(timeoutId);
      if (response?.success && Array.isArray(response.stories)) {
        set({ stories: response.stories, isLoaded: true, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    });
  },

  resetStories: () =>
    set({
      stories: [],
      isLoading: false,
      isLoaded: false,
      viewerOpen: false,
      viewerUserIndex: 0,
      viewerStoryIndex: 0,
    }),

  openViewer: (userIndex, storyIndex) => {
    const { stories } = get();
    let targetStoryIndex = storyIndex;
    if (targetStoryIndex === undefined) {
      const userStories = getStoriesByUser(stories, userIndex);
      const firstUnviewed = userStories.findIndex((s) => !s.viewedByMe);
      targetStoryIndex = firstUnviewed !== -1 ? firstUnviewed : 0;
    }
    set({
      viewerOpen: true,
      viewerUserIndex: userIndex,
      viewerStoryIndex: targetStoryIndex,
    });
  },

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
    const storyUsers = getStoryUsers(stories);
    if (viewerUserIndex < storyUsers.length - 1) {
      const nextUserIndex = viewerUserIndex + 1;
      const nextUserStories = getStoriesByUser(stories, nextUserIndex);
      const firstUnviewed = nextUserStories.findIndex((s) => !s.viewedByMe);
      set({
        viewerUserIndex: nextUserIndex,
        viewerStoryIndex: firstUnviewed !== -1 ? firstUnviewed : 0,
      });
    } else {
      set({ viewerOpen: false });
    }
  },

  prevUser: () => {
    const { stories, viewerUserIndex } = get();
    if (viewerUserIndex > 0) {
      const prevUserIndex = viewerUserIndex - 1;
      const prevUserStories = getStoriesByUser(stories, prevUserIndex);
      const firstUnviewed = prevUserStories.findIndex((s) => !s.viewedByMe);
      set({
        viewerUserIndex: prevUserIndex,
        viewerStoryIndex: firstUnviewed !== -1 ? firstUnviewed : 0,
      });
    }
  },
}));

export function getStoryUsers(stories: Story[]): {
  authorId: string;
  authorUsername: string;
  authorAvatar: string;
  authorNameColor?: string;
  hasUnviewed: boolean;
}[] {
  const seen = new Map<string, {
    authorId: string;
    authorUsername: string;
    authorAvatar: string;
    authorNameColor?: string;
    hasUnviewed: boolean;
  }>();

  for (const s of stories) {
    const isUnviewed = !s.viewedByMe;
    if (!seen.has(s.authorId)) {
      seen.set(s.authorId, {
        authorId: s.authorId,
        authorUsername: s.authorUsername,
        authorAvatar: s.authorAvatar,
        authorNameColor: s.authorNameColor,
        hasUnviewed: isUnviewed,
      });
    } else {
      const existing = seen.get(s.authorId)!;
      if (isUnviewed) {
        existing.hasUnviewed = true;
      }
    }
  }
  return Array.from(seen.values());
}

export function getStoriesByUser(stories: Story[], userIndex: number): Story[] {
  const storyUsers = getStoryUsers(stories);
  const targetUser = storyUsers[userIndex];
  if (!targetUser) return [];
  return stories
    .filter((s) => s.authorId === targetUser.authorId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function initStoriesListeners() {
  const socket = getSocket();
  const store = useStoriesStore;

  const onConnect = () => {
    store.getState().fetchStories(true);
  };
  const onNewStory = (story: Story) => {
    store.getState().addStory(story);
  };
  const onDeleted = ({ storyId }: { storyId: string }) => {
    store.getState().removeStory(storyId);
  };
  const onViewed = ({
    storyId,
    viewerId,
    viewCount,
  }: {
    storyId: string;
    viewerId?: string;
    viewCount: number;
  }) => {
    let myId = "";
    try {
      const rawUser = localStorage.getItem("user") || localStorage.getItem("auth_user");
      if (rawUser) {
        const u = JSON.parse(rawUser);
        myId = u?.id ? String(u.id) : "";
      }
    } catch {}

    const isMe = Boolean(myId && viewerId && String(viewerId) === myId);
    store.getState().updateViewCount(storyId, viewCount, isMe);
  };
  const onReacted = ({
    storyId,
    userId,
    type,
    reacted,
  }: {
    storyId: string;
    userId?: string;
    type: string;
    reacted: boolean;
  }) => {
    let myId = "";
    try {
      const rawUser = localStorage.getItem("user") || localStorage.getItem("auth_user");
      if (rawUser) {
        const u = JSON.parse(rawUser);
        myId = u?.id ? String(u.id) : "";
      }
    } catch {}

    const isMe = Boolean(myId && userId && String(userId) === myId);
    // إذا كان التفاعل صادراً من المستخدم نفسه فقد تم تطبيقه تفاؤلياً فور الضغط، فلا نكرر الزيادة
    if (!isMe) {
      store.getState().markReacted(storyId, type, reacted, false);
    }
  };
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

  const onAuthLogout = () => {
    store.getState().resetStories();
  };
  const onAuthLogin = () => {
    store.getState().fetchStories(true);
  };

  socket.on("connect", onConnect);
  socket.on("stories:new", onNewStory);
  socket.on("stories:deleted", onDeleted);
  socket.on("stories:viewed", onViewed);
  socket.on("stories:reacted", onReacted);
  socket.on("user_profile_updated", onProfileUpdated);

  if (typeof window !== "undefined") {
    window.addEventListener("app-auth-logout", onAuthLogout);
    window.addEventListener("app-auth-login", onAuthLogin);
  }

  if (socket.connected) {
    store.getState().fetchStories(true);
  }

  return () => {
    socket.off("connect", onConnect);
    socket.off("stories:new", onNewStory);
    socket.off("stories:deleted", onDeleted);
    socket.off("stories:viewed", onViewed);
    socket.off("stories:reacted", onReacted);
    socket.off("user_profile_updated", onProfileUpdated);
    if (typeof window !== "undefined") {
      window.removeEventListener("app-auth-logout", onAuthLogout);
      window.removeEventListener("app-auth-login", onAuthLogin);
    }
  };
}
