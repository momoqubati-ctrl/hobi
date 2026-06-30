import { randomUUID } from "node:crypto";

export type AuthRole = "guest" | "member" | "moderator" | "admin" | "owner";

let memberSequence = 100;

const randomDigits = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));
const randomToken = () => randomUUID().replaceAll("-", "");

export type UserProfileDefaults = {
  idreg: string;
  lid: string;
  uid: string;
  profileMsg: string;
  bio: string;
  mood: string;
  customStatus: string;
  stealth: boolean;
  youtubeUrl: string;
  autoplayEnabled: boolean;
  avatar: string;
  profileCover: string;
  profileBannerUrl: string;
  profileThemeId: string;
  avatarFrameUrl: string;
  giftIconUrl: string;
  memberCardBgUrl: string;
  profileIconUrl: string;
  nameGradient: string;
  nameEffectId: string;
  messageBubbleStyle: string;
  profileAccentColor: string;
  profileBackgroundUrl: string;
  backgroundColor: string;
  messageColor: string;
  nameColor: string;
  gradientColor: string;
  evaluation: number;
  rep: number;
  coins: number;
  wallPostLikes: number;
  giftsReceivedCount: number;
  power: string;
  icon: string;
  giftIcon: string;
  isLogin: "زائر" | "عضو";
  muted: boolean;
  documents: boolean;
  busy: boolean;
  alerts: boolean;
  nopmcall: boolean;
  nopmvideocall: boolean;
  roomId: string;
  siteBadgeId: string;
  siteBadge: string;
  joinuser: number;
};

export const createUserProfileDefaults = (role: AuthRole): UserProfileDefaults => {
  const isGuest = role === "guest";
  const idNumber = isGuest ? randomDigits(300, 900) : ++memberSequence + randomDigits(1000, 999999);

  return {
    idreg: `#${idNumber}`,
    lid: randomToken().slice(0, 31),
    uid: randomToken().slice(0, 22),
    profileMsg: isGuest ? "( غير مسجل )" : "(عضو جديد)",
    bio: "",
    mood: "",
    customStatus: "",
    stealth: false,
    youtubeUrl: "",
    autoplayEnabled: false,
    avatar: "/pic.png",
    profileCover: "/pich.png",
    profileBannerUrl: "/pich.png",
    profileThemeId: "",
    avatarFrameUrl: "",
    giftIconUrl: "",
    memberCardBgUrl: "",
    profileIconUrl: "",
    nameGradient: "",
    nameEffectId: "",
    messageBubbleStyle: "default",
    profileAccentColor: "#2563EB",
    profileBackgroundUrl: "",
    backgroundColor: "#FFFFFF",
    messageColor: "#000000",
    nameColor: "#000000",
    gradientColor: "#FFFFFF",
    evaluation: 0,
    rep: 0,
    coins: 0,
    wallPostLikes: 0,
    giftsReceivedCount: 0,
    power: "",
    icon: "",
    giftIcon: "",
    isLogin: isGuest ? "زائر" : "عضو",
    muted: false,
    documents: false,
    busy: false,
    alerts: false,
    nopmcall: false,
    nopmvideocall: false,
    roomId: "general",
    siteBadgeId: "",
    siteBadge: "",
    joinuser: Date.now(),
  };
};
