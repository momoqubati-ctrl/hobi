/**
 * Realistic Mock Profile Fixtures for Isolated Benchmarking (TB-01 & TB-02)
 * Designed to match server/socket/profileHandlers.ts and src/components/profile/ProfileModal.tsx
 */

export interface MockProfileBundle {
  profile: any;
  stats: any;
  relationship: {
    isSelf: boolean;
    isFollowing: boolean;
    cooldownRemaining: number;
  };
  visitors: any[];
}

export const mockProfiles: Record<string, MockProfileBundle> = {
  "user-standard-1": {
    profile: {
      id: "user-standard-1",
      username: "سارة_المصممة",
      displayName: "سارة أحمد",
      role: "member",
      power: "0",
      avatarUrl: "/pic.png",
      coverUrl: "/pich.png",
      countryCode: "SA",
      presence: "online",
      connectedAt: new Date(Date.now() - 3600000).toISOString(),
      roomId: "room-general",
      documentationc: true,
      idreg: "10042",
      level: 12,
      exp: 4500,
      profile: {
        evaluation: 1250,
        level: 12,
        documents: true,
        profileMsg: "مرحباً بكم في ملفي الشخصي! مصممة واجهات ومحبة للبرمجة ✨",
        bannerUrl: "/pich.png",
        avatarUrl: "/pic.png",
        memberCardBgUrl: "",
        nameColor: "#3b82f6",
        messageColor: "#1e293b",
        statusFontColor: "#059669",
        giftedBannerUrl: "",
        giftedGiftIconUrl: "",
        giftedPromotionIconUrl: "",
        youtubeUrl: "",
      },
    },
    stats: {
      evaluation: 1250,
      likes: 342,
      followers: 128,
      following: 84,
      visitors: 1540,
      points: 2890,
      gifts: 47,
      views: 3200,
      coins: 650,
    },
    relationship: {
      isSelf: false,
      isFollowing: true,
      cooldownRemaining: 0,
    },
    visitors: [
      { id: "vis-1", username: "فهد_الرياض", avatar: "/pic.png", visitedAt: new Date(Date.now() - 600000).toISOString() },
      { id: "vis-2", username: "نورة_العتيبي", avatar: "/pic.png", visitedAt: new Date(Date.now() - 1200000).toISOString() },
      { id: "vis-3", username: "خالد_الملك", avatar: "/pic.png", visitedAt: new Date(Date.now() - 3600000).toISOString() },
    ],
  },

  "user-admin-self": {
    profile: {
      id: "user-admin-self",
      username: "المدير_العام",
      displayName: "إدارة النظام",
      role: "owner",
      power: "ispower",
      avatarUrl: "/pic.png",
      coverUrl: "/pich.png",
      countryCode: "SA",
      presence: "online",
      connectedAt: new Date(Date.now() - 7200000).toISOString(),
      roomId: "room-vip",
      documentationc: true,
      idreg: "10001",
      level: 50,
      exp: 99999,
      profile: {
        evaluation: 9999,
        level: 50,
        documents: true,
        profileMsg: "الحساب الرسمي لإدارة المنصة والدعم الفني 🛡️",
        bannerUrl: "/pich.png",
        avatarUrl: "/pic.png",
        memberCardBgUrl: "",
        nameColor: "#f59e0b",
        messageColor: "#b45309",
        statusFontColor: "#d97706",
        giftedBannerUrl: "",
        giftedGiftIconUrl: "",
        giftedPromotionIconUrl: "",
        youtubeUrl: "",
      },
    },
    stats: {
      evaluation: 9999,
      likes: 5420,
      followers: 2450,
      following: 12,
      visitors: 45200,
      points: 88500,
      gifts: 512,
      views: 98000,
      coins: 15400,
    },
    relationship: {
      isSelf: true,
      isFollowing: false,
      cooldownRemaining: 0,
    },
    visitors: [
      { id: "vis-4", username: "ماجد_جدة", avatar: "/pic.png", visitedAt: new Date(Date.now() - 300000).toISOString() },
      { id: "vis-5", username: "عبير_الورد", avatar: "/pic.png", visitedAt: new Date(Date.now() - 900000).toISOString() },
    ],
  },
};
