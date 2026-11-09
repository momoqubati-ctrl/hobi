import assert from "node:assert/strict";
import test from "node:test";
import { getResponseStatus, mockEvent } from "h3";
import { createBatchStatsHandler } from "../server/routes/api/users/batch-stats.get";

test("batch stats loads members and follow counts with one query and no request-time DDL", async () => {
  const statements: string[] = [];
  const handler = createBatchStatsHandler({
    query: async (text) => {
      statements.push(text);
      return {
        rows: [{
          id: "member-1",
          avatar: "/pic.png",
          cover: "/pich.png",
          statusMsg: "Available",
          nameColor: "",
          avatarFrameUrl: "",
          giftedBannerUrl: "",
          giftedGiftIconUrl: "",
          giftedPromotionIconUrl: "",
          roleIconUrl: null,
          memberCardBgUrl: "",
          evaluation: "12",
          rep: "3",
          coins: "50",
          likes: "4",
          giftsReceivedCount: "2",
          followerCount: "7",
          followingCount: "5",
          isFollowedByMe: true,
        }],
      };
    },
  });

  const event = mockEvent(
    "/api/users/batch-stats?ids=member-1&currentUserId=viewer-1",
  );
  const response = await handler(event);

  assert.equal(getResponseStatus(event), 200);
  assert.equal(statements.length, 1);
  assert.doesNotMatch(statements[0], /CREATE\s+TABLE/i);
  assert.deepEqual(response, {
    success: true,
    stats: {
      "member-1": {
        avatar: "/pic.png",
        cover: "/pich.png",
        statusMsg: "Available",
        nameColor: "",
        avatarFrameUrl: "",
        giftedBannerUrl: "",
        giftedGiftIconUrl: "",
        giftedPromotionIconUrl: "",
        roleIconUrl: "",
        memberCardBgUrl: "",
        evaluation: 12,
        rep: 3,
        coins: 50,
        likes: 4,
        giftsReceivedCount: 2,
        followerCount: 7,
        followingCount: 5,
        isFollowedByMe: true,
      },
    },
  });
});
