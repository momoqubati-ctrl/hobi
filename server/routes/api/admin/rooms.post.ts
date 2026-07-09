import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";
import { invalidateRoomCache } from "../../../services/chatStore";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) {
    setResponseStatus(event, admin.statusCode);
    return { success: false, message: admin.message };
  }

  try {
    const body = await readBody(event);
    const {
      name,
      slug,
      description,
      maxMembers,
      micSlots,
      isPublic,
      avatarUrl,
      ownerUsername,
      likesRequired,
      roomColor,
      password,
      isPinned,
      welcomeMessage,
      stageLocks,
      localSendMode,
      verified,
      roomLayout,
    } = body || {};

    if (!name || !slug) {
      return { success: false, message: "اسم الغرفة ورابطها مطلوبان" };
    }

    const safeSlug = String(slug).toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!safeSlug) {
      return { success: false, message: "رابط الغرفة غير صالح" };
    }

    const existingRoom = await dbPool.query("SELECT idroom FROM rooms WHERE slug = $1 LIMIT 1", [safeSlug]);
    if ((existingRoom.rowCount || 0) > 0) {
      return { success: false, message: "رابط الغرفة مستخدم بالفعل، اختر رابطاً آخر" };
    }

    let ownerRef = "#0";
    let ownerUser = "system";
    if (ownerUsername && ownerUsername !== "system") {
      const owner = await dbPool.query("SELECT idreg, username FROM users WHERE username = $1 LIMIT 1", [ownerUsername]);
      if ((owner.rowCount || 0) === 0) {
        return { success: false, message: "اسم مالك الغرفة غير موجود" };
      }
      ownerRef = `#${owner.rows[0].idreg}`;
      ownerUser = owner.rows[0].username;
    }

    const stageState = Object.fromEntries(
      Object.entries(stageLocks || {}).map(([key, value]) => [key, value ? 1 : 0]),
    );
    const roomOwnerMeta = {
      ownerId: ownerRef,
      ownerUser,
      ownerTopic: ownerUser,
      badge_id: "",
      badge: { name: "", bg: "", icon: "", bg_type: "static" },
      assignments: [],
    };

    const created = await dbPool.query(
      `INSERT INTO rooms
        (about, "user", pass, slug, owner, topic, name, pic, rmli, mic, welcome, broadcast, deleted, needpass, color, max, stage_count, stage_state, room_owner_meta, message_mode, verified, room_layout, is_public)
       VALUES
        ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, 0, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       RETURNING *`,
      [
        description || "",
        ownerUser,
        password || "",
        safeSlug,
        ownerRef,
        name,
        avatarUrl || "room.png",
        parseInt(likesRequired, 10) || 0,
        parseInt(micSlots, 10) || 5,
        welcomeMessage || "",
        isPinned ? 1 : 0,
        isPublic === false || password ? 1 : 0,
        roomColor || "#000000",
        parseInt(maxMembers, 10) || 50,
        Math.max(parseInt(micSlots, 10) || 5, 1),
        JSON.stringify(stageState),
        JSON.stringify(roomOwnerMeta),
        localSendMode || "real",
        verified ? 1 : 0,
        roomLayout || "normal",
        isPublic === false ? false : true,
      ],
    );

    invalidateRoomCache();

    return {
      success: true,
      message: "تم إنشاء الغرفة بنجاح",
      room: created.rows[0],
    };
  } catch (error) {
    console.error("Create room error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "حدث خطأ أثناء إنشاء الغرفة" };
  }
});
