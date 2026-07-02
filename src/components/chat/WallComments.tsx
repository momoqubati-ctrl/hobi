"use client";

import React, { useState, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Reply, Trash2, Heart } from "lucide-react";
import EmojiPickerPopover from "./EmojiPickerPopover";
import { showSuccess, showError } from "@/utils/toast";
import { useRealtimeStore } from "@/lib/realtime-store";
import { optimisticAddComment, optimisticToggleCommentLike } from "@/lib/optimistic-actions";
import { getSocket } from "@/lib/socket";

interface Author {
  id: string;
  name: string;
  avatar: string;
}

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: Author;
  parentId: string | null;
  replies: Comment[];
  isOptimistic?: boolean;
}

interface WallCommentsProps {
  postId: string;
  commentCount: number;
  currentUser: { id: string; name: string; avatar: string } | null;
  isOpen?: boolean;
  onToggle?: () => void;
  onOpenProfile?: (userIdOrName: string) => void;
}

const CommentThread = ({
  comment,
  currentUser,
  postId,
  onReply,
  onOpenProfile,
  depth = 0,
}: {
  comment: Comment;
  currentUser: { id: string; name: string; avatar: string } | null;
  postId: string;
  onReply: (parentId: string, text: string) => Promise<void>;
  onOpenProfile?: (userIdOrName: string) => void;
  depth?: number;
}) => {
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const [showReplies, setShowReplies] = useState(depth < 1);
  const { wallCommentLiked, wallCommentLikeCounts, onlineUsers } = useRealtimeStore();
  const isLiked = wallCommentLiked.has(String(comment.id));
  const likeCount = wallCommentLikeCounts[String(comment.id)] ?? 0;
  const replyCount = comment.replies?.length || 0;

  const handleSubmitReply = async () => {
    if (!replyText.trim() || !currentUser) return;
    setIsReplying(true);
    try {
      await onReply(comment.id, replyText);
      setReplyText("");
      setShowReplyInput(false);
      setShowReplies(true);
    } finally {
      setIsReplying(false);
    }
  };

  const handleToggleLike = async () => {
    if (!currentUser || comment.isOptimistic) return;
    try {
      await optimisticToggleCommentLike(comment.id);
    } catch (err: any) {
      showError(err.message || "فشل تحديث الإعجاب");
    }
  };

  return (
    <div className={`${depth > 0 ? "mr-6 border-r-2 border-slate-200 pr-3" : ""} ${comment.isOptimistic ? "opacity-75" : ""}`}>
      <div className="flex gap-2 py-2">
        <Avatar
          className="w-11 h-11 rounded-lg shrink-0 cursor-pointer transition hover:scale-110"
          onClick={() => onOpenProfile?.(comment.author.id || comment.author.name)}
        >
          <AvatarImage src={comment.author.avatar} />
          <AvatarFallback className="text-[10px]">{comment.author.name?.[0]}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="text-[10px] font-black text-foreground cursor-pointer hover:underline"
              onClick={() => onOpenProfile?.(comment.author.id || comment.author.name)}
              style={(() => {
                if (!comment.author?.id) return undefined;
                const u = onlineUsers.find(o => String(o.id) === String(comment.author.id));
                const resolvedColor = u?.nameColor || (comment.author as any)?.nameColor || "";
                return resolvedColor && resolvedColor !== "#000000" ? { color: resolvedColor } : undefined;
              })()}
            >
              {comment.author.name}
            </span>
            <span className="text-[8px] text-muted-foreground">
              {new Date(comment.createdAt).toLocaleString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <p className="text-xs text-foreground leading-relaxed mt-0.5" dir="rtl">
            {comment.body}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {currentUser && !comment.isOptimistic && (
              <>
                <button
                  className={`flex items-center gap-0.5 text-[9px] transition-colors ${isLiked ? "text-red-500" : "text-muted-foreground hover:text-red-500"}`}
                  onClick={handleToggleLike}
                >
                  <Heart size={10} className={isLiked ? "fill-red-500" : ""} />
                  {likeCount > 0 && <span className="font-bold">{likeCount}</span>}
                </button>
                <button
                  className="flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-primary transition-colors"
                  onClick={() => setShowReplyInput(!showReplyInput)}
                >
                  <Reply size={10} />
                  رد
                </button>
              </>
            )}
          </div>

          {showReplyInput && currentUser && (
            <div className="flex gap-1.5 mt-1.5">
              <Input
                placeholder="اكتب رداً..."
                className="h-7 text-[10px] bg-slate-100 border-none"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmitReply()}
                dir="rtl"
              />
              <EmojiPickerPopover
                onEmojiSelect={(emoji) => setReplyText((prev) => prev + emoji)}
                className="shrink-0"
              />
              <Button
                size="sm"
                className="h-7 px-2 text-[9px]"
                onClick={handleSubmitReply}
                disabled={isReplying || !replyText.trim()}
              >
                {isReplying ? <Loader2 className="animate-spin" size={10} /> : "إرسال"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {replyCount > 0 && (
        <button
          className="text-[9px] font-bold text-primary hover:text-primary/80 mr-8 mb-1 transition-colors"
          onClick={() => setShowReplies(!showReplies)}
        >
          {showReplies ? "إخفاء الردود" : `عرض الردود (${replyCount})`}
        </button>
      )}

      {showReplies && comment.replies && comment.replies.map((reply) => (
        <CommentThread
          key={reply.id}
          comment={reply}
          currentUser={currentUser}
          postId={postId}
          onReply={onReply}
          onOpenProfile={onOpenProfile}
          depth={depth + 1}
        />
      ))}
    </div>
  );
};

const WallComments = ({ postId, commentCount, currentUser, isOpen: externalOpen, onToggle, onOpenProfile }: WallCommentsProps) => {
  const { wallComments, setComments, setCommentLiked, updateCommentLikeCount } = useRealtimeStore();
  const comments = wallComments[postId] || [];
  
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = externalOpen !== undefined ? externalOpen : internalOpen;
  const [isLoading, setIsLoading] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [replyKey, setReplyKey] = useState(0);

  useEffect(() => {
    if (isOpen && !loaded) fetchComments();
  }, [isOpen]);

  // تحديث صورة المؤلف في التعليقات عند تغيير البروفايل
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onUserProfileUpdated = (data: any) => {
      if (!data?.userId) return;
      const currentComments = wallComments[postId] || [];
      if (currentComments.length === 0) return;

      const updateAuthor = (c: any): any => ({
        ...c,
        author: String(c.author?.id) === String(data.userId)
          ? { ...c.author, name: data.username || c.author.name, avatar: data.avatar || c.author.avatar }
          : c.author,
        replies: c.replies?.map(updateAuthor) || [],
      });

      setComments(postId, currentComments.map(updateAuthor));
    };
    socket.on("user_profile_updated", onUserProfileUpdated);
    return () => { socket.off("user_profile_updated", onUserProfileUpdated); };
  }, [postId, wallComments, setComments]);

  const fetchComments = async () => {
    if (loaded) return;
    setIsLoading(true);
    try {
      const userIdParam = currentUser?.id ? `&userId=${encodeURIComponent(currentUser.id)}` : "";
      const res = await fetch(`/api/wall/comments?postId=${postId}${userIdParam}`);
      const data = await res.json();
      if (data.success) {
        setComments(postId, data.comments || []);
        setLoaded(true);

        const walk = (list: any[]) => {
          for (const c of list) {
            if (c.likeCount !== undefined) updateCommentLikeCount(c.id, c.likeCount);
            if (c.userLiked !== undefined) setCommentLiked(c.id, c.userLiked);
            if (c.replies?.length) walk(c.replies);
          }
        };
        walk(data.comments || []);
      }
    } catch (err) {
      console.error("Failed to fetch comments", err);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleOpen = () => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalOpen(!internalOpen);
    }
  };

  // عند إغلاق القسم → إعادة تعيين ردود التعليقات المفتوحة
  const handleClose = () => {
    setReplyKey(prev => prev + 1);
    if (onToggle) {
      onToggle();
    } else {
      setInternalOpen(false);
    }
  };

  const handlePostComment = async () => {
    if (!newComment.trim() || !currentUser) return;
    setIsPosting(true);
    const content = newComment;
    setNewComment(""); // تفريغ الحقل فوراً (Display-First)

    try {
      await optimisticAddComment(postId, content, currentUser);
      showSuccess("تم إضافة التعليق");
    } catch (err: any) {
      setNewComment(content); // استرجاع النص في حال الفشل
      showError(err.message || "حدث خطأ أثناء إضافة التعليق");
    } finally {
      setIsPosting(false);
    }
  };

  const handleReply = async (parentId: string, text: string) => {
    if (!currentUser) return;
    try {
      await optimisticAddComment(postId, text, currentUser, parentId);
      showSuccess("تم إضافة الرد");
    } catch (err: any) {
      showError(err.message || "فشل إضافة الرد");
    }
  };

  return (
    <div className="border-t">
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 w-full text-left hover:bg-slate-50 transition-colors"
        onClick={isOpen ? handleClose : toggleOpen}
      >
        <span className="text-[10px] font-bold text-primary">
          {isOpen ? "إخفاء التعليقات" : `عرض التعليقات (${commentCount})`}
        </span>
      </button>

      {isOpen && (
        <div className="px-3 pb-2">
          {isLoading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="animate-spin text-primary" size={16} />
            </div>
          ) : comments.length === 0 ? (
            <p className="text-[10px] text-muted-foreground text-center py-2">لا توجد تعليقات بعد</p>
          ) : (
            <div className="space-y-1" key={replyKey}>
              {comments.map((comment) => (
                <CommentThread
                  key={comment.id}
                  comment={comment}
                  currentUser={currentUser}
                  postId={postId}
                  onReply={handleReply}
                  onOpenProfile={onOpenProfile}
                />
              ))}
            </div>
          )}

          {currentUser && (
            <div className="flex gap-1.5 mt-2 pt-2 border-t">
              <Avatar className="w-11 h-11 rounded-lg shrink-0">
                <AvatarImage src={currentUser.avatar || "/pic.png"} />
                <AvatarFallback className="text-[10px]">{currentUser.name?.[0]}</AvatarFallback>
              </Avatar>
              <Input
                placeholder="اكتب تعليقاً..."
                className="h-7 text-[10px] bg-slate-100 border-none"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePostComment()}
                dir="rtl"
              />
              <EmojiPickerPopover
                onEmojiSelect={(emoji) => setNewComment((prev) => prev + emoji)}
                className="shrink-0"
              />
              <Button
                size="sm"
                className="h-7 px-2 text-[9px]"
                onClick={handlePostComment}
                disabled={isPosting || !newComment.trim()}
              >
                {isPosting ? <Loader2 className="animate-spin" size={10} /> : "تعليق"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WallComments;
