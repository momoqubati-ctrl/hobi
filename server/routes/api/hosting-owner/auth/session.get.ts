import {
  defineEventHandler,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { getHostingOwnerContext } from "../../../../services/hostingOwnerAccess";

export const createHostingOwnerSessionHandler = () =>
  defineEventHandler((event) => {
    setResponseHeader(event, "Cache-Control", "no-store");
    setResponseHeader(event, "Referrer-Policy", "no-referrer");

    const owner = getHostingOwnerContext(event);
    if (!owner.ok) {
      if (owner.statusCode === 401) {
        return { success: true, authenticated: false };
      }

      setResponseStatus(event, owner.statusCode);
      return {
        success: false,
        code: "HOSTING_OWNER_ACCESS_DENIED",
        message: owner.message,
      };
    }

    return {
      success: true,
      authenticated: true,
      owner: { username: owner.username },
    };
  });

export default createHostingOwnerSessionHandler();
