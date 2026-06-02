import { create } from 'zustand';

interface RealtimeState {
  presence: Record<string, any>;
  activityFeed: any[];
  activeRoom: any | null;
  recommendations: any[];
  counters: Record<string, number>;
  
  // Cached lists
  rooms: any[];
  onlineUsers: any[];
  wallPosts: any[];
  onlineCount: number;
  
  // New cached items
  notifications: any[];
  notificationUnreadCount: number;
  inbox: any[];
  outbox: any[];
  mailUnreadCount: number;
  pmUnreadCount: number;
  
  // Wall Comments & Likes (keyed by postId)
  wallComments: Record<string, any[]>;
  wallCommentCounts: Record<string, number>;
  wallLikedPosts: Set<string>;
  wallLikeCounts: Record<string, number>;
  
  // Loading states
  isLoadingRooms: boolean;
  isLoadingOnlineUsers: boolean;
  isLoadingWallPosts: boolean;
  isLoadingNotifications: boolean;
  isLoadingMail: boolean;
  
  // Initial load flags (to prevent double fetching when mounting tabs)
  isRoomsLoaded: boolean;
  isOnlineUsersLoaded: boolean;
  isWallLoaded: boolean;
  isNotificationsLoaded: boolean;
  isMailLoaded: boolean;
  hasNewWallPosts: boolean;

  // Actions
  setPresence: (userId: string, data: any) => void;
  addActivity: (event: any) => void;
  setActiveRoom: (room: any) => void;
  setRecommendations: (items: any[]) => void;
  updateCounter: (key: string, val: number) => void;
  
  // Actions for Rooms
  setRooms: (rooms: any[]) => void;
  updateRoomMemberCount: (roomId: string, count: number) => void;
  setLoadingRooms: (val: boolean) => void;
  setIsRoomsLoaded: (val: boolean) => void;

  // Actions for Online Users
  setOnlineUsers: (users: any[]) => void;
  setOnlineCount: (count: number) => void;
  mergeOnlineUser: (user: any) => void;
  removeOnlineUser: (target: { id?: string; socketId?: string; username?: string; role?: string }) => void;
  setLoadingOnlineUsers: (val: boolean) => void;
  setIsOnlineUsersLoaded: (val: boolean) => void;

  // Actions for Wall Posts
  setWallPosts: (posts: any[]) => void;
  addWallPost: (post: any) => void;
  removeWallPost: (postId: string) => void;
  updateWallAuthorProfile: (userId: string, username: string, avatar: string) => void;
  setLoadingWallPosts: (val: boolean) => void;
  setHasNewWallPosts: (val: boolean) => void;
  setIsWallLoaded: (val: boolean) => void;

  // Actions for Notifications
  setNotifications: (notifications: any[]) => void;
  addNotification: (notification: any) => void;
  markNotificationRead: (notificationId: string) => void;
  markAllNotificationsRead: () => void;
  setLoadingNotifications: (val: boolean) => void;
  setIsNotificationsLoaded: (val: boolean) => void;

  // Actions for Internal Mail
  setMail: (inbox: any[], outbox: any[]) => void;
  addMailToInbox: (mail: any) => void;
  addMailToOutbox: (mail: any) => void;
  markMailRead: (mailId: string) => void;
  deleteMail: (mailId: string, boxType: 'inbox' | 'outbox') => void;
  setLoadingMail: (val: boolean) => void;
  setIsMailLoaded: (val: boolean) => void;

  // Actions for PM
  setPmUnreadCount: (countOrFn: number | ((prev: number) => number)) => void;

  // Actions for Wall Comments & Likes
  setComments: (postId: string, comments: any[]) => void;
  addComment: (postId: string, comment: any) => void;
  removeComment: (postId: string, commentId: string) => void;
  setLikedPosts: (likedPostIds: string[]) => void;
  toggleLike: (postId: string, liked: boolean) => void;
  updateLikeCount: (postId: string, count: number) => void;
  updateCommentCount: (postId: string, count: number) => void;
  resolveWallPostId: (tempId: string, realId: string) => void;

  // Comment Likes
  wallCommentLiked: Set<string>;
  wallCommentLikeCounts: Record<string, number>;
  toggleCommentLike: (commentId: string, liked: boolean) => void;
  updateCommentLikeCount: (commentId: string, count: number) => void;
}

const getPresenceKey = (member: { id?: string; socketId?: string; username?: string; name?: string; role?: string }) => {
  const id = String(member.id || "").trim();
  if (id && id !== "0") return `id:${id}`;
  if (member.socketId) return `socket:${member.socketId}`;
  const name = String(member.username || member.name || "").trim().toLowerCase();
  if (name && member.role !== "guest") return `username:${name}`;
  return `guest:${name || "anonymous"}`;
};

// عدّ كل التعليقات بما فيهم الردود المتداخلة
function countAllComments(comments: any[]): number {
  let count = 0;
  for (const c of comments) {
    count += 1;
    if (c.replies && c.replies.length > 0) {
      count += countAllComments(c.replies);
    }
  }
  return count;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  presence: {},
  activityFeed: [],
  activeRoom: null,
  recommendations: [],
  counters: {},
  
  rooms: [],
  onlineUsers: [],
  wallPosts: [],
  onlineCount: 0,
  
  notifications: [],
  notificationUnreadCount: 0,
  inbox: [],
  outbox: [],
  mailUnreadCount: 0,
  pmUnreadCount: 0,
  
  wallComments: {},
  wallCommentCounts: {},
  wallLikedPosts: new Set<string>(),
  wallCommentLiked: new Set<string>(),
  wallCommentLikeCounts: {},
  wallLikeCounts: {},
  
  isLoadingRooms: false,
  isLoadingOnlineUsers: false,
  isLoadingWallPosts: false,
  isLoadingNotifications: false,
  isLoadingMail: false,
  
  isRoomsLoaded: false,
  isOnlineUsersLoaded: false,
  isWallLoaded: false,
  hasNewWallPosts: false,
  isNotificationsLoaded: false,
  isMailLoaded: false,

  setPresence: (userId, data) => set((state) => ({
    presence: { ...state.presence, [userId]: data }
  })),

  addActivity: (event) => set((state) => ({
    activityFeed: [event, ...state.activityFeed].slice(0, 50)
  })),

  setActiveRoom: (room) => set({ activeRoom: room }),

  setRecommendations: (items) => set({ recommendations: items }),

  updateCounter: (key, val) => set((state) => ({
    counters: { ...state.counters, [key]: val }
  })),

  // Rooms Actions
  setRooms: (rooms) => set({ rooms, isRoomsLoaded: true, isLoadingRooms: false }),
  updateRoomMemberCount: (roomId, count) => set((state) => ({
    rooms: state.rooms.map((room) =>
      room.id === roomId ? { ...room, members: count } : room
    )
  })),
  setLoadingRooms: (val) => set({ isLoadingRooms: val }),
  setIsRoomsLoaded: (val) => set({ isRoomsLoaded: val }),

  // Online Users Actions
  setOnlineUsers: (users) => set({ onlineUsers: users, isOnlineUsersLoaded: true, isLoadingOnlineUsers: false }),
  setOnlineCount: (count) => set({ onlineCount: count }),
  mergeOnlineUser: (incoming) => set((state) => {
    const identity = getPresenceKey(incoming);
    if (!identity) return {};
    
    let found = false;
    const next = state.onlineUsers.map((user) => {
      if (getPresenceKey(user) !== identity) return user;
      found = true;
      const updated = { ...user } as any;
      for (const [key, value] of Object.entries(incoming)) {
        if (value !== undefined) {
          updated[key] = value;
        }
      }
      return updated;
    });

    if (!found) {
      next.push(incoming);
    }
    return { onlineUsers: next };
  }),
  removeOnlineUser: (target) => set((state) => {
    const identity = getPresenceKey(target);
    return {
      onlineUsers: state.onlineUsers.filter((user) => getPresenceKey(user) !== identity)
    };
  }),
  setLoadingOnlineUsers: (val) => set({ isLoadingOnlineUsers: val }),
  setIsOnlineUsersLoaded: (val) => set({ isOnlineUsersLoaded: val }),

  // Wall Posts Actions
  setWallPosts: (posts) => set((state) => {
    const likeCounts: Record<string, number> = { ...state.wallLikeCounts };
    const commentCounts: Record<string, number> = { ...state.wallCommentCounts };
    const likedSet = new Set(state.wallLikedPosts);
    
    posts.forEach((post) => {
      if (post.likeCount !== undefined) likeCounts[post.id] = post.likeCount;
      if (post.commentCount !== undefined) commentCounts[post.id] = post.commentCount;
      if (post.userLiked) likedSet.add(String(post.id));
    });
    
    return {
      wallPosts: posts,
      isWallLoaded: true,
      isLoadingWallPosts: false,
      wallLikeCounts: likeCounts,
      wallCommentCounts: commentCounts,
      wallLikedPosts: likedSet,
    };
  }),
  addWallPost: (post) => set((state) => {
    if (state.wallPosts.some((item) => String(item.id) === String(post.id))) return {};
    const likeCounts = { ...state.wallLikeCounts, [post.id]: post.likeCount || 0 };
    const commentCounts = { ...state.wallCommentCounts, [post.id]: post.commentCount || 0 };
    return {
      wallPosts: [post, ...state.wallPosts].slice(0, 50),
      wallLikeCounts: likeCounts,
      wallCommentCounts: commentCounts,
    };
  }),
  removeWallPost: (postId) => set((state) => ({
    wallPosts: state.wallPosts.filter((item) => String(item.id) !== String(postId))
  })),
  resolveWallPostId: (tempId, realId) => set((state) => {
    const wallPosts = state.wallPosts.map(post =>
      String(post.id) === String(tempId) ? { ...post, id: realId } : post
    );
    const likeCounts: Record<string, number> = {};
    const commentCounts: Record<string, number> = {};
    for (const [key, val] of Object.entries(state.wallLikeCounts)) {
      likeCounts[String(key) === String(tempId) ? realId : key] = val;
    }
    for (const [key, val] of Object.entries(state.wallCommentCounts)) {
      commentCounts[String(key) === String(tempId) ? realId : key] = val;
    }
    const likedSet = new Set<string>();
    for (const id of state.wallLikedPosts) {
      likedSet.add(String(id) === String(tempId) ? realId : id);
    }
    return { wallPosts, wallLikeCounts: likeCounts, wallCommentCounts: commentCounts, wallLikedPosts: likedSet };
  }),
  updateWallAuthorProfile: (userId, username, avatar, previousUsername?) => set((state) => ({
    wallPosts: state.wallPosts.map((post) => {
      const author = post.author || {};
      const nameMatch = author.name === username || (previousUsername && author.name === previousUsername);
      if (author.id !== userId && !nameMatch) return post;
      return {
        ...post,
        author: {
          ...author,
          name: username || author.name,
          avatar: avatar || author.avatar,
        }
      };
    })
  })),
  setLoadingWallPosts: (val) => set({ isLoadingWallPosts: val }),
  setHasNewWallPosts: (val) => set({ hasNewWallPosts: val }),
  setIsWallLoaded: (val) => set({ isWallLoaded: val }),

  // Notifications Actions
  setNotifications: (notifications) => set({
    notifications,
    notificationUnreadCount: notifications.filter(n => !n.isRead && !n.readAt).length,
    isNotificationsLoaded: true,
    isLoadingNotifications: false
  }),
  addNotification: (notification) => set((state) => {
    if (state.notifications.some(n => String(n.id) === String(notification.id))) return {};
    const nextList = [notification, ...state.notifications];
    return {
      notifications: nextList,
      notificationUnreadCount: nextList.filter(n => !n.isRead && !n.readAt).length
    };
  }),
  markNotificationRead: (notificationId) => set((state) => {
    const nextList = state.notifications.map(n =>
      String(n.id) === String(notificationId) ? { ...n, isRead: true, readAt: new Date().toISOString() } : n
    );
    return {
      notifications: nextList,
      notificationUnreadCount: nextList.filter(n => !n.isRead && !n.readAt).length
    };
  }),
  markAllNotificationsRead: () => set((state) => ({
    notifications: state.notifications.map(n => ({ ...n, isRead: true, readAt: new Date().toISOString() })),
    notificationUnreadCount: 0
  })),
  setLoadingNotifications: (val) => set({ isLoadingNotifications: val }),
  setIsNotificationsLoaded: (val) => set({ isNotificationsLoaded: val }),

  // Internal Mail Actions
  setMail: (inbox, outbox) => set({
    inbox,
    outbox,
    mailUnreadCount: inbox.filter(m => !m.isRead).length,
    isMailLoaded: true,
    isLoadingMail: false
  }),
  addMailToInbox: (mail) => set((state) => {
    if (state.inbox.some(m => String(m.id) === String(mail.id))) return {};
    const nextList = [mail, ...state.inbox];
    return {
      inbox: nextList,
      mailUnreadCount: nextList.filter(m => !m.isRead).length
    };
  }),
  addMailToOutbox: (mail) => set((state) => {
    if (state.outbox.some(m => String(m.id) === String(mail.id))) return {};
    return {
      outbox: [mail, ...state.outbox]
    };
  }),
  markMailRead: (mailId) => set((state) => {
    const nextList = state.inbox.map(m =>
      String(m.id) === String(mailId) ? { ...m, isRead: true } : m
    );
    return {
      inbox: nextList,
      mailUnreadCount: nextList.filter(m => !m.isRead).length
    };
  }),
  deleteMail: (mailId, boxType) => set((state) => {
    if (boxType === 'inbox') {
      const nextList = state.inbox.filter(m => String(m.id) !== String(mailId));
      return {
        inbox: nextList,
        mailUnreadCount: nextList.filter(m => !m.isRead).length
      };
    } else {
      return {
        outbox: state.outbox.filter(m => String(m.id) !== String(mailId))
      };
    }
  }),
  setLoadingMail: (val) => set({ isLoadingMail: val }),
  setIsMailLoaded: (val) => set({ isMailLoaded: val }),

  // PM Actions
  setPmUnreadCount: (countOrFn) => set((state) => ({
    pmUnreadCount: typeof countOrFn === "function" ? countOrFn(state.pmUnreadCount) : countOrFn
  })),

  // Wall Comments & Likes Actions
  setComments: (postId, comments) => set((state) => ({
    wallComments: { ...state.wallComments, [postId]: comments },
    wallCommentCounts: { ...state.wallCommentCounts, [postId]: comments.length }
  })),
  addComment: (postId, comment) => set((state) => {
    const existing = state.wallComments[postId] || [];
    if (existing.some(c => String(c.id) === String(comment.id))) return {};

    // إذا كان لديه parentId → أضفه كرد على التعليق الأب
    if (comment.parentId) {
      const addReplyToList = (list: any[]): any[] => {
        return list.map(c => {
          if (String(c.id) === String(comment.parentId)) {
            return { ...c, replies: [...(c.replies || []), comment] };
          }
          if (c.replies && c.replies.length > 0) {
            return { ...c, replies: addReplyToList(c.replies) };
          }
          return c;
        });
      };
      const nextComments = addReplyToList(existing);
      return {
        wallComments: { ...state.wallComments, [postId]: nextComments },
        wallCommentCounts: { ...state.wallCommentCounts, [postId]: countAllComments(nextComments) }
      };
    }

    // تعليق عادي → أضفه في المستوى الأعلى
    const nextComments = [...existing, comment];
    return {
      wallComments: { ...state.wallComments, [postId]: nextComments },
      wallCommentCounts: { ...state.wallCommentCounts, [postId]: countAllComments(nextComments) }
    };
  }),
  removeComment: (postId, commentId) => set((state) => {
    const existing = state.wallComments[postId] || [];
    const nextComments = existing.filter(c => String(c.id) !== String(commentId));
    return {
      wallComments: { ...state.wallComments, [postId]: nextComments },
      wallCommentCounts: { ...state.wallCommentCounts, [postId]: nextComments.length }
    };
  }),
  setLikedPosts: (likedPostIds) => set({
    wallLikedPosts: new Set(likedPostIds.map(String))
  }),
  toggleLike: (postId, liked) => set((state) => {
    const nextSet = new Set(state.wallLikedPosts);
    const strId = String(postId);
    let countDiff = 0;
    
    if (liked) {
      if (!nextSet.has(strId)) {
        nextSet.add(strId);
        countDiff = 1;
      }
    } else {
      if (nextSet.has(strId)) {
        nextSet.delete(strId);
        countDiff = -1;
      }
    }
    
    const currentCount = state.wallLikeCounts[strId] || 0;
    return {
      wallLikedPosts: nextSet,
      wallLikeCounts: { ...state.wallLikeCounts, [strId]: Math.max(0, currentCount + countDiff) }
    };
  }),
  updateLikeCount: (postId, count) => set((state) => ({
    wallLikeCounts: { ...state.wallLikeCounts, [String(postId)]: count }
  })),
  updateCommentCount: (postId, count) => set((state) => ({
    wallCommentCounts: { ...state.wallCommentCounts, [String(postId)]: count }
  })),
  toggleCommentLike: (commentId, liked) => set((state) => {
    const nextSet = new Set(state.wallCommentLiked);
    const strId = String(commentId);
    let countDiff = 0;
    if (liked) {
      if (!nextSet.has(strId)) { nextSet.add(strId); countDiff = 1; }
    } else {
      if (nextSet.has(strId)) { nextSet.delete(strId); countDiff = -1; }
    }
    const currentCount = state.wallCommentLikeCounts[strId] || 0;
    return {
      wallCommentLiked: nextSet,
      wallCommentLikeCounts: { ...state.wallCommentLikeCounts, [strId]: Math.max(0, currentCount + countDiff) }
    };
  }),
  updateCommentLikeCount: (commentId, count) => set((state) => ({
    wallCommentLikeCounts: { ...state.wallCommentLikeCounts, [String(commentId)]: count }
  })),
}));