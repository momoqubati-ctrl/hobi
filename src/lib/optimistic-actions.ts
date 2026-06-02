import { useRealtimeStore } from './realtime-store';
import { getSocket } from './socket';

// توليد معرف مؤقت فريد
function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * إرسال منشور حائط — البث المباشر من السيرفر يضيفه للمخزن
 */
export function optimisticCreatePost(content: string, currentUser: any, mediaUrls?: string[]): Promise<any> {
  const socket = getSocket();

  return new Promise((resolve, reject) => {
    socket.emit("wall:create_post", { content, mediaUrls }, (res: any) => {
      if (res?.success && res?.post) {
        resolve(res.post);
      } else {
        reject(new Error(res?.error || "فشل نشر المنشور"));
      }
    });
  });
}

/**
 * الإعجاب / إلغاء الإعجاب بمنشور — تحديث فوري + حفظ في الخلفية
 */
export function optimisticToggleLike(postId: string): Promise<any> {
  const socket = getSocket();
  const store = useRealtimeStore.getState();
  const strId = String(postId);

  // تحديث فوري: تحديد الحالة المعاكسة
  const wasLiked = store.wallLikedPosts.has(strId);
  const nextLiked = !wasLiked;

  // تطبيق فوري على الواجهة (القلب الأحمر + العداد)
  store.toggleLike(postId, nextLiked);

  return new Promise((resolve, reject) => {
    socket.emit("wall:toggle_like", { postId }, (res: any) => {
      if (res?.success) {
        // تأكيد: ضبط العداد بالقيمة الفعلية من السيرفر
        if (res.likeCount !== undefined) {
          store.updateLikeCount(postId, res.likeCount);
        }
        resolve(res);
      } else {
        // تراجع: إعادة الحالة السابقة
        store.toggleLike(postId, wasLiked);
        reject(new Error(res?.error || "فشل تحديث الإعجاب"));
      }
    });
  });
}

/**
 * الإعجاب / إلغاء الإعجاب بتعليق — تحديث فوري + حفظ في الخلفية
 */
export function optimisticToggleCommentLike(commentId: string): Promise<any> {
  const socket = getSocket();
  const store = useRealtimeStore.getState();
  const strId = String(commentId);

  const wasLiked = store.wallCommentLiked.has(strId);
  const nextLiked = !wasLiked;

  // تطبيق فوري على الواجهة
  store.toggleCommentLike(commentId, nextLiked);

  return new Promise((resolve, reject) => {
    socket.emit("wall:toggle_comment_like", { commentId }, (res: any) => {
      if (res?.success) {
        if (res.likeCount !== undefined) {
          store.updateCommentLikeCount(commentId, res.likeCount);
        }
        resolve(res);
      } else {
        store.toggleCommentLike(commentId, wasLiked);
        reject(new Error(res?.error || "فشل تحديث الإعجاب"));
      }
    });
  });
}

/**
 * إضافة تعليق — البث المباشر من السيرفر يضيفه للمخزن
 */
export function optimisticAddComment(postId: string, content: string, currentUser: any, parentId?: string): Promise<any> {
  const socket = getSocket();

  return new Promise((resolve, reject) => {
    socket.emit("wall:add_comment", { postId, content, parentId }, (res: any) => {
      if (res?.success && res?.comment) {
        resolve(res.comment);
      } else {
        reject(new Error(res?.error || "فشل إضافة التعليق"));
      }
    });
  });
}

/**
 * إرسال بريد داخلي متفائلاً
 */
export function optimisticSendMail(recipientId: string, subject: string, body: string, currentUser: any): Promise<any> {
  const socket = getSocket();
  const store = useRealtimeStore.getState();
  const tempId = generateTempId();

  const optimisticMail = {
    id: tempId,
    subject,
    body,
    createdAt: new Date().toISOString(),
    isRead: false,
    sender: {
      id: currentUser.id,
      name: currentUser.username || currentUser.name || "أنا",
      avatar: currentUser.avatar || "/pic.png",
    },
    recipient: {
      id: recipientId,
      name: "جاري الإرسال...",
      avatar: "/pic.png",
    },
    isOptimistic: true,
  };

  // 1. إضافة إلى الصندوق الصادر فوراً
  store.addMailToOutbox(optimisticMail);

  return new Promise((resolve, reject) => {
    // 2. إرسال للسيرفر
    socket.emit("mail:send", { tempId, recipientId, subject, body }, (res: any) => {
      if (res?.success && res?.mail) {
        // 3. نجاح: استبدال البريد المؤقت بالحقيقي
        useRealtimeStore.setState((state) => ({
          outbox: state.outbox.map((m) =>
            m.id === tempId ? { ...res.mail, isOptimistic: false } : m
          )
        }));
        resolve(res.mail);
      } else {
        // 4. فشل: إزالة البريد الصادر المؤقت
        useRealtimeStore.setState((state) => ({
          outbox: state.outbox.filter((m) => m.id !== tempId)
        }));
        reject(new Error(res?.error || "فشل إرسال البريد"));
      }
    });
  });
}
