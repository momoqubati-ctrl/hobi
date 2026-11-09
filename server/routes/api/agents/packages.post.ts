import { defineEventHandler, readBody, setResponseHeader, setResponseStatus } from "h3";
import { AgentPackageError, saveAgentPackage } from "../../../services/agentPackageService";
import { requireWalletAgent } from "../../../services/walletAgentAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const agent = await requireWalletAgent(event);
  if (!agent.ok) return { success: false, code: "AGENT_ACCESS_DENIED", message: agent.message };
  const body = await readBody<Record<string, unknown> | null>(event);
  if (
    !body ||
    Array.isArray(body) ||
    Object.keys(body).some((key) =>
      !["coinAmount", "priceMinorUnits", "currencyCode", "paymentInstructions"].includes(key),
    ) ||
    typeof body.coinAmount !== "number" ||
    typeof body.priceMinorUnits !== "number" ||
    typeof body.currencyCode !== "string" ||
    typeof body.paymentInstructions !== "string"
  ) {
    setResponseStatus(event, 422);
    return { success: false, code: "INVALID_AGENT_PACKAGE", message: "بيانات باقة العملات غير صالحة" };
  }

  try {
    return {
      success: true,
      package: await saveAgentPackage({
        agentId: agent.id,
        coinAmount: body.coinAmount,
        priceMinorUnits: body.priceMinorUnits,
        currencyCode: body.currencyCode.toUpperCase(),
        paymentInstructions: body.paymentInstructions,
      }),
    };
  } catch (error) {
    if (error instanceof AgentPackageError) {
      setResponseStatus(event, error.code === "INVALID_AGENT_PACKAGE" ? 422 : 409);
      return { success: false, code: error.code, message: error.message };
    }
    console.error("[Agent Packages] Failed to save package:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "AGENT_PACKAGE_SAVE_FAILED", message: "تعذر حفظ باقة العملات" };
  }
});
