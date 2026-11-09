import { publishSocketEvent } from "./SocketBroker";

type MailIdentity = {
  senderId: string | number;
  recipientId: string | number;
};

type UserRoomPublisher = (
  roomId: string,
  event: string,
  payload: unknown,
) => Promise<void>;

export async function publishMailToParticipants(
  mail: MailIdentity,
  payload: unknown,
  publish: UserRoomPublisher = publishSocketEvent,
): Promise<void> {
  const participantIds = [mail.senderId, mail.recipientId].map((id) => String(id ?? "").trim());
  if (participantIds.some((id) => !id)) {
    throw new Error("Cannot publish mail without participant IDs");
  }
  const uniqueParticipantIds = [...new Set(participantIds)];

  await Promise.all(
    uniqueParticipantIds.map((userId) => publish(`social:${userId}`, "internal_mail", payload)),
  );
}
