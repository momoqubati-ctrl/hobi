import { defineEventHandler } from "h3";
import { requireWalletAgent } from "../../../services/walletAgentAccess";

export default defineEventHandler(async (event) => {
  const agent = await requireWalletAgent(event, true);
  if (!agent.ok) return { success: false, message: agent.message };

  return {
    success: true,
    agent: {
      id: agent.id,
      username: agent.username,
      name: agent.name,
      phone: agent.phone,
      forcePasswordChange: agent.force_password_change,
    },
  };
});
