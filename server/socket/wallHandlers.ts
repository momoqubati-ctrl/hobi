import type { Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import { 
  createWallPost, 
  toggleWallLike, 
  createWallComment, 
  deleteWallComment, 
  listPostComments, 
  getLikeCounts, 
  getCommentCounts,
  toggleCommentLike,
  getCommentLikeCounts,
  getUserLikedComments
} from "../services/wallService";
import { createNotification } from "../services/notificationService";
import { processText } from "../services/filterService";
import { applyShortcuts } from "../services/shortcutService";
import { dbPool } from "../db";
import { getSocketIp } from "../services/requestCountry";
import { publishGlobalEvent } from "./SocketBroker";
import { getMessagePermissionRequirements } from "../../src/lib/chatFeaturePermissions";
import { hasChatFeatureAccess } from "../services/chatAuthorization";

export function registerWallHandlers(io: Server, socket: Socket): void {
  const user = socket.data.user;

  // خريطة مؤقتة: tempId (UUID) → realId (INTEGER من DB)
  const tempPostIds = new Map<string, string>();

  /**
   * إنشاء منشور حائط — بث فوري ثم فلترة + حفظ في الخلفية
   */
  socket.on("wall:create_post", async (data: { tempId?: string; content: string; mediaUrl?: string; mediaUrls?: string[]; animatedFaces?: string[] }, callback?: (res: any) => void) => {
    const text = String(data?.content || "").trim();
    if (!text && !data?.mediaUrls?.length && !data?.mediaUrl) {
      callback?.({ success: false, error: "نص المنشور فارغ" });
      return;
    }

    try {
      // دعم mediaUrl القديم و mediaUrls الجديد
      const mediaUrls = data.mediaUrls || (data.mediaUrl ? [data.mediaUrl] : []);
      const requiredPermissions = getMessagePermissionRequirements({
        channel: "wall",
        text,
        hasMedia: mediaUrls.length > 0,
        hasEffects: Boolean(data.animatedFaces?.length),
      });
      if (!(await hasChatFeatureAccess(user, requiredPermissions))) {
        callback?.({ success: false, error: "لا تملك صلاحية استخدام إحدى ميزات منشور الحائط" });
        return;
      }

      // الفلترة أولاً قبل البث
      const ip = getSocketIp(socket);
      let filteredText = text;
      if (text) {
        try {
          const expanded = await applyShortcuts(text);
          const filterRes = await processText({
            text: expanded,
            source: "الحائط",
            user: { username: user.username, topic: user.username, ip }
          });
          filteredText = filterRes.filteredText;
        } catch {}
      }

      // إنشاء كائن المنشور بمعرف مؤقت فوراً
      const tempId = randomUUID();
      const post = {
        id: tempId,
        body: filteredText,
        mediaUrl: mediaUrls[0] || null,
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : null,
        animatedFaces: data.animatedFaces && data.animatedFaces.length > 0 ? data.animatedFaces : null,
        createdAt: new Date().toISOString(),
        author: {
          id: String(user.id),
          name: user.username || "زائر",
          avatar: user.avatar || "/pic.png",
          nameColor: socket.data.user.nameColor || "",
          statusFontColor: socket.data.user.statusFontColor || "",
          giftedBannerUrl: (socket.data.user as any).giftedBannerUrl || "",
          giftedGiftIconUrl: (socket.data.user as any).giftedGiftIconUrl || "",
          giftedPromotionIconUrl: (socket.data.user as any).giftedPromotionIconUrl || "",
        },
      };

      // البث المباشر فوراً لجميع المتواجدين
      publishGlobalEvent("wall_post_created", post).catch((err) => 
        console.error("Failed to broadcast wall post:", err)
      );

      // تأكيد فوري للصاحب
      callback?.({ success: true, post });

      // الحفظ في الخلفية
      dbPool.query(
          `INSERT INTO bars (uid, msg, pic, topic, media_urls, animated_faces) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [String(user.id), filteredText, mediaUrls[0] || null, user.username || "", mediaUrls.length > 1 ? JSON.stringify(mediaUrls) : null, data.animatedFaces && data.animatedFaces.length > 0 ? JSON.stringify(data.animatedFaces) : null]
        ).then((result) => {
        const realId = String(result.rows[0].id);
        tempPostIds.set(tempId, realId);
        publishGlobalEvent("wall_post_resolved", { tempId, realId }).catch(() => {});
        setTimeout(() => tempPostIds.delete(tempId), 30000);
        import("../services/wallService").then(m => m.upsertCachedWallPost({ ...post, id: realId })).catch(() => {});
      }).catch((err) => {
        console.error("Background DB save failed for wall post:", err);
        publishGlobalEvent("wall_post_failed", { tempId }).catch(() => {});
      });
    } catch (err: any) {
      console.error("Error creating wall post via socket:", err);
      callback?.({ success: false, error: "تعذر إنشاء المنشور" });
    }
  });

  /**
   * الإعجاب / إلغاء الإعجاب بمنشور — البث المباشر أولاً ثم الحفظ في الخلفية
   */
  socket.on("wall:toggle_like", async (data: { postId: string }, callback?: (res: any) => void) => {
    let postId = String(data?.postId || "").trim();
    if (!postId) {
      callback?.({ success: false, error: "معرف المنشور مطلوب" });
      return;
    }

    try {
      if (!(await hasChatFeatureAccess(user, ["wall_reactions.use"]))) {
        callback?.({ success: false, error: "لا تملك صلاحية التفاعل مع الحائط" });
        return;
      }

      // إذا كان المعرف UUID، ابحث عن المعرف الحقيقي
      if (postId.includes("-")) {
        const realId = tempPostIds.get(postId);
        if (realId) {
          postId = realId;
        } else {
          callback?.({ success: false, error: "المنشور لا يزال قيد الحفظ، حاول مرة أخرى" });
          return;
        }
      }

      const parsedPostId = parseInt(postId, 10);
      if (isNaN(parsedPostId)) {
        callback?.({ success: false, error: "معرف المنشور غير صالح" });
        return;
      }

      // استعلام واحد فقط: هل أعجب سابقاً + العداد (PARALLEL)
      const [existingRes, countRes] = await Promise.all([
        dbPool.query("SELECT 1 FROM bars_likes WHERE bar_id = $1 AND user_id = $2 LIMIT 1", [parsedPostId, user.id]),
        dbPool.query("SELECT COUNT(*)::int as cnt FROM bars_likes WHERE bar_id = $1", [parsedPostId])
      ]);
      const wasLiked = (existingRes.rowCount ?? 0) > 0;
      const newLiked = !wasLiked;
      const currentCount = countRes.rows[0]?.cnt ?? 0;
      const newCount = newLiked ? currentCount + 1 : Math.max(0, currentCount - 1);

      // البث المباشر فوراً لجميع المتواجدين (بما فيهم الصاحب)
      publishGlobalEvent("wall_like_toggled", { 
        postId, 
        liked: newLiked, 
        likeCount: newCount,
        userId: user.id
      }).catch(err => console.error("Failed to broadcast wall like update:", err));

      // حفظ في DB في الخلفية
      const dbPromise = newLiked
        ? dbPool.query("INSERT INTO bars_likes (bar_id, user_id) VALUES ($1, $2)", [parsedPostId, user.id])
        : dbPool.query("DELETE FROM bars_likes WHERE bar_id = $1 AND user_id = $2", [parsedPostId, user.id]);
      dbPromise.catch((err) => console.error("Background DB save failed for wall like:", err));

      // إرسال إشعار لصاحب المنشور إذا تم الإعجاب وكان شخصاً آخر
      if (newLiked) {
        dbPool.query("SELECT uid, msg FROM bars WHERE id = $1 LIMIT 1", [parsedPostId]).then((postRes) => {
          const postOwnerId = postRes.rows[0]?.uid;
          const postMsg = String(postRes.rows[0]?.msg || "").slice(0, 80);
          if (postOwnerId && String(postOwnerId) !== String(user.id)) {
            createNotification(String(postOwnerId), user.id, "like", "wall_post", postId, { postBody: postMsg });
          }
        }).catch(() => {});
      }

      callback?.({ success: true, liked: newLiked, likeCount: newCount });
    } catch (err: any) {
      console.error("Error toggling wall like via socket:", err);
      callback?.({ success: false, error: "تعذر تحديث الإعجاب" });
    }
  });

  /**
   * إضافة تعليق على منشور — بث فوري ثم فلترة + حفظ في الخلفية
   */
  socket.on("wall:add_comment", async (data: { tempId?: string; postId: string; content: string; parentId?: string }, callback?: (res: any) => void) => {
    let postId = String(data?.postId || "").trim();
    const content = String(data?.content || "").trim();
    
    if (!postId || !content) {
      callback?.({ success: false, error: "البيانات ناقصة" });
      return;
    }

    try {
      if (!(await hasChatFeatureAccess(user, ["wall_comments.use"]))) {
        callback?.({ success: false, error: "لا تملك صلاحية التعليق على الحائط" });
        return;
      }

      // إذا كان المعرف UUID، ابحث عن المعرف الحقيقي
      if (postId.includes("-")) {
        const realId = tempPostIds.get(postId);
        if (realId) {
          postId = realId;
        } else {
          callback?.({ success: false, error: "المنشور لا يزال قيد الحفظ، حاول مرة أخرى" });
          return;
        }
      }

      const parsedPostId = parseInt(postId, 10);

      // إنشاء كائن التعليق فوراً (بدون فلترة)
      const commentId = randomUUID();
      const comment = {
        id: commentId,
        body: content,
        createdAt: new Date().toISOString(),
        author: {
          id: String(user.id),
          name: user.username || "زائر",
          avatar: user.avatar || "/pic.png",
          nameColor: socket.data.user.nameColor || "",
          statusFontColor: socket.data.user.statusFontColor || "",
          giftedBannerUrl: (socket.data.user as any).giftedBannerUrl || "",
          giftedGiftIconUrl: (socket.data.user as any).giftedGiftIconUrl || "",
          giftedPromotionIconUrl: (socket.data.user as any).giftedPromotionIconUrl || "",
        },
        parentId: data.parentId || null,
        replies: [],
      };

      // جلب العداد الحالي
      const commentCounts = await getCommentCounts([parsedPostId]);
      const currentCount = commentCounts[postId] ?? 0;
      const newCount = currentCount + 1;

      // البث المباشر فوراً لجميع المتواجدين
      publishGlobalEvent("wall_comment_added", {
        postId,
        comment,
        commentCount: newCount
      }).catch(err => console.error("Failed to broadcast wall comment update:", err));

      // تأكيد فوري
      callback?.({ success: true, comment, commentCount: newCount });

      // الفلترة + الحفظ في الخلفية
      const ip = getSocketIp(socket);
      Promise.all([
        applyShortcuts(content).then(expanded => processText({ text: expanded, source: "تعليق على الحائط", user: { username: user.username, topic: user.username, ip } })),
        dbPool.query(`SELECT id, username, topic, pic FROM users WHERE id::text = $1 OR idreg::text = $1 OR uid::text = $1 LIMIT 1`, [user.id])
      ]).then(([filterRes, userRes]) => {
        const dbUser = userRes.rows[0];
        const resolvedId = String(dbUser?.id || user.id);
        const resolvedName = dbUser?.topic || dbUser?.username || user.username || "زائر";

        // الحفظ بالمصفي
        return dbPool.query(
          `INSERT INTO bar_comments (bar_id, author_id, author_topic, author_pic, body, parent_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [parsedPostId, resolvedId, resolvedName, dbUser?.pic || null, filterRes.filteredText, data.parentId ? parseInt(data.parentId, 10) : null]
        );
      }).then(() => {
        // إشعار لصاحب المنشور مع جزء من المنشور
        dbPool.query("SELECT uid, msg FROM bars WHERE id = $1 LIMIT 1", [parsedPostId]).then((postRes) => {
          const postOwnerId = postRes.rows[0]?.uid;
          const postMsg = String(postRes.rows[0]?.msg || "").slice(0, 80);
          if (postOwnerId && String(postOwnerId) !== String(user.id)) {
            createNotification(String(postOwnerId), user.id, "comment", "wall_post", postId, { commentId, commentBody: content, postBody: postMsg });
          }
        }).catch(() => {});

        // إشعار لصاحب التعليق الأب عند الرد عليه
        if (data.parentId) {
          dbPool.query("SELECT author_id, body FROM bar_comments WHERE id = $1 LIMIT 1", [parseInt(data.parentId, 10)]).then((parentRes) => {
            const parentComment = parentRes.rows[0];
            console.log("[Reply Notification] parentComment:", parentComment, "user.id:", user.id);
            if (parentComment && String(parentComment.author_id) !== String(user.id)) {
              const parentSnippet = String(parentComment.body || "").slice(0, 20);
              console.log("[Reply Notification] Sending to:", parentComment.author_id);
              createNotification(String(parentComment.author_id), user.id, "reply", "wall_comment", postId, { commentId, commentBody: content, parentCommentBody: parentSnippet }).then(() => {
                console.log("[Reply Notification] Sent successfully");
              }).catch((e) => console.error("[Reply Notification] Failed:", e));
            } else {
              console.log("[Reply Notification] Skipped - same user or no parent");
            }
          }).catch((e) => console.error("[Reply Notification] DB query failed:", e));
        }
      }).catch((err) => {
        console.error("Background comment save failed:", err);
      });
    } catch (err: any) {
      console.error("Error adding wall comment via socket:", err);
      callback?.({ success: false, error: "تعذر إضافة التعليق" });
    }
  });

  /**
   * حذف تعليق
   */
  socket.on("wall:delete_comment", async (data: { postId: string; commentId: string }, callback?: (res: any) => void) => {
    let postId = String(data?.postId || "").trim();
    const commentId = String(data?.commentId || "").trim();

    if (!postId || !commentId) {
      callback?.({ success: false, error: "البيانات ناقصة" });
      return;
    }

    try {
      // إذا كان المعرف UUID، ابحث عن المعرف الحقيقي
      if (postId.includes("-")) {
        const realId = tempPostIds.get(postId);
        if (realId) postId = realId;
      }

      const parsedPostId = parseInt(postId, 10);
      const success = await deleteWallComment(commentId, user.id);
      
      if (success) {
        const commentCounts = await getCommentCounts([parsedPostId]);
        const currentCount = commentCounts[postId] ?? 0;

        publishGlobalEvent("wall_comment_deleted", {
          postId,
          commentId,
          commentCount: currentCount
        }, socket.id).catch(err => console.error("Failed to broadcast comment deletion:", err));

        callback?.({ success: true });
      } else {
        callback?.({ success: false, error: "لا تملك الصلاحية لحذف هذا التعليق" });
      }
    } catch (err: any) {
      console.error("Error deleting wall comment via socket:", err);
      callback?.({ success: false, error: "تعذر حذف التعليق" });
    }
  });

  /**
   * الإعجاب / إلغاء الإعجاب بتعليق — بث فوري ثم حفظ في الخلفية
   */
  socket.on("wall:toggle_comment_like", async (data: { commentId: string }, callback?: (res: any) => void) => {
    const commentId = String(data?.commentId || "").trim();
    if (!commentId) {
      callback?.({ success: false, error: "معرف التعليق مطلوب" });
      return;
    }

    try {
      if (!(await hasChatFeatureAccess(user, ["wall_reactions.use"]))) {
        callback?.({ success: false, error: "لا تملك صلاحية التفاعل مع الحائط" });
        return;
      }

      const parsedCommentId = parseInt(commentId, 10);

      // استعلام واحد: هل أعجب سابقاً + العداد (PARALLEL)
      const [existingRes, countRes] = await Promise.all([
        dbPool.query("SELECT 1 FROM bar_comment_likes WHERE comment_id = $1 AND user_id = $2 LIMIT 1", [parsedCommentId, user.id]),
        dbPool.query("SELECT COUNT(*)::int as cnt FROM bar_comment_likes WHERE comment_id = $1", [parsedCommentId])
      ]);
      const wasLiked = (existingRes.rowCount ?? 0) > 0;
      const newLiked = !wasLiked;
      const currentCount = countRes.rows[0]?.cnt ?? 0;
      const newCount = newLiked ? currentCount + 1 : Math.max(0, currentCount - 1);

      // البث المباشر فوراً
      publishGlobalEvent("wall_comment_like_toggled", {
        commentId,
        liked: newLiked,
        likeCount: newCount,
        userId: user.id
      }).catch(err => console.error("Failed to broadcast comment like update:", err));

      // حفظ في DB في الخلفية
      const dbPromise = newLiked
        ? dbPool.query("INSERT INTO bar_comment_likes (comment_id, user_id) VALUES ($1, $2)", [parsedCommentId, user.id])
        : dbPool.query("DELETE FROM bar_comment_likes WHERE comment_id = $1 AND user_id = $2", [parsedCommentId, user.id]);
      dbPromise.catch((err) => console.error("Background DB save failed for comment like:", err));

      // إشعار لصاحب التعليق عند الإعجاب
      if (newLiked) {
        dbPool.query("SELECT author_id, body FROM bar_comments WHERE id = $1 LIMIT 1", [parsedCommentId]).then((commentRes) => {
          const commentAuthor = commentRes.rows[0];
          console.log("[CommentLike Notification] commentAuthor:", commentAuthor, "user.id:", user.id);
          if (commentAuthor && String(commentAuthor.author_id) !== String(user.id)) {
            const commentSnippet = String(commentAuthor.body || "").slice(0, 20);
            console.log("[CommentLike Notification] Sending to:", commentAuthor.author_id);
            createNotification(String(commentAuthor.author_id), user.id, "like", "wall_comment", commentId, { commentBody: commentSnippet }).then(() => {
              console.log("[CommentLike Notification] Sent successfully");
            }).catch((e) => console.error("[CommentLike Notification] Failed:", e));
          } else {
            console.log("[CommentLike Notification] Skipped - same user or no author");
          }
        }).catch((e) => console.error("[CommentLike Notification] DB query failed:", e));
      }

      callback?.({ success: true, liked: newLiked, likeCount: newCount });
    } catch (err: any) {
      console.error("Error toggling comment like via socket:", err);
      callback?.({ success: false, error: "تعذر تحديث الإعجاب" });
    }
  });

  /**
   * جلب التعليقات لمنشور معين
   */
  socket.on("wall:get_comments", async (data: { postId: string }, callback?: (res: any) => void) => {
    const postId = String(data?.postId || "").trim();
    if (!postId) {
      callback?.({ success: false, error: "معرف المنشور مطلوب" });
      return;
    }

    try {
      const comments = await listPostComments(postId);
      callback?.({ success: true, comments });
    } catch (err: any) {
      console.error("Error getting comments via socket:", err);
      callback?.({ success: false, error: "تعذر جلب التعليقات" });
    }
  });
}
