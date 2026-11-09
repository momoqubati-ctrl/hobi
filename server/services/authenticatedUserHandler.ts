import { defineEventHandler, setResponseStatus, type H3Event } from "h3";
import { getUserAuthContext } from "./adminAccess";

type AuthContext = ReturnType<typeof getUserAuthContext>;
type AuthenticatedContext = Extract<AuthContext, { ok: true }>;

export function createAuthenticatedUserHandler(
  handler: (event: H3Event, auth: AuthenticatedContext) => unknown | Promise<unknown>,
  authenticate: (event: H3Event) => AuthContext = getUserAuthContext,
) {
  return defineEventHandler(async (event) => {
    const auth = authenticate(event);
    if (!auth.ok || !auth.userId) {
      setResponseStatus(event, auth.ok ? 401 : auth.statusCode);
      return { success: false, message: auth.ok ? "جلسة غير صالحة" : auth.message };
    }

    return handler(event, auth);
  });
}
