import { Server, Socket } from "socket.io";
import { createNotification } from "../services/notificationService";
import { dbPool } from "../db";
import {
  createStory,
  getActiveStories,
  getUserStories,
  getStoryById,
  deleteStory,
  markStoryViewed,
  getStoryViewers,
  getStoryReactions,
  reactToStory,
  incrementShareCount,
  isStoriesEnabled,
} from "../services/storyService";

export function registerStoryHandlers(io: Server, socket: Socket): void {
  const userData = socket.data?.user || {};
  const userId = userData.id;

  socket.on("stories:get", async (dataOrCallback?: any, maybeCallback?: any) => {
    try {
      const callback = typeof dataOrCallback === "function" ? dataOrCallback : maybeCallback;
      const data = typeof dataOrCallback === "object" ? dataOrCallback : {};

      const enabled = await isStoriesEnabled();
      if (!enabled) return callback?.({ success: true, stories: [] });

      const currentViewerId =
        data?.viewerId ||
        socket.data?.user?.id ||
        (socket.handshake?.auth as any)?.userId ||
        userId ||
        "";

      const stories = await getActiveStories(currentViewerId);
      callback?.({ success: true, stories });
    } catch (err) {
      console.error("[Stories] get error:", err);
      callback?.({ error: "Failed to load stories" });
    }
  });

  socket.on("stories:getUser", async (data: { userId: string }, callback) => {
    try {
      const targetUserId = data?.userId || userId;
      if (!targetUserId) return callback?.({ error: "User not specified" });

      const userStories = await getUserStories(targetUserId, userId);
      callback?.({ success: true, stories: userStories });
    } catch (err) {
      console.error("[Stories] getUser error:", err);
      callback?.({ error: "Failed to load user stories" });
    }
  });

  socket.on("stories:create", async (data: {
    mediaUrl?: string;
    mediaType?: "image" | "video" | "text";
    caption?: string;
    linkUrl?: string;
    bgColor?: string;
    textColor?: string;
  }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });

      // منع الروابط في النص
      if (data.caption && /https?:\/\/[^\s]+/i.test(data.caption)) {
        return callback?.({ error: "لا يُسمح بإدراج روابط في النص" });
      }

      const story = await createStory({
        authorId: userId,
        mediaUrl: data.mediaUrl,
        mediaType: data.mediaType || "text",
        caption: data.caption,
        linkUrl: undefined,
        bgColor: data.bgColor,
        textColor: data.textColor,
      });

      // إثراء القصة ببيانات الكاتب قبل البث
      const enriched = await getStoryById(story.id);
      io.emit("stories:new", enriched || story);

      callback?.({ success: true, story: enriched || story });
    } catch (err) {
      console.error("[Stories] create error:", err);
      callback?.({ error: "Failed to create story" });
    }
  });

  socket.on("stories:delete", async (data: { storyId: string }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });
      if (!data?.storyId) return callback?.({ error: "Story ID required" });

      const deleted = await deleteStory(data.storyId, userId);
      if (!deleted) return callback?.({ error: "Story not found or not yours" });

      io.emit("stories:deleted", { storyId: data.storyId });

      callback?.({ success: true });
    } catch (err) {
      console.error("[Stories] delete error:", err);
      callback?.({ error: "Failed to delete story" });
    }
  });

  socket.on("stories:view", async (data: { storyId: string; viewerId?: string }, callback) => {
    try {
      const currentViewerId =
        data?.viewerId ||
        socket.data?.user?.id ||
        (socket.handshake?.auth as any)?.userId ||
        userId;

      if (!currentViewerId) return callback?.({ error: "Unauthorized" });
      if (!data?.storyId) return callback?.({ error: "Story ID required" });

      const currentViewerName =
        socket.data?.user?.username ||
        (socket.handshake?.auth as any)?.username ||
        userData.username ||
        "عضو";

      await markStoryViewed(data.storyId, currentViewerId, currentViewerName);

      const viewers = await getStoryViewers(data.storyId);

      io.emit("stories:viewed", {
        storyId: data.storyId,
        viewerId: currentViewerId,
        viewCount: viewers.length,
        viewers,
      });

      callback?.({ success: true, viewers });
    } catch (err) {
      console.error("[Stories] view error:", err);
      callback?.({ error: "Failed to record view" });
    }
  });

  socket.on("stories:getViewers", async (data: { storyId: string }, callback) => {
    try {
      if (!data?.storyId) return callback?.({ error: "Story ID required" });

      const viewers = await getStoryViewers(data.storyId);

      callback?.({ success: true, viewers, count: viewers.length });
    } catch (err) {
      console.error("[Stories] getViewers error:", err);
      callback?.({ error: "Failed to load viewers" });
    }
  });

  socket.on("stories:getReactions", async (data: { storyId: string; type?: string }, callback) => {
    try {
      if (!data?.storyId) return callback?.({ error: "Story ID required" });

      const reactions = await getStoryReactions(data.storyId, data.type || "like");

      callback?.({ success: true, reactions, count: reactions.length });
    } catch (err) {
      console.error("[Stories] getReactions error:", err);
      callback?.({ error: "Failed to load reactions" });
    }
  });

  socket.on("stories:react", async (data: { storyId: string; type?: string }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });
      if (!data?.storyId) return callback?.({ error: "Story ID required" });

      const result = await reactToStory(data.storyId, userId, data.type || "like", userData.username);

      if (result?.reacted) {
        try {
          const storyRes = await dbPool.query(
            "SELECT author_id FROM stories WHERE id = $1 LIMIT 1",
            [data.storyId],
          );
          if (storyRes.rows.length > 0) {
            const authorId = storyRes.rows[0].author_id;
            if (authorId && String(authorId) !== String(userId)) {
              await createNotification(authorId, userId, "like", "story", data.storyId, {
                storyId: data.storyId,
              }).catch(() => {});
            }
          }
        } catch (_) {}
      }

      io.emit("stories:reacted", {
        storyId: data.storyId,
        userId,
        type: data.type || "like",
        reacted: result?.reacted,
      });

      callback?.({ success: true, ...result });
    } catch (err) {
      console.error("[Stories] react error:", err);
      callback?.({ error: "Failed to react" });
    }
  });

  socket.on("stories:share", async (data: { storyId: string }, callback) => {
    try {
      if (!data?.storyId) return callback?.({ error: "Story ID required" });

      await incrementShareCount(data.storyId);

      io.emit("stories:shared", { storyId: data.storyId, userId });

      callback?.({ success: true });
    } catch (err) {
      console.error("[Stories] share error:", err);
      callback?.({ error: "Failed to share" });
    }
  });
}
