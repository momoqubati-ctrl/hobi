export interface VoiceStageSeatIdentity {
  userId?: string | null;
}

export function getNewlyJoinedStagePeers(
  previousStagePeerIds: ReadonlySet<string> | null,
  seats: readonly (VoiceStageSeatIdentity | null)[],
  currentUserId: string,
) {
  const stagePeerIds = new Set(
    seats
      .filter((seat): seat is VoiceStageSeatIdentity => Boolean(seat?.userId))
      .map((seat) => String(seat.userId))
      .filter((userId) => userId !== currentUserId),
  );

  return {
    stagePeerIds,
    newlyJoinedPeerIds: previousStagePeerIds
      ? [...stagePeerIds].filter((userId) => !previousStagePeerIds.has(userId))
      : [],
  };
}
