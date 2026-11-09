type GiftIdentity = {
  id?: unknown;
  role?: unknown;
};

const normalizeIdentity = (identity: GiftIdentity): { id: string; role: string } => ({
  id: typeof identity.id === "string" || typeof identity.id === "number"
    ? String(identity.id).trim()
    : "",
  role: typeof identity.role === "string" ? identity.role.trim().toLowerCase() : "",
});

const isNonMember = (role: string) =>
  ["guest", "visitor", "زائر", "bot", "system"].includes(role);

export const canSendContextualGift = (
  sender: GiftIdentity,
  recipient: GiftIdentity,
): boolean => {
  const normalizedSender = normalizeIdentity(sender);
  const normalizedRecipient = normalizeIdentity(recipient);

  return Boolean(
    normalizedSender.id &&
    normalizedSender.id !== "0" &&
    normalizedRecipient.id &&
    normalizedRecipient.id !== "0" &&
    normalizedSender.id !== normalizedRecipient.id &&
    !isNonMember(normalizedSender.role) &&
    !isNonMember(normalizedRecipient.role),
  );
};
