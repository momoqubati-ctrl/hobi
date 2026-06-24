"use client";

import React, { useEffect, useCallback, useRef } from 'react';
import { useRealtimeStore } from '@/lib/realtime-store';
import { getSocket } from '@/lib/socket';

const PresenceEngine = () => {
  const getCurrentUserPresenceHint = useCallback(() => {
    try {
      const rawUser = localStorage.getItem("user");
      if (!rawUser) return null;
      const user = JSON.parse(rawUser);
      const profileMsg = typeof user?.profileMsg === "string" ? user.profileMsg.trim() : "";
      const statusMsg = typeof user?.statusMsg === "string" ? user.statusMsg.trim() : profileMsg;
      return {
        id: String(user?.id || "").trim(),
        username: String(user?.name || user?.username || "").trim(),
        profileMsg,
        statusMsg,
      };
    } catch {
      return null;
    }
  }, []);

  const hydratePresenceUser = useCallback((user: any) => {
    if (!user) return user;
    const hint = getCurrentUserPresenceHint();
    if (!hint) return user;

    const incomingId = String(user?.id || "").trim();
    const incomingUsername = String(user?.username || "").trim().toLowerCase();
    const hintId = String(hint.id || "").trim();
    const hintUsername = String(hint.username || "").trim().toLowerCase();
    const matchesCurrentUser = (incomingId && hintId && incomingId === hintId) || (incomingUsername && hintUsername && incomingUsername === hintUsername);

    if (!matchesCurrentUser) return user;

    const resolvedStatusMsg = String(user?.statusMsg || user?.profileMsg || hint.statusMsg || hint.profileMsg || "").trim();
    return {
      ...user,
      profileMsg: resolvedStatusMsg,
      statusMsg: resolvedStatusMsg,
    };
  }, [getCurrentUserPresenceHint]);

  const {
    // Online Users state & actions
    onlineUsers,
    isOnlineUsersLoaded,
    isLoadingOnlineUsers,
    setOnlineUsers,
    setOnlineCount,
    mergeOnlineUser,
    removeOnlineUser,
    setLoadingOnlineUsers,

    // Rooms state & actions
    rooms,
    isRoomsLoaded,
    isLoadingRooms,
    setRooms,
    updateRoomMemberCount,
    setLoadingRooms,

    // Wall state & actions
    wallPosts,
    isWallLoaded,
    isLoadingWallPosts,
    setWallPosts,
    addWallPost,
    removeWallPost,
    resolveWallPostId,
    updateWallAuthorProfile,
    setLoadingWallPosts,

    // Notifications state & actions
    notifications,
    isNotificationsLoaded,
    setNotifications,
    addNotification,
    markNotificationRead,
    setLoadingNotifications,
    setIsNotificationsLoaded,

    // Mail state & actions
    inbox,
    outbox,
    isMailLoaded,
    setMail,
    addMailToInbox,
    addMailToOutbox,
    markMailRead,
    deleteMail,
    setLoadingMail,
    setIsMailLoaded,

    // PM state & actions
    setPmUnreadCount,

    // Wall Comments & Likes actions
    addComment,
    removeComment,
    toggleLike,
    updateLikeCount,
    updateCommentCount,
    setLikedPosts,
    updateCommentLikeCount,
    setHasNewWallPosts,

    setPresence,
    updateCounter
  } = useRealtimeStore();

  const isOnlineUsersLoadedRef = useRef(isOnlineUsersLoaded);
  const isRoomsLoadedRef = useRef(isRoomsLoaded);
  const isWallLoadedRef = useRef(isWallLoaded);
  const isNotificationsLoadedRef = useRef(isNotificationsLoaded);
  const isMailLoadedRef = useRef(isMailLoaded);

  useEffect(() => {
    isOnlineUsersLoadedRef.current = isOnlineUsersLoaded;
  }, [isOnlineUsersLoaded]);

  useEffect(() => {
    isRoomsLoadedRef.current = isRoomsLoaded;
  }, [isRoomsLoaded]);

  useEffect(() => {
    isWallLoadedRef.current = isWallLoaded;
  }, [isWallLoaded]);

  useEffect(() => {
    isNotificationsLoadedRef.current = isNotificationsLoaded;
  }, [isNotificationsLoaded]);

  useEffect(() => {
    isMailLoadedRef.current = isMailLoaded;
  }, [isMailLoaded]);

  // ===== Initial Fetch Logic =====
  const fetchOnlineUsers = useCallback(() => {
    if (isOnlineUsersLoadedRef.current) return;
    
    setLoadingOnlineUsers(true);
    const socket = getSocket();
    socket.emit("get_online_users", (res: any) => {
      if (res?.success) {
        const hydratedUsers = (res.users || []).map((user: any) => hydratePresenceUser(user));
        setOnlineUsers(hydratedUsers);
        setOnlineCount(res.count || 0);
      } else {
        setLoadingOnlineUsers(false);
      }
    });
  }, [setOnlineUsers, setOnlineCount, setLoadingOnlineUsers, hydratePresenceUser]);

  const fetchRooms = useCallback(async () => {
    if (isRoomsLoadedRef.current) return;

    setLoadingRooms(true);
    try {
      const response = await fetch("/api/rooms");
      const data = await response.json();
      if (response.ok && data.success) {
        setRooms(data.rooms || []);
      } else {
        setLoadingRooms(false);
      }
    } catch (err) {
      console.error("Failed to load rooms in PresenceEngine:", err);
      setLoadingRooms(false);
    }
  }, [setRooms, setLoadingRooms]);

  const fetchWallPosts = useCallback(async () => {
    if (isWallLoadedRef.current) return;

    setLoadingWallPosts(true);
    try {
      const res = await fetch("/api/wall/posts");
      const data = await res.json();
      if (res.ok && data.success) {
        setWallPosts(data.posts || []);
        
        // جلب الإعجابات التي قام بها المستخدم الحالي لتفعيل زر الإعجاب الأحمر
        try {
          const rawUser = localStorage.getItem("user");
          if (rawUser) {
            const user = JSON.parse(rawUser);
            const postIds = (data.posts || []).map((p: any) => parseInt(p.id, 10)).filter(Boolean);
            if (postIds.length > 0) {
              const likesRes = await fetch("/api/wall/posts/likes-status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: user.id, postIds })
              });
              const likesData = await likesRes.json();
              if (likesRes.ok && likesData.success && likesData.likedPostIds) {
                setLikedPosts(likesData.likedPostIds);
              }
            }
          }
        } catch (likeErr) {
          console.error("Failed to fetch initial wall likes status:", likeErr);
        }

      } else {
        setLoadingWallPosts(false);
      }
    } catch (err) {
      console.error("Failed to load wall posts in PresenceEngine:", err);
      setLoadingWallPosts(false);
    }
  }, [setWallPosts, setLoadingWallPosts, setLikedPosts]);

  const fetchNotifications = useCallback(() => {
    if (isNotificationsLoadedRef.current) return;

    setLoadingNotifications(true);
    const socket = getSocket();
    socket.emit("notifications:get", { limit: 30 }, (res: any) => {
      if (res?.success) {
        setNotifications(res.notifications || []);
      } else {
        setLoadingNotifications(false);
      }
    });
  }, [setNotifications, setLoadingNotifications]);

  const fetchMail = useCallback(() => {
    if (isMailLoadedRef.current) return;

    setLoadingMail(true);
    const socket = getSocket();
    
    // جلب الوارد
    socket.emit("mail:get_inbox", (inboxRes: any) => {
      if (inboxRes?.success) {
        // جلب الصادر
        socket.emit("mail:get_outbox", (outboxRes: any) => {
          if (outboxRes?.success) {
            setMail(inboxRes.inbox || [], outboxRes.outbox || []);
          } else {
            setLoadingMail(false);
          }
        });
      } else {
        setLoadingMail(false);
      }
    });
  }, [setMail, setLoadingMail]);

  // Load all initial data once
  useEffect(() => {
    const socket = getSocket();
    
    const onConnect = () => {
      // Fetch online users and other socket-based data on connect
      fetchOnlineUsers();
      fetchNotifications();
      fetchMail();
    };

    socket.on("connect", onConnect);
    if (socket.connected) {
      onConnect();
    }

    fetchRooms();
    fetchWallPosts();

    // جلب عدد الرسائل غير المقروءة
    try {
      const rawUser = localStorage.getItem("user");
      if (rawUser) {
        const userId = JSON.parse(rawUser).id;
        fetch(`/api/pm/unread?userId=${userId}`)
          .then(r => r.json())
          .then(data => {
            if (data.success) setPmUnreadCount(data.count);
          })
          .catch(() => {});
      }
    } catch {}

    return () => {
      socket.off("connect", onConnect);
    };
  }, [fetchOnlineUsers, fetchRooms, fetchWallPosts, fetchNotifications, fetchMail, setPmUnreadCount]);

  // ===== Socket Event Listeners =====
  useEffect(() => {
    const socket = getSocket();

    const handlePresenceUpdate = (data: any) => {
      console.debug("[socket] presence:update", new Date().toISOString(), data);
      setPresence(data.userId, data);
    };

    const handleGlobalStats = (data: any) => {
      if (data.onlineCount) updateCounter('online', data.onlineCount);
    };

    const onOnlineCount = (data: { count: number }) => {
      console.debug("[socket] online_count", new Date().toISOString(), data);
      setOnlineCount(data.count);
    };

    const onUserStatusUpdate = (data: any) => {
      console.debug("[socket] user_status_update", new Date().toISOString(), data);
      if (!data?.userId && !data?.socketId) return;
      
      const toMerge: any = {
        id: data.userId || "0",
        socketId: data.socketId,
        username: data.username || "",
        role: data.role || "guest",
      };
      if (data.status !== undefined) toMerge.status = data.status;
      if (data.avatar !== undefined) toMerge.avatar = data.avatar;
      if (data.avatarUrl !== undefined && !toMerge.avatar) toMerge.avatar = data.avatarUrl;
      if (data.countryCode !== undefined) toMerge.countryCode = data.countryCode;
      if (data.roomId !== undefined) toMerge.roomId = data.roomId;
      if (data.idreg !== undefined) toMerge.idreg = data.idreg;
      if (data.siteBadge !== undefined) toMerge.siteBadge = data.siteBadge;

      mergeOnlineUser(hydratePresenceUser(toMerge));
    };

    const onUserCountryUpdate = (data: { userId: string; socketId?: string; username?: string; role?: string; countryCode: string }) => {
      if (!data?.userId && !data?.socketId) return;
      mergeOnlineUser(hydratePresenceUser({
        id: data.userId || "0",
        socketId: data.socketId,
        username: data.username || "",
        role: data.role || "guest",
        countryCode: data.countryCode,
      }));
    };

    const onUserConnected = (data: any) => {
      console.debug("[socket] user_connected", new Date().toISOString(), data);
      if (data?.userId || data?.socketId || data?.username) {
        mergeOnlineUser(hydratePresenceUser({
          id: data.userId || "0",
          socketId: data.socketId,
          username: data.username || "زائر",
          role: data.role || "guest",
          avatar: data.avatar || data.avatarUrl || "/pic.png",
          countryCode: data.countryCode || "SA",
          avatarFrameUrl: data.avatarFrameUrl || "",
          giftIconUrl: data.giftIconUrl || "",
          roomId: data.roomId || "",
          status: data.status || "online",
          idreg: data.idreg || "",
          siteBadge: data.siteBadge || "",
          statusMsg: data.statusMsg || data.profileMsg || "",
        }));
      }
    };

    const onUserDisconnected = (data: any) => {
      console.debug("[socket] user_disconnected", new Date().toISOString(), data);
      if (data?.userId || data?.socketId || data?.username) {
        removeOnlineUser({ id: data.userId, socketId: data.socketId, username: data.username, role: data.role });
        if (typeof data.count === "number") {
          setOnlineCount(data.count);
        }
      }
    };

    const onUserProfileUpdated = (data: any) => {
      console.debug("[socket] user_profile_updated", new Date().toISOString(), data);
      if (!data?.userId) return;

      // Update online user (including display name)
      mergeOnlineUser(hydratePresenceUser({
        id: data.userId,
        username: data.username,
        avatar: data.avatar || data.avatarUrl,
        avatarUrl: data.avatar || data.avatarUrl,
        profileCover: data.profileCover,
        statusMsg: data.statusMsg || data.profileMsg || "",
        siteBadge: data.siteBadge || "",
        idreg: data.idreg || "",
      }));

      // Update wall post author (avatar + display name)
      updateWallAuthorProfile(
        data.userId,
        data.username,
        data.avatar || data.avatarUrl,
        data.previousUsername
      );
    };

    const onRoomCountUpdate = (data: { roomId: string; memberCount: number }) => {
      updateRoomMemberCount(data.roomId, data.memberCount);
    };

    const onWallPostCreated = (post: any) => {
      if (post) {
        addWallPost(post);
        // إشارة وجود منشور جديد
        let currentUserId = "";
        try {
          const rawUser = localStorage.getItem("user");
          if (rawUser) currentUserId = JSON.parse(rawUser).id;
        } catch {}
        if (String(post.author?.id) !== String(currentUserId)) {
          setHasNewWallPosts(true);
        }
      }
    };

    const onWallPostResolved = (data: { tempId: string; realId: string }) => {
      if (data) {
        resolveWallPostId(data.tempId, data.realId);
      }
    };

    const onWallPostFailed = (data: { tempId: string }) => {
      if (data) {
        removeWallPost(data.tempId);
      }
    };

    // --- أحداث الحائط اللحظية الجديدة ---
    const onWallLikeToggled = (data: { postId: string; liked: boolean; likeCount: number; userId: string }) => {
      if (!data) return;

      // تحديث العداد لجميع المتواجدين (بما فيهم صاحب الإعجاب للتأكد من التزامن)
      updateLikeCount(data.postId, data.likeCount);

      // لا نُحدّث حالة الإعجاب للمستخدم الحالي — تم تحديثها فوراً بـ optimistic
    };

    const onWallCommentAdded = (data: { postId: string; comment: any; commentCount: number }) => {
      if (!data) return;
      addComment(data.postId, data.comment);
      updateCommentCount(data.postId, data.commentCount);
    };

    const onWallCommentDeleted = (data: { postId: string; commentId: string; commentCount: number }) => {
      if (!data) return;
      removeComment(data.postId, data.commentId);
      updateCommentCount(data.postId, data.commentCount);
    };

    const onWallCommentLikeToggled = (data: { commentId: string; liked: boolean; likeCount: number; userId: string }) => {
      if (!data) return;
      updateCommentLikeCount(data.commentId, data.likeCount);
    };

    // --- أحداث الإشعارات والبريد اللحظية الجديدة ---
    const onNotificationReceived = (notification: any) => {
      if (notification) {
        let currentUserId = "";
        try {
          const rawUser = localStorage.getItem("user");
          if (rawUser) currentUserId = JSON.parse(rawUser).id;
        } catch {}

        if (String(notification.userId) === String(currentUserId)) {
          addNotification(notification);
        }
      }
    };

    const onNotificationUnreadUpdate = (data: { userId: string; count: number }) => {
      let currentUserId = "";
      try {
        const rawUser = localStorage.getItem("user");
        if (rawUser) currentUserId = JSON.parse(rawUser).id;
      } catch {}

      if (data && String(data.userId) === String(currentUserId)) {
        useRealtimeStore.setState({ notificationUnreadCount: data.count });
      }
    };

    const onMailReceived = (mail: any) => {
      if (!mail) return;
      
      let currentUserId = "";
      try {
        const rawUser = localStorage.getItem("user");
        if (rawUser) currentUserId = JSON.parse(rawUser).id;
      } catch {}

      // التحقق مما إذا كان المستخدم الحالي هو المستلم أم المرسل
      if (String(mail.recipientId) === String(currentUserId)) {
        addMailToInbox(mail);
      } else if (String(mail.senderId) === String(currentUserId)) {
        addMailToOutbox(mail);
      }
    };

    // --- أحداث الرسائل الخاصة ---
    const onPrivateMessage = (msg: any) => {
      if (!msg) return;
      let currentUserId = "";
      try {
        const rawUser = localStorage.getItem("user");
        if (rawUser) currentUserId = JSON.parse(rawUser).id;
      } catch {}

      // إذا كان المستخدم الحالي هو المستلم → جلب عدد غير المقروءة
      if (String(msg.receiverId) === String(currentUserId)) {
        fetch(`/api/pm/unread?userId=${currentUserId}`)
          .then(r => r.json())
          .then(data => {
            if (data.success) setPmUnreadCount(data.count);
          })
          .catch(() => {});
      }
    };

    // Register all listeners
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('system:stats', handleGlobalStats);
    socket.on("online_count", onOnlineCount);
    socket.on("user_status_update", onUserStatusUpdate);
    socket.on("user_country_update", onUserCountryUpdate);
    socket.on("user_connected", onUserConnected);
    socket.on("user_disconnected", onUserDisconnected);
    socket.on("user_profile_updated", onUserProfileUpdated);
    socket.on("room_count_update", onRoomCountUpdate);
    socket.on("wall_post_created", onWallPostCreated);
    socket.on("wall_post_resolved", onWallPostResolved);
    socket.on("wall_post_failed", onWallPostFailed);
    
    // Listeners الجديدة
    socket.on("wall_like_toggled", onWallLikeToggled);
    socket.on("wall_comment_added", onWallCommentAdded);
    socket.on("wall_comment_deleted", onWallCommentDeleted);
    socket.on("wall_comment_like_toggled", onWallCommentLikeToggled);
    socket.on("notification", onNotificationReceived);
    socket.on("notification_unread", onNotificationUnreadUpdate);
    socket.on("internal_mail", onMailReceived);
    socket.on("private_message", onPrivateMessage);

    // Idle Detection
    let idleTimer: ReturnType<typeof setTimeout>;
    const resetTimer = () => {
      clearTimeout(idleTimer);
      socket.emit('presence:state', { status: 'active' });
      idleTimer = setTimeout(() => {
        socket.emit('presence:state', { status: 'idle' });
      }, 60000); // 1 minute
    };

    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);

    // Initial trigger
    resetTimer();

    return () => {
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('system:stats', handleGlobalStats);
      socket.off("online_count", onOnlineCount);
      socket.off("user_status_update", onUserStatusUpdate);
      socket.off("user_country_update", onUserCountryUpdate);
      socket.off("user_connected", onUserConnected);
      socket.off("user_disconnected", onUserDisconnected);
      socket.off("user_profile_updated", onUserProfileUpdated);
      socket.off("room_count_update", onRoomCountUpdate);
      socket.off("wall_post_created", onWallPostCreated);
      socket.off("wall_post_resolved", onWallPostResolved);
      socket.off("wall_post_failed", onWallPostFailed);
      
      // إزالة listeners الجديدة
      socket.off("wall_like_toggled", onWallLikeToggled);
      socket.off("wall_comment_added", onWallCommentAdded);
      socket.off("wall_comment_deleted", onWallCommentDeleted);
      socket.off("wall_comment_like_toggled", onWallCommentLikeToggled);
      socket.off("notification", onNotificationReceived);
      socket.off("notification_unread", onNotificationUnreadUpdate);
      socket.off("internal_mail", onMailReceived);
      socket.off("private_message", onPrivateMessage);
      
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      clearTimeout(idleTimer);
    };
  }, [
    setPresence, 
    updateCounter, 
    setOnlineCount, 
    mergeOnlineUser, 
    removeOnlineUser, 
    hydratePresenceUser,
    updateWallAuthorProfile, 
    updateRoomMemberCount, 
    addWallPost,
    updateLikeCount,
    toggleLike,
    addComment,
    removeComment,
    updateCommentCount,
    addNotification,
    addMailToInbox,
    addMailToOutbox,
    setPmUnreadCount
  ]);

  return null; // Silent background engine
};

export default PresenceEngine;