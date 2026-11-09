import assert from "node:assert/strict";
import test from "node:test";
import {
  getAnnouncementOnlineUsers,
  getAllOnlineUsers,
  getRoomMembers,
  isUserConnectedToRoom,
  type OnlineUser,
} from "../server/socket/presenceManager";

test("announcement audience can read connected users and rooms across Vite runtime globals", async () => {
  const globalRuntime = globalThis as typeof globalThis & {
    __vite_connected_users__?: Map<string, OnlineUser>;
    __vite_room_members_map__?: Map<string, Set<string>>;
  };
  const processRuntime = process as NodeJS.Process & {
    __vite_connected_users__?: Map<string, OnlineUser>;
    __vite_room_members_map__?: Map<string, Set<string>>;
  };
  const previousGlobal = globalRuntime.__vite_connected_users__;
  const previousGlobalRooms = globalRuntime.__vite_room_members_map__;
  const previousProcess = processRuntime.__vite_connected_users__;
  const previousProcessRooms = processRuntime.__vite_room_members_map__;
  const connectedUser: OnlineUser = {
    id: "vite-member-1",
    socketId: "vite-socket-1",
    username: "vite-member",
    role: "member",
    avatar: "/pic.png",
    countryCode: "SA",
    avatarFrameUrl: "",
    giftIconUrl: "",
    memberCardBgUrl: "",
    nameColor: "",
    messageColor: "",
    statusFontColor: "",
    messageBubbleStyle: "default",
    roomId: "room-1",
    connectedAt: "2026-10-31T12:00:00.000Z",
    status: "online",
    idreg: "",
    siteBadge: "",
    statusMsg: "",
    giftedBannerUrl: "",
    giftedGiftIconUrl: "",
    giftedPromotionIconUrl: "",
    roleIconUrl: "",
    youtubeUrl: "",
  };
  delete globalRuntime.__vite_connected_users__;
  delete globalRuntime.__vite_room_members_map__;
  processRuntime.__vite_connected_users__ = new Map([[connectedUser.socketId, connectedUser]]);
  processRuntime.__vite_room_members_map__ = new Map([
    ["room-1", new Set([connectedUser.socketId])],
  ]);

  try {
    const users = await getAllOnlineUsers();
    assert.ok(users.some((user) => user.id === connectedUser.id));
    const roomMembers = await getRoomMembers("room-1");
    assert.ok(roomMembers.some((user) => user.id === connectedUser.id));
  } finally {
    if (previousGlobal) globalRuntime.__vite_connected_users__ = previousGlobal;
    else delete globalRuntime.__vite_connected_users__;
    if (previousGlobalRooms) globalRuntime.__vite_room_members_map__ = previousGlobalRooms;
    else delete globalRuntime.__vite_room_members_map__;
    if (previousProcess) processRuntime.__vite_connected_users__ = previousProcess;
    else delete processRuntime.__vite_connected_users__;
    if (previousProcessRooms) processRuntime.__vite_room_members_map__ = previousProcessRooms;
    else delete processRuntime.__vite_room_members_map__;
  }
});

test("announcement audience reads users from the separate Vite socket runtime", async () => {
  const globalRuntime = globalThis as typeof globalThis & {
    __vite_connected_users__?: Map<string, OnlineUser>;
  };
  const processRuntime = process as NodeJS.Process & {
    __vite_connected_users__?: Map<string, OnlineUser>;
  };
  const previousGlobal = globalRuntime.__vite_connected_users__;
  const previousProcess = processRuntime.__vite_connected_users__;
  const remoteUser = {
    id: "vite-announcement-member",
    role: "member",
    roomId: "room-1",
  };
  delete globalRuntime.__vite_connected_users__;
  delete processRuntime.__vite_connected_users__;

  try {
    const users = await getAnnouncementOnlineUsers(async () => [remoteUser]);
    assert.deepEqual(users, [remoteUser]);
  } finally {
    if (previousGlobal) globalRuntime.__vite_connected_users__ = previousGlobal;
    else delete globalRuntime.__vite_connected_users__;
    if (previousProcess) processRuntime.__vite_connected_users__ = previousProcess;
    else delete processRuntime.__vite_connected_users__;
  }
});

test("room membership checks the Vite bridge when the API runtime has no local presence", async () => {
  const globalRuntime = globalThis as typeof globalThis & {
    __vite_connected_users__?: Map<string, OnlineUser>;
    __vite_room_members_map__?: Map<string, Set<string>>;
    __socket_io_instance__?: unknown;
  };
  const processRuntime = process as NodeJS.Process & {
    __vite_connected_users__?: Map<string, OnlineUser>;
    __vite_room_members_map__?: Map<string, Set<string>>;
    __socket_io_instance__?: unknown;
  };
  const previousValues = {
    globalUsers: globalRuntime.__vite_connected_users__,
    globalRooms: globalRuntime.__vite_room_members_map__,
    globalIo: globalRuntime.__socket_io_instance__,
    processUsers: processRuntime.__vite_connected_users__,
    processRooms: processRuntime.__vite_room_members_map__,
    processIo: processRuntime.__socket_io_instance__,
  };
  delete globalRuntime.__vite_connected_users__;
  delete globalRuntime.__vite_room_members_map__;
  delete globalRuntime.__socket_io_instance__;
  delete processRuntime.__vite_connected_users__;
  delete processRuntime.__vite_room_members_map__;
  delete processRuntime.__socket_io_instance__;

  try {
    const fetchRemoteUsers = async () => [
      { id: "member-1", role: "member", roomId: "room-1" },
    ];

    assert.equal(
      await isUserConnectedToRoom("member-1", "room-1", fetchRemoteUsers),
      true,
    );
    assert.equal(
      await isUserConnectedToRoom("member-1", "room-2", fetchRemoteUsers),
      false,
    );
    assert.equal(
      await isUserConnectedToRoom("member-2", "room-1", fetchRemoteUsers),
      false,
    );
  } finally {
    if (previousValues.globalUsers) globalRuntime.__vite_connected_users__ = previousValues.globalUsers;
    else delete globalRuntime.__vite_connected_users__;
    if (previousValues.globalRooms) globalRuntime.__vite_room_members_map__ = previousValues.globalRooms;
    else delete globalRuntime.__vite_room_members_map__;
    if (previousValues.globalIo) globalRuntime.__socket_io_instance__ = previousValues.globalIo;
    else delete globalRuntime.__socket_io_instance__;
    if (previousValues.processUsers) processRuntime.__vite_connected_users__ = previousValues.processUsers;
    else delete processRuntime.__vite_connected_users__;
    if (previousValues.processRooms) processRuntime.__vite_room_members_map__ = previousValues.processRooms;
    else delete processRuntime.__vite_room_members_map__;
    if (previousValues.processIo) processRuntime.__socket_io_instance__ = previousValues.processIo;
    else delete processRuntime.__socket_io_instance__;
  }
});
