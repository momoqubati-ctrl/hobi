import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";
import { getUserAuthContext } from "../../../../services/adminAccess";
import { getUserContext } from "../../../../services/permissionEngine";
import { invalidateRoomCache } from "../../../../services/chatStore";

export default defineEventHandler(async (event) => {
  const auth = getUserAuthContext(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { success: false, message: auth.message };
  }

  const id = getRouterParam(event, "id");
  if (!id) {
    return { success: false, message: "معرف الغرفة مطلوب" };
  }

  try {
    const room = await dbPool.query(
      "SELECT idroom, owner, \"user\" FROM rooms WHERE (CAST(idroom AS text) = $1 OR CAST(id AS text) = $1 OR slug = $1) AND COALESCE(deleted, 0) = 0 LIMIT 1",
      [id],
    );

    if ((room.rowCount || 0) === 0) {
      return { success: false, message: "الغرفة غير موجودة" };
    }

    const roomRow = room.rows[0];
    const actualIdroom = roomRow.idroom;

    // Check permissions
    let isAuthorized = false;
    if (auth.role === "owner" || auth.role === "admin") {
      isAuthorized = true;
    } else {
      const userCtx = await getUserContext(auth.userId);
      if (
        userCtx.permissions.has("rooms.edit") ||
        userCtx.permissions.has("rooms.all") ||
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
            (uRow.idreg && roomRow.owner === `#${uRow.idreg}`) ||
            (uRow.username && (roomRow.user === uRow.username || roomRow.owner === uRow.username))
          )
        );
        if (isOwner || userCtx.permissions.has("roomowner.edit") || userCtx.permissions.has("roomowner.all")) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      setResponseStatus(event, 403);
      return { success: false, message: "لا تملك الصلاحية الكافية لتعديل هذه الغرفة" };
    }

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
    } = body || {};

    if (!name) {
      return { success: false, message: "اسم الغرفة مطلوب" };
    }

    if (slug) {
      const safeSlug = String(slug).toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (!safeSlug) {
        return { success: false, message: "رابط الغرفة غير صالح" };
      }
      const existing = await dbPool.query(
        "SELECT idroom FROM rooms WHERE slug = $1 AND idroom != $2 LIMIT 1",
        [safeSlug, actualIdroom],
      );
      if ((existing.rowCount || 0) > 0) {
        return { success: false, message: "رابط الغرفة مستخدم بالفعل، اختر رابطاً آخر" };
      }
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

    const stageState = stageLocks
      ? Object.fromEntries(Object.entries(stageLocks).map(([key, value]) => [key, value ? 1 : 0]))
      : undefined;

    const updated = await dbPool.query(
      `UPDATE rooms SET
        topic = COALESCE($1, topic),
        about = COALESCE($2, about),
        slug = COALESCE($3, slug),
        pic = COALESCE($4, pic),
        max = COALESCE($5, max),
        mic = COALESCE($6, mic),
        pass = COALESCE($7, pass),
        needpass = COALESCE($8, needpass),
        color = COALESCE($9, color),
        welcome = COALESCE($10, welcome),
        broadcast = COALESCE($11, broadcast),
        rmli = COALESCE($12, rmli),
        "user" = COALESCE($13, "user"),
        owner = COALESCE($14, owner),
        message_mode = COALESCE($15, message_mode),
        stage_count = GREATEST(COALESCE($16, stage_count), 1)
        ${stageState ? ", stage_state = $17" : ""}
      WHERE idroom = ${stageState ? "$18" : "$17"}
      RETURNING *`,
      [
        name || null,
        description ?? null,
        slug ? String(slug).toLowerCase().replace(/[^a-z0-9_-]/g, "") : null,
        avatarUrl || null,
        maxMembers ? parseInt(maxMembers, 10) : null,
        micSlots ? parseInt(micSlots, 10) : null,
        password || "",
        password ? 1 : (isPublic === false ? 1 : 0),
        roomColor || null,
        welcomeMessage ?? null,
        isPinned ? 1 : 0,
        likesRequired ? parseInt(likesRequired, 10) : null,
        ownerUser,
        ownerRef,
        localSendMode || null,
        micSlots ? Math.max(parseInt(micSlots, 10), 1) : null,
        stageState ? JSON.stringify(stageState) : undefined,
        actualIdroom,
      ].filter((p) => p !== undefined),
    );

    invalidateRoomCache();

    return {
      success: true,
      message: "تم تحديث الغرفة بنجاح",
      room: updated.rows[0],
    };
  } catch (err: any) {
    console.error("Update room error:", err);
    setResponseStatus(event, 500);
    return { success: false, message: "حدث خطأ أثناء تحديث الغرفة" };
  }
});
