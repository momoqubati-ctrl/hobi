import { getCookie, getRequestHeader, type H3Event, setResponseStatus } from "h3";
import { verifyAuthToken } from "./authService";
import {
  getHostingOwnerPortalPath,
  isValidHostingOwnerPortalKey,
} from "./hostingOwnerPortal";

const SESSION_COOKIE = "hosting_owner_session";

export const getHostingOwnerContext = (event: H3Event) => {
  if (!getHostingOwnerPortalPath()) {
    return { ok: false as const, statusCode: 503, message: "بوابة مالك الاستضافة غير مهيأة" };
  }
  if (!isValidHostingOwnerPortalKey(getRequestHeader(event, "x-hosting-owner-portal-key"))) {
    return { ok: false as const, statusCode: 404, message: "الصفحة غير موجودة" };
  }

  const authorization = getRequestHeader(event, "authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : getCookie(event, SESSION_COOKIE) || "";
  const claims = verifyAuthToken(token);
  if (
    !claims ||
    claims.role !== "hosting_owner" ||
    claims.type !== "hosting_owner" ||
    claims.sub !== claims.username
  ) {
    return { ok: false as const, statusCode: 401, message: "جلسة مالك الاستضافة غير صالحة" };
  }

  return { ok: true as const, id: claims.sub, username: claims.username };
};

export const requireHostingOwner = (event: H3Event) => {
  const owner = getHostingOwnerContext(event);
  if (!owner.ok) {
    setResponseStatus(event, owner.statusCode);
    return owner;
  }
  return owner;
};
