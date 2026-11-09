import { defineEventHandler, setCookie } from "h3";

export default defineEventHandler(async (event) => {
  setCookie(event, "wallet_agent_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/agents",
    maxAge: 0,
  });
  return { success: true };
});
