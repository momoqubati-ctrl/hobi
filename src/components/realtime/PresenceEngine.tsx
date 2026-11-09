"use client";

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useRealtimeStore } from '@/lib/realtime-store';
import { getSocket } from '@/lib/socket';
import { getAuthHeaders } from '@/lib/authSession';
import { toast } from 'sonner';
import { AlertReceivedPopup } from '@/components/profile/AlertReceivedPopup';
import { startReconnectionManager } from '@/lib/reconnectionManager';
import { browserAliveKeeper } from '@/lib/browserAliveKeeper';

const PresenceEngine = () => {
  const [alerts, setAlerts] = useState<Array<{ id: string; open: boolean; fromUsername: string; fromAvatar: string; fromBanner: string; fromGiftIcon: string; fromPromotionIcon: string; fromAvatarFrame: string; message: string; timestamp: number }>>([]);
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
        displayName: String(user?.displayName || user?.name || user?.username || "").trim(),
        mentionName: String(user?.mentionName || "").trim(),
        publicUserId: String(user?.publicUserId || "").trim(),
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
      displayName: user?.displayName || (matchesCurrentUser ? (hint.displayName || hint.username) : undefined),
      mentionName: user?.mentionName !== undefined ? user.mentionName : (matchesCurrentUser ? hint.mentionName : undefined),
      publicUserId: user?.publicUserId || (matchesCurrentUser ? hint.publicUserId : undefined),
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
  const fetchOnlineUsers = useCallback((force = false) => {
    if (isOnlineUsersLoadedRef.current && !force) return;
    
    setLoadingOnlineUsers(true);
    const socket = getSocket();
    
    // Timeout safety: if callback never fires within 5s, allow retry
    const timeoutId = setTimeout(() => {
      if (!isOnlineUsersLoadedRef.current) {
        setLoadingOnlineUsers(false);
      }
    }, 5000);

    socket.emit("get_online_users", (res: any) => {
      clearTimeout(timeoutId);
      if (res?.success) {
        const hydratedUsers = (res.users || []).map((user: any) => hydratePresenceUser(user));
        setOnlineUsers(hydratedUsers);
        setOnlineCount(res.count || 0);
      } else {
        setLoadingOnlineUsers(false);
      }
    });
  }, [setOnlineUsers, setOnlineCount, setLoadingOnlineUsers, hydratePresenceUser]);

  const fetchRooms = useCallback(async (force = false) => {
    if (isRoomsLoadedRef.current && !force) return;

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
      let userId = "";
      try {
        userId = String(JSON.parse(localStorage.getItem("user") || "null")?.id || "");
      } catch (error) {
        console.warn("Could not read current user for wall post likes:", error);
      }
      const query = userId ? `?userId=${encodeURIComponent(userId)}` : "";
      const res = await fetch(`/api/wall/posts${query}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setWallPosts(data.posts || []);
        setLikedPosts((data.posts || []).filter((post: any) => post.userLiked).map((post: any) => String(post.id)));
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

    // ── تشغيل مدير إعادة الاتصال مرة واحدة ─────────────────────────────────
    startReconnectionManager();

    // ── منع تجميد المتصفح (AudioContext + Web Locks + Heartbeat) ──────────
    browserAliveKeeper.start();
        const onConnect = () => {
      // Force refresh presence and rooms on reconnect
      fetchOnlineUsers(true);
      fetchRooms(true);
      socket.emit("get_rooms", (res: any) => {
        if (res?.success && Array.isArray(res.rooms)) {
          setRooms(res.rooms);
        }
      });
      fetchNotifications();
      fetchMail();
    };

    const handleNetworkOnline = () => {
      fetchOnlineUsers(true);
      fetchRooms(true);
    };

    socket.on("connect", onConnect);
    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    window.addEventListener("online", handleNetworkOnline);

    fetchRooms();
    fetchWallPosts();

    // جلب عدد الرسائل غير المقروءة
    try {
      const rawUser = localStorage.getItem("user");
      if (rawUser) {
        const userId = JSON.parse(rawUser).id;
        fetch(`/api/pm/unread?userId=${encodeURIComponent(userId)}`, {
          headers: getAuthHeaders(),
        })
          .then(r => r.json())
          .then(data => {
            if (data.success) setPmUnreadCount(data.count);
          })
          .catch(() => {});
      }
    } catch {}

    return () => {
      socket.off("connect", onConnect);
      window.removeEventListener("online", handleNetworkOnline);
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
      
      const toMerge: Record<string, any> = {
        id: data.userId || "0",
        socketId: data.socketId,
        role: data.role || "guest",
      };
      if (data.username !== undefined) toMerge.username = data.username;
      if (data.displayName) toMerge.displayName = data.displayName;
      if (data.mentionName !== undefined) toMerge.mentionName = data.mentionName;
      if (data.publicUserId !== undefined) toMerge.publicUserId = data.publicUserId;
      if (data.status !== undefined) toMerge.status = data.status;
      if (data.avatar !== undefined) toMerge.avatar = data.avatar;
      if (data.avatarUrl !== undefined && !toMerge.avatar) toMerge.avatar = data.avatarUrl;
      if (data.countryCode !== undefined) toMerge.countryCode = data.countryCode;
      if (data.roomId !== undefined) toMerge.roomId = data.roomId;
      if (data.idreg !== undefined) toMerge.idreg = data.idreg;
      if (data.siteBadge !== undefined) toMerge.siteBadge = data.siteBadge;
      if (data.statusFontColor !== undefined) toMerge.statusFontColor = data.statusFontColor;

      mergeOnlineUser(hydratePresenceUser(toMerge));
    };

    const onUserCountryUpdate = (data: { userId: string; socketId?: string; username?: string; displayName?: string; mentionName?: string; publicUserId?: string; role?: string; countryCode: string }) => {
      if (!data?.userId && !data?.socketId) return;
      const toMerge: Record<string, any> = {
        id: data.userId || "0",
        socketId: data.socketId,
        countryCode: data.countryCode,
      };
      if (data.username !== undefined) toMerge.username = data.username;
      if (data.displayName) toMerge.displayName = data.displayName;
      if (data.mentionName !== undefined) toMerge.mentionName = data.mentionName;
      if (data.publicUserId !== undefined) toMerge.publicUserId = data.publicUserId;
      if (data.role !== undefined) toMerge.role = data.role;
      mergeOnlineUser(hydratePresenceUser(toMerge));
    };

    const onUserConnected = (data: any) => {
      console.debug("[socket] user_connected", new Date().toISOString(), data);
      if (data?.userId || data?.socketId || data?.username) {
        const existingUsers = useRealtimeStore.getState().onlineUsers;
        const existing = existingUsers.find((u: any) => 
          (data.userId && String(u.id) === String(data.userId)) || 
          (data.socketId && String(u.socketId) === String(data.socketId))
        );
        const resolvedDisplayName = (data.displayName && String(data.displayName).trim()) 
          ? String(data.displayName).trim() 
          : (existing?.displayName || data.username || "زائر");

        mergeOnlineUser(hydratePresenceUser({
          id: data.userId || "0",
          socketId: data.socketId,
          username: data.username || "زائر",
          displayName: resolvedDisplayName,
          mentionName: data.mentionName !== undefined ? data.mentionName : (existing?.mentionName || ""),
          publicUserId: data.publicUserId !== undefined ? data.publicUserId : (existing?.publicUserId || ""),
          role: data.role || "guest",
          avatar: data.avatar || data.avatarUrl || "/pic.png",
          countryCode: data.countryCode || "SA",
          avatarFrameUrl: data.avatarFrameUrl || "",
          giftIconUrl: data.giftIconUrl || "",
          memberCardBgUrl: data.memberCardBgUrl || "",
          nameColor: data.nameColor || "",
          messageColor: data.messageColor || "",
          statusFontColor: data.statusFontColor || "",
          roomId: data.roomId || "",
          status: data.status || "online",
          idreg: data.idreg || "",
          siteBadge: data.siteBadge || "",
          statusMsg: data.statusMsg || data.profileMsg || "",
          giftedBannerUrl: data.giftedBannerUrl || "",
          giftedGiftIconUrl: data.giftedGiftIconUrl || "",
          giftedPromotionIconUrl: data.giftedPromotionIconUrl || "",
          roleIconUrl: data.roleIconUrl || "",
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
      console.log("[PresenceEngine] user_profile_updated received:", data);
      if (!data?.userId) {
        console.log("[PresenceEngine] No userId in data, ignoring event");
        return;
      }

      console.log("[PresenceEngine] Calling mergeOnlineUser for user:", data.userId, data.username);
      console.log("[PresenceEngine] nameColor in data:", data.nameColor, "messageColor:", data.messageColor);

      // Update online user (including display name)
      // Only include fields present in data to avoid overwriting existing values with ""
      const update: Record<string, any> = { id: data.userId };
      if (data.username !== undefined) update.username = data.username;
      if (data.displayName !== undefined) update.displayName = data.displayName;
      if (data.mentionName !== undefined) update.mentionName = data.mentionName;
      if (data.publicUserId !== undefined) update.publicUserId = data.publicUserId;
      if (data.avatar !== undefined || data.avatarUrl !== undefined) {
        update.avatar = data.avatar || data.avatarUrl;
        update.avatarUrl = data.avatar || data.avatarUrl;
      }
      if (data.profileCover !== undefined) update.profileCover = data.profileCover;
      if (data.avatarFrameUrl !== undefined) update.avatarFrameUrl = data.avatarFrameUrl;
      if (data.memberCardBgUrl !== undefined) update.memberCardBgUrl = data.memberCardBgUrl;
      if (data.nameColor !== undefined) update.nameColor = data.nameColor;
      if (data.messageColor !== undefined) update.messageColor = data.messageColor;
      if (data.statusFontColor !== undefined) update.statusFontColor = data.statusFontColor;
      if (data.statusMsg !== undefined || data.profileMsg !== undefined) {
        update.statusMsg = data.statusMsg || data.profileMsg;
      }
      if (data.siteBadge !== undefined) update.siteBadge = data.siteBadge;
      if (data.idreg !== undefined) update.idreg = data.idreg;
      if (data.giftedBannerUrl !== undefined) update.giftedBannerUrl = data.giftedBannerUrl;
      if (data.giftedGiftIconUrl !== undefined) update.giftedGiftIconUrl = data.giftedGiftIconUrl;
      if (data.giftedPromotionIconUrl !== undefined) update.giftedPromotionIconUrl = data.giftedPromotionIconUrl;
      if (data.roleIconUrl !== undefined) update.roleIconUrl = data.roleIconUrl;
      if (data.role !== undefined) update.role = data.role;
      if (data.power !== undefined) update.power = data.power;

      const merged = mergeOnlineUser(hydratePresenceUser(update));
      console.log("[PresenceEngine] Updated onlineUsers list now contains", useRealtimeStore.getState().onlineUsers.length, "users");

      // Update wall post author (avatar + display name + banner + icons)
      updateWallAuthorProfile(
        data.userId,
        data.displayName || data.username,
        data.avatar || data.avatarUrl,
        data.previousUsername,
        data.nameColor !== undefined ? data.nameColor : undefined,
        data.giftedBannerUrl,
        data.giftedGiftIconUrl,
        data.giftedPromotionIconUrl,
        data.roleIconUrl
      );
    };

    const onRoomCountUpdate = (data: { roomId: string; memberCount: number }) => {
      updateRoomMemberCount(data.roomId, data.memberCount);
    };

    const onRoomsUpdated = (data: { rooms?: any[] }) => {
      if (Array.isArray(data?.rooms)) {
        setRooms(data.rooms);
      }
    };

    const onMsg = (data: { cmd: string; data: any }) => {
      if (data?.cmd === "r+" && Array.isArray(data?.data)) {
        setRooms(data.data);
      }
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
        fetch(`/api/pm/unread?userId=${encodeURIComponent(currentUserId)}`, {
          headers: getAuthHeaders(),
        })
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
    socket.on("rooms_updated", onRoomsUpdated);
    socket.on("msg", onMsg);
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

    // --- أحداث الإهداء اللحظية ---
    const onGiftBannerReceived = (data: any) => {
      if (!data) return;
      // حفظ البنر في localStorage للاحتفاظ به بعد التحديث
      try {
        const rawUser = localStorage.getItem("user");
        if (rawUser) {
          const user = JSON.parse(rawUser);
          user.giftedBannerUrl = data.iconUrl || "";
          localStorage.setItem("user", JSON.stringify(user));
        }
      } catch {}
      if (data.iconUrl) {
        toast.success(`تم اهدائك بنر من ${data.fromUsername || "عضو"}`, {
          description: "يمكنك رؤية البنر الجديد بجانب اسمك",
        });
      } else {
        toast.info("تم إزالة البنر الخاص بك");
      }
    };

    const onGiftIconReceived = (data: any) => {
      if (!data) return;
      // حفظ أيقونة الهدية في localStorage
      try {
        const rawUser = localStorage.getItem("user");
        if (rawUser) {
          const user = JSON.parse(rawUser);
          user.giftedGiftIconUrl = data.iconUrl || "";
          localStorage.setItem("user", JSON.stringify(user));
        }
      } catch {}
      if (data.iconUrl) {
        toast.success(`تم اهدائك أيقونة هدية من ${data.fromUsername || "عضو"}`, {
          description: "يمكنك رؤية الأيقونة الجديدة بجانب اسمك",
        });
      } else {
        toast.info("تم إزالة أيقونة الهدية الخاصة بك");
      }
    };

    const onGiftPromotionIconReceived = (data: any) => {
      if (!data) return;
      // حفظ أيقونة الترقية في localStorage
      try {
        const rawUser = localStorage.getItem("user");
        if (rawUser) {
          const user = JSON.parse(rawUser);
          user.giftedPromotionIconUrl = data.iconUrl || "";
          localStorage.setItem("user", JSON.stringify(user));
        }
      } catch {}
      if (data.iconUrl) {
        toast.success(`تم اهدائك أيقونة ترقية من ${data.fromUsername || "عضو"}`, {
          description: "يمكنك رؤية الأيقونة الجديدة بجانب اسمك",
        });
      } else {
        toast.info("تم إزالة أيقونة الترقية الخاصة بك");
      }
    };

    socket.on("gift_banner_received", onGiftBannerReceived);
    socket.on("gift_icon_received", onGiftIconReceived);
    socket.on("gift_promotion_icon_received", onGiftPromotionIconReceived);

    const onAlertReceived = (data: any) => {
      if (!data) return;
      const newAlert = {
        id: data.alertId || String(Date.now()),
        open: true,
        fromUsername: data.fromUsername || "عضو",
        fromAvatar: data.fromAvatar || "/pic.png",
        fromBanner: data.fromBanner || "",
        fromGiftIcon: data.fromGiftIcon || "",
        fromPromotionIcon: data.fromPromotionIcon || "",
        fromAvatarFrame: data.fromAvatarFrame || "",
        message: data.message || "",
        timestamp: data.timestamp || Date.now(),
      };
      setAlerts((prev) => [...prev, newAlert]);
    };

    const onMutedState = (data: { muted?: boolean; roomMuted?: boolean; roomId?: string }) => {
      console.log("[PresenceEngine] muted_state received:", data);
      // الكتم العام (اختياري حتى لا تُبلش المحادثة عند فحوص كتم الغرفة فقط)
      if (typeof data.muted === "boolean") {
        useRealtimeStore.getState().setIsMuted(data.muted);
        try {
          const rawUser = localStorage.getItem("user");
          if (rawUser) {
            const user = JSON.parse(rawUser);
            user.muted = data.muted;
            localStorage.setItem("user", JSON.stringify(user));
          }
        } catch {}
      }
      // الكتم الغرفي: توثيقه محلياً (يرافق الحقل المتبقي من السيرفر مع رسائل الغرفة)
      if (typeof data.roomMuted === "boolean") {
        try {
          const rawUser = localStorage.getItem("user");
          if (rawUser) {
            const user = JSON.parse(rawUser);
            const roomMutedMap = (user.roomMutedRooms && typeof user.roomMutedRooms === "object") ? user.roomMutedRooms : {};
            if (data.roomId) {
              if (data.roomMuted) roomMutedMap[String(data.roomId)] = true;
              else delete roomMutedMap[String(data.roomId)];
            }
            user.roomMuted = data.roomMuted;
            user.roomMutedRooms = roomMutedMap;
            localStorage.setItem("user", JSON.stringify(user));
          }
        } catch {}
      }
    };

    const handleUserMuteUpdated = (e: any) => {
      const isMuted = Boolean(e.detail);
      useRealtimeStore.getState().setIsMuted(isMuted);
    };

    const handleClientAlert = (e: any) => {
      if (e.detail) {
        onAlertReceived(e.detail);
      }
    };

    socket.on("alert_received", onAlertReceived);
    socket.on("muted_state", onMutedState);
    window.addEventListener("user-mute-updated", handleUserMuteUpdated);
    window.addEventListener("show-client-alert", handleClientAlert);

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
      socket.off("rooms_updated", onRoomsUpdated);
      socket.off("msg", onMsg);
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
      
      // إزالة listeners الإهداء
      socket.off("gift_banner_received", onGiftBannerReceived);
      socket.off("gift_icon_received", onGiftIconReceived);
      socket.off("gift_promotion_icon_received", onGiftPromotionIconReceived);
      socket.off("alert_received", onAlertReceived);
      socket.off("muted_state", onMutedState);
      window.removeEventListener("user-mute-updated", handleUserMuteUpdated);
      window.removeEventListener("show-client-alert", handleClientAlert);
      
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      clearTimeout(idleTimer);

      // ── إيقاف BrowserAliveKeeper عند unmount ──────────────────────────
      browserAliveKeeper.stop();
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

  return (
    <>
      {alerts.map((alert, index) => (
        <AlertReceivedPopup
          key={alert.id}
          open={alert.open}
          onOpenChange={(open) => {
            if (!open) {
              setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
            }
          }}
          fromUsername={alert.fromUsername}
          fromAvatar={alert.fromAvatar}
          fromBanner={alert.fromBanner}
          fromGiftIcon={alert.fromGiftIcon}
          fromPromotionIcon={alert.fromPromotionIcon}
          fromAvatarFrame={alert.fromAvatarFrame}
          message={alert.message}
          timestamp={alert.timestamp}
          stackIndex={index}
        />
      ))}
    </>
  ); // Silent background engine
};

export default PresenceEngine;