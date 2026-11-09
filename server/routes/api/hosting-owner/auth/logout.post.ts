import { defineEventHandler, setCookie, setResponseHeader } from "h3";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setCookie(event, "hosting_owner_session", "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/api/hosting-owner",
    maxAge: 0,
  });
  return { success: true };
});
