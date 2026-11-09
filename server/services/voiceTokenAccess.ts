type VoiceTokenPermissions = {
  canJoin: true;
  canSubscribe: true;
  canPublish: boolean;
  canPublishData: false;
};

export function canPublishFromSeat(
  seat: { isMuted: boolean; accountMuted?: boolean; role?: string } | null | undefined,
  accountRole?: string,
): boolean {
  if (
    !seat ||
    seat.isMuted !== false ||
    seat.accountMuted === true ||
    typeof seat.role !== "string" ||
    typeof accountRole !== "string"
  ) {
    return false;
  }

  const seatRole = seat.role.trim().toLowerCase();
  const normalizedAccountRole = accountRole.trim().toLowerCase();
  return Boolean(
    seatRole &&
    seatRole !== "guest" &&
    normalizedAccountRole &&
    normalizedAccountRole !== "guest",
  );
}

export function canAccessVoiceRoom(options: {
  isRoomMember: boolean;
  isKickedOrBanned?: boolean;
  accountStatus?: string;
}): boolean {
  if (!options.isRoomMember) return false;
  if (options.isKickedOrBanned === true) return false;
  if (options.accountStatus && options.accountStatus !== "active") return false;
  return true;
}

export function getVoiceTokenPermissions(
  isRoomMember: boolean,
  canPublish: boolean = false,
): VoiceTokenPermissions | null {
  if (!isRoomMember) return null;

  return {
    canJoin: true,
    canSubscribe: true,
    canPublish,
    canPublishData: false,
  };
}
