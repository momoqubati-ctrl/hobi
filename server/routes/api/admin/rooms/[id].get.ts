import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";
import { getUserAuthContext } from "../../../../services/adminAccess";
import { getUserContext } from "../../../../services/permissionEngine";

export default defineEventHandler(async (event) => {
  const auth = getUserAuthContext(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { success: false, message: auth.message };
  }

  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { success: false, message: "معرف الغرفة مطلوب" };
  }

  try {
    const results = await dbPool.query(
      `SELECT
         r.idroom AS id,
         r.id AS slug,
         r.topic AS name,
         r.about AS description,
         COALESCE(r.needpass, 0) = 0 AS "isPublic",
         COALESCE(r.pass, '') AS password,
         r.max AS "maxMembers",
         r.mic AS "micSlots",
         r.pic AS "avatarUrl",
         r.owner,
         COALESCE(NULLIF(u.display_name, ''), NULLIF(u.topic, ''), u.username) AS "ownerName",
         u.username AS "ownerUsername",
         r.color,
         r.welcome,
         r.broadcast,
         r.deleted,
         r.stage_count AS "stageCount",
         r.message_mode AS "messageMode",
         r.rmli AS "likesRequired",
         r.stage_state AS "stageState",
         r.room_owner_meta AS "roomOwnerMeta",
         COALESCE(r.verified, false) AS "verified",
         COALESCE(r.room_layout, 'normal') AS "roomLayout"
       FROM rooms r
       LEFT JOIN users u ON r.owner = CONCAT('#', u.idreg::text) OR r.user = u.username
       WHERE (CAST(r.idroom AS text) = $1 OR CAST(r.id AS text) = $1 OR r.slug = $1)
         AND COALESCE(r.deleted, 0) = 0
       LIMIT 1`,
      [id],
    );

    if ((results.rowCount || 0) === 0) {
      setResponseStatus(event, 404);
      return { success: false, message: "الغرفة غير موجودة" };
    }

    const row = results.rows[0];

    // Verify permission: owner/admin or rooms.read/edit or roomowner
    let isAuthorized = false;
    if (auth.role === "owner" || auth.role === "admin") {
      isAuthorized = true;
    } else {
      const userCtx = await getUserContext(auth.userId);
      if (
        userCtx.permissions.has("rooms.read") ||
        userCtx.permissions.has("rooms.edit") ||
        userCtx.permissions.has("rooms.all") ||
        userCtx.permissions.has("admin_rooms.read") ||
        userCtx.permissions.has("admin_rooms.edit") ||
        userCtx.permissions.has("admin_rooms.all")
      ) {
        isAuthorized = true;
      } else {
        const uRes = await dbPool.query(
          "SELECT idreg, username FROM users WHERE id = $1 OR CAST(idreg AS text) = $1 OR CAST(uid AS text) = $1 LIMIT 1",
          [auth.userId],
        );
        const uRow = uRes.rows[0];
        const isOwner = Boolean(
          uRow && (
            (uRow.idreg && row.owner === `#${uRow.idreg}`) ||
            (uRow.username && (row.user === uRow.username || row.owner === uRow.username || row.ownerUsername === uRow.username))
          )
        );
        if (isOwner || userCtx.permissions.has("roomowner.read") || userCtx.permissions.has("roomowner.edit") || userCtx.permissions.has("roomowner.all")) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      setResponseStatus(event, 403);
      return { success: false, message: "لا تملك الصلاحية لعرض تفاصيل إدارة هذه الغرفة" };
    }

    return {
      success: true,
      room: {
        id: String(row.id),
        slug: row.slug || "",
        name: row.name || "",
        description: row.description || "",
        isPublic: Boolean(row.isPublic),
        password: row.password || "",
        maxMembers: Number(row.maxMembers) || 50,
        micSlots: Number(row.micSlots) || 5,
        avatarUrl: row.avatarUrl || "",
        owner: row.owner || "",
        ownerName: row.ownerName || "",
        ownerUsername: row.ownerUsername || row.ownerName || "",
        roomColor: row.color || "#000000",
        color: row.color || "#000000",
        welcomeMessage: row.welcome || "",
        welcome: row.welcome || "",
        isPinned: Boolean(row.broadcast),
        broadcast: Boolean(row.broadcast),
        stageCount: Number(row.stageCount) || 5,
        localSendMode: row.messageMode || "real",
        messageMode: row.messageMode || "real",
        likesRequired: Number(row.likesRequired) || 0,
        stageState: row.stageState || null,
        verified: Boolean(row.verified),
        roomLayout: row.roomLayout || "normal",
      },
    };
  } catch (err: any) {
    console.error("Get room details error:", err);
    setResponseStatus(event, 500);
    return { success: false, message: "حدث خطأ أثناء جلب بيانات الغرفة" };
  }
});
