import { isRedisEnabled, redis } from "./redis";

export interface VoiceSeat {
  seatIndex: number;
  userId: string;
  username: string;
  avatar: string;
  seatFrameUrl?: string;
  isMuted: boolean;
  isLocked: boolean;
  joinedAt: number;
}

export interface RoomVoiceStage {
  roomId: string;
  maxSeats: number;
  isVoiceChannel: boolean;
  seats: (VoiceSeat | null)[];
}

type RedisClient = typeof redis;
type StoreOptions = {
  redisEnabled?: boolean;
  nodeEnv?: string;
  redisClient?: RedisClient;
};

type SeatLocation = { roomId: string; seatIndex: number };
type SeatChange = {
  success: boolean;
  message?: string;
  stage?: RoomVoiceStage;
  previousRoomId?: string;
  previousStage?: RoomVoiceStage;
};

const KEY_PREFIX = "voice:stage:{voice-stage}";
const ROOM_TTL_SECONDS = 86400;
const SEAT_TTL_SECONDS = 300;

const ENSURE_STAGE_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
  value = ARGV[1]
  redis.call('SET', KEYS[1], value, 'EX', ARGV[2])
end
return value
`;

const GET_STAGE_SCRIPT = `
local roomId = ARGV[1]
local stageKey = KEYS[1]
local userPrefix = ARGV[2]
local activeKey = KEYS[2]
local roomTtl = tonumber(ARGV[3])
local value = redis.call('GET', stageKey)
if not value then return '' end
local stage = cjson.decode(value)
local changed = false
for index, seat in ipairs(stage.seats) do
  if seat ~= cjson.null and seat.userId and seat.userId ~= '' then
    local userKey = userPrefix .. seat.userId
    local active = redis.call('GET', userKey)
    local valid = false
    if active then
      local location = cjson.decode(active)
      valid = location.roomId == roomId and tonumber(location.seatIndex) == index - 1
    else
      redis.call('SREM', activeKey, seat.userId)
    end
    if not valid then
      stage.seats[index] = cjson.null
      changed = true
    end
  end
end
if changed then
  value = cjson.encode(stage)
  redis.call('SET', stageKey, value, 'EX', roomTtl)
end
return value
`;

const TAKE_SEAT_SCRIPT = `
local roomId = ARGV[1]
local userId = ARGV[2]
local seatJson = ARGV[3]
local seatIndex = tonumber(ARGV[4])
local initialStage = ARGV[5]
local roomPrefix = ARGV[6]
local roomTtl = tonumber(ARGV[7])
local seatTtl = tonumber(ARGV[8])
local stageKey = KEYS[1]
local userKey = KEYS[2]
local activeKey = KEYS[3]
local value = redis.call('GET', stageKey) or initialStage
local stage = cjson.decode(value)
local target = stage.seats[seatIndex + 1]
if target ~= cjson.null and target.userId ~= userId then
  return cjson.encode({ success = false, message = 'هذا المقعد مشغول حالياً' })
end
if target ~= cjson.null and target.isLocked then
  return cjson.encode({ success = false, message = 'هذا المقعد مقفل بواسطة الإدارة' })
end

local previousRoomId = nil
local previousStage = nil
local previousValue = redis.call('GET', userKey)
if previousValue then
  local previous = cjson.decode(previousValue)
  previousRoomId = previous.roomId
  local previousIndex = tonumber(previous.seatIndex)
  if previousRoomId == roomId then
    if previousIndex ~= seatIndex then
      local oldSeat = stage.seats[previousIndex + 1]
      if oldSeat ~= cjson.null and oldSeat.userId == userId then
        stage.seats[previousIndex + 1] = cjson.null
      end
    end
  else
    local previousKey = roomPrefix .. previousRoomId
    local previousRaw = redis.call('GET', previousKey)
    if previousRaw then
      previousStage = cjson.decode(previousRaw)
      local oldSeat = previousStage.seats[previousIndex + 1]
      if oldSeat ~= cjson.null and oldSeat.userId == userId then
        previousStage.seats[previousIndex + 1] = cjson.null
        redis.call('SET', previousKey, cjson.encode(previousStage), 'EX', roomTtl)
      else
        previousStage = nil
      end
    end
  end
end

stage.seats[seatIndex + 1] = cjson.decode(seatJson)
local nextValue = cjson.encode(stage)
redis.call('SET', stageKey, nextValue, 'EX', roomTtl)
redis.call('SET', userKey, cjson.encode({ roomId = roomId, seatIndex = seatIndex }), 'EX', seatTtl)
redis.call('SADD', activeKey, userId)
return cjson.encode({
  success = true,
  stage = stage,
  previousRoomId = previousRoomId,
  previousStage = previousStage
})
`;

const LEAVE_SEAT_SCRIPT = `
local userId = ARGV[1]
local roomPrefix = ARGV[2]
local roomTtl = tonumber(ARGV[3])
local userKey = KEYS[1]
local activeKey = KEYS[2]
local value = redis.call('GET', userKey)
if not value then
  redis.call('SREM', activeKey, userId)
  return ''
end
local location = cjson.decode(value)
local roomKey = roomPrefix .. location.roomId
local roomValue = redis.call('GET', roomKey)
local stage = nil
if roomValue then
  stage = cjson.decode(roomValue)
  local index = tonumber(location.seatIndex) + 1
  local seat = stage.seats[index]
  if seat ~= cjson.null and seat.userId == userId then
    stage.seats[index] = cjson.null
    redis.call('SET', roomKey, cjson.encode(stage), 'EX', roomTtl)
  else
    stage = nil
  end
end
redis.call('DEL', userKey)
redis.call('SREM', activeKey, userId)
if not stage then return '' end
return cjson.encode({ roomId = location.roomId, stage = stage })
`;

const MUTE_SEAT_SCRIPT = `
local roomId = ARGV[1]
local userId = ARGV[2]
local isMuted = ARGV[3] == '1'
local roomTtl = tonumber(ARGV[4])
local stageKey = KEYS[1]
local userKey = KEYS[2]
local locationValue = redis.call('GET', userKey)
if not locationValue then return '' end
local location = cjson.decode(locationValue)
if location.roomId ~= roomId then return '' end
local value = redis.call('GET', stageKey)
if not value then return '' end
local stage = cjson.decode(value)
local index = tonumber(location.seatIndex) + 1
local seat = stage.seats[index]
if seat == cjson.null or seat.userId ~= userId then return '' end
seat.isMuted = isMuted
redis.call('SET', stageKey, cjson.encode(stage), 'EX', roomTtl)
return cjson.encode(stage)
`;

const LOCK_SEAT_SCRIPT = `
local seatIndex = tonumber(ARGV[1])
local isLocked = ARGV[2] == '1'
local initialStage = ARGV[3]
local roomTtl = tonumber(ARGV[4])
local stageKey = KEYS[1]
local stage = cjson.decode(redis.call('GET', stageKey) or initialStage)
if seatIndex < 0 or seatIndex >= tonumber(stage.maxSeats) then return '' end
local seat = stage.seats[seatIndex + 1]
if seat == cjson.null then
  stage.seats[seatIndex + 1] = {
    seatIndex = seatIndex,
    userId = '',
    username = '',
    avatar = '',
    isMuted = false,
    isLocked = isLocked,
    joinedAt = 0
  }
else
  seat.isLocked = isLocked
end
redis.call('SET', stageKey, cjson.encode(stage), 'EX', roomTtl)
return cjson.encode(stage)
`;

const KICK_SEAT_SCRIPT = `
local seatIndex = tonumber(ARGV[1])
local roomId = ARGV[2]
local userPrefix = ARGV[3]
local activeKey = KEYS[2]
local roomTtl = tonumber(ARGV[4])
local value = redis.call('GET', KEYS[1])
if not value then return '' end
local stage = cjson.decode(value)
if seatIndex < 0 or seatIndex >= tonumber(stage.maxSeats) then return '' end
local seat = stage.seats[seatIndex + 1]
local userId = nil
if seat ~= cjson.null and seat.userId and seat.userId ~= '' then
  userId = seat.userId
  local userKey = userPrefix .. userId
  local locationValue = redis.call('GET', userKey)
  if locationValue then
    local location = cjson.decode(locationValue)
    if location.roomId == roomId and tonumber(location.seatIndex) == seatIndex then
      redis.call('DEL', userKey)
      redis.call('SREM', activeKey, userId)
    end
  end
else
  return cjson.encode({ stage = stage })
end
stage.seats[seatIndex + 1] = cjson.null
redis.call('SET', KEYS[1], cjson.encode(stage), 'EX', roomTtl)
return cjson.encode({ stage = stage, userId = userId })
`;

const HEARTBEAT_SCRIPT = `
local roomId = ARGV[1]
local userId = ARGV[2]
local seatTtl = tonumber(ARGV[3])
local roomTtl = tonumber(ARGV[4])
local locationValue = redis.call('GET', KEYS[2])
if not locationValue then return 0 end
local location = cjson.decode(locationValue)
if location.roomId ~= roomId then return 0 end
local value = redis.call('GET', KEYS[1])
if not value then return 0 end
local stage = cjson.decode(value)
local seat = stage.seats[tonumber(location.seatIndex) + 1]
if seat == cjson.null or seat.userId ~= userId then return 0 end
redis.call('EXPIRE', KEYS[1], roomTtl)
redis.call('EXPIRE', KEYS[2], seatTtl)
return 1
`;

export class VoiceStageStore {
  private readonly redisEnabled: boolean;
  private readonly nodeEnv: string;
  private readonly redisClient: RedisClient;
  private readonly stages = new Map<string, RoomVoiceStage>();
  private readonly activeSeats = new Map<string, SeatLocation>();
  private readonly experienceClaims = new Map<string, number>();

  constructor(options: StoreOptions = {}) {
    this.redisEnabled = options.redisEnabled ?? isRedisEnabled;
    this.nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
    this.redisClient = options.redisClient ?? redis;
  }

  private assertAvailable(): void {
    if (!this.redisEnabled && this.nodeEnv === "production") {
      throw new Error("Redis is required for voice-stage state in production");
    }
  }

  private roomKey(roomId: string): string {
    return `${KEY_PREFIX}:room:${roomId}`;
  }

  private userKey(userId: string): string {
    return `${KEY_PREFIX}:user:${userId}`;
  }

  private activeKey(): string {
    return `${KEY_PREFIX}:active`;
  }

  private async evalJson<T>(script: string, keys: string[], args: string[]): Promise<T | null> {
    const result = await this.redisClient.eval(script, keys.length, ...keys, ...args);
    if (typeof result !== "string" || !result) return null;
    return JSON.parse(result) as T;
  }

  async ensureStage(stage: RoomVoiceStage): Promise<RoomVoiceStage> {
    this.assertAvailable();
    if (!this.redisEnabled) {
      const current = this.stages.get(stage.roomId);
      if (current) return current;
      this.stages.set(stage.roomId, stage);
      return stage;
    }

    const result = await this.redisClient.eval(
      ENSURE_STAGE_SCRIPT,
      1,
      this.roomKey(stage.roomId),
      JSON.stringify(stage),
      String(ROOM_TTL_SECONDS),
    );
    if (typeof result !== "string") throw new Error("Redis returned invalid voice-stage state");
    return JSON.parse(result) as RoomVoiceStage;
  }

  async getStage(roomId: string): Promise<RoomVoiceStage | null> {
    this.assertAvailable();
    if (!this.redisEnabled) return this.stages.get(roomId) ?? null;

    return this.evalJson<RoomVoiceStage>(GET_STAGE_SCRIPT, [
      this.roomKey(roomId),
      this.activeKey(),
    ], [roomId, `${KEY_PREFIX}:user:`, String(ROOM_TTL_SECONDS)]);
  }

  async takeSeat(roomId: string, seat: VoiceSeat): Promise<SeatChange> {
    this.assertAvailable();
    const stage = await this.getStage(roomId);
    if (!stage || seat.seatIndex < 0 || seat.seatIndex >= stage.maxSeats) {
      return { success: false, message: "رقم المقعد خارج نطاق هذه الغرفة" };
    }

    if (!this.redisEnabled) {
      const target = stage.seats[seat.seatIndex];
      if (target && target.userId !== seat.userId) {
        return { success: false, message: "هذا المقعد مشغول حالياً" };
      }
      if (target?.isLocked) {
        return { success: false, message: "هذا المقعد مقفل بواسطة الإدارة" };
      }

      const previous = this.activeSeats.get(seat.userId);
      let previousStage: RoomVoiceStage | undefined;
      if (previous) {
        const oldStage = this.stages.get(previous.roomId);
        const oldSeat = oldStage?.seats[previous.seatIndex];
        if (oldSeat?.userId === seat.userId) {
          oldStage!.seats[previous.seatIndex] = null;
          if (previous.roomId !== roomId) previousStage = oldStage;
        }
      }
      stage.seats[seat.seatIndex] = seat;
      this.activeSeats.set(seat.userId, { roomId, seatIndex: seat.seatIndex });
      return {
        success: true,
        stage,
        previousRoomId: previous?.roomId,
        previousStage,
      };
    }

    const result = await this.evalJson<SeatChange>(TAKE_SEAT_SCRIPT, [
      this.roomKey(roomId),
      this.userKey(seat.userId),
      this.activeKey(),
    ], [
      roomId,
      seat.userId,
      JSON.stringify(seat),
      String(seat.seatIndex),
      JSON.stringify(stage),
      `${KEY_PREFIX}:room:`,
      String(ROOM_TTL_SECONDS),
      String(SEAT_TTL_SECONDS),
    ]);
    if (!result) throw new Error("Redis returned invalid voice-stage seat result");
    return result;
  }

  async leaveSeat(userId: string): Promise<{ roomId: string; stage: RoomVoiceStage } | null> {
    this.assertAvailable();
    if (!this.redisEnabled) {
      const location = this.activeSeats.get(userId);
      if (!location) return null;
      const stage = this.stages.get(location.roomId);
      this.activeSeats.delete(userId);
      if (!stage || stage.seats[location.seatIndex]?.userId !== userId) return null;
      stage.seats[location.seatIndex] = null;
      return { roomId: location.roomId, stage };
    }

    return this.evalJson(LEAVE_SEAT_SCRIPT, [
      this.userKey(userId),
      this.activeKey(),
    ], [userId, `${KEY_PREFIX}:room:`, String(ROOM_TTL_SECONDS)]);
  }

  async toggleMute(roomId: string, userId: string, isMuted: boolean): Promise<RoomVoiceStage | null> {
    this.assertAvailable();
    if (!this.redisEnabled) {
      const location = this.activeSeats.get(userId);
      const stage = location?.roomId === roomId ? this.stages.get(roomId) : undefined;
      const seat = location ? stage?.seats[location.seatIndex] : null;
      if (!seat || seat.userId !== userId) return null;
      seat.isMuted = isMuted;
      return stage ?? null;
    }

    return this.evalJson(MUTE_SEAT_SCRIPT, [
      this.roomKey(roomId),
      this.userKey(userId),
    ], [roomId, userId, isMuted ? "1" : "0", String(ROOM_TTL_SECONDS)]);
  }

  async setSeatLock(roomId: string, seatIndex: number, isLocked: boolean): Promise<RoomVoiceStage | null> {
    this.assertAvailable();
    const stage = await this.getStage(roomId);
    if (!stage || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= stage.maxSeats) return null;

    if (!this.redisEnabled) {
      const seat = stage.seats[seatIndex];
      if (!seat) {
        stage.seats[seatIndex] = {
          seatIndex,
          userId: "",
          username: "",
          avatar: "",
          isMuted: false,
          isLocked,
          joinedAt: 0,
        };
      } else {
        seat.isLocked = isLocked;
      }
      return stage;
    }

    return this.evalJson(LOCK_SEAT_SCRIPT, [this.roomKey(roomId)], [
      String(seatIndex),
      isLocked ? "1" : "0",
      JSON.stringify(stage),
      String(ROOM_TTL_SECONDS),
    ]);
  }

  async kickSeat(roomId: string, seatIndex: number): Promise<{ stage: RoomVoiceStage; userId?: string } | null> {
    this.assertAvailable();
    const stage = await this.getStage(roomId);
    if (!stage || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= stage.maxSeats) return null;

    if (!this.redisEnabled) {
      const seat = stage.seats[seatIndex];
      const userId = seat?.userId || undefined;
      if (userId) {
        this.activeSeats.delete(userId);
        stage.seats[seatIndex] = null;
      }
      return { stage, userId };
    }

    return this.evalJson(KICK_SEAT_SCRIPT, [
      this.roomKey(roomId),
      this.activeKey(),
    ], [
      String(seatIndex),
      roomId,
      `${KEY_PREFIX}:user:`,
      String(ROOM_TTL_SECONDS),
    ]);
  }

  async heartbeat(roomId: string, userId: string): Promise<boolean> {
    this.assertAvailable();
    if (!this.redisEnabled) {
      return this.activeSeats.get(userId)?.roomId === roomId;
    }

    const result = await this.redisClient.eval(
      HEARTBEAT_SCRIPT,
      2,
      this.roomKey(roomId),
      this.userKey(userId),
      roomId,
      userId,
      String(SEAT_TTL_SECONDS),
      String(ROOM_TTL_SECONDS),
    );
    return Number(result) === 1;
  }

  async listActiveSeats(): Promise<Array<{ roomId: string; seat: VoiceSeat }>> {
    this.assertAvailable();
    if (!this.redisEnabled) {
      const active: Array<{ roomId: string; seat: VoiceSeat }> = [];
      for (const [userId, location] of this.activeSeats) {
        const seat = this.stages.get(location.roomId)?.seats[location.seatIndex];
        if (seat?.userId === userId) active.push({ roomId: location.roomId, seat });
      }
      return active;
    }

    const userIds = await this.redisClient.smembers(this.activeKey());
    const results = await Promise.all(userIds.map(async (userId) => {
      const locationValue = await this.redisClient.get(this.userKey(userId));
      if (!locationValue) {
        await this.redisClient.srem(this.activeKey(), userId);
        return null;
      }
      const location = JSON.parse(locationValue) as SeatLocation;
      const stage = await this.getStage(location.roomId);
      const seat = stage?.seats[location.seatIndex];
      return seat?.userId === userId ? { roomId: location.roomId, seat } : null;
    }));
    return results.filter((entry): entry is { roomId: string; seat: VoiceSeat } => entry !== null);
  }

  async claimExperienceTick(userId: string, minute = Math.floor(Date.now() / 60000)): Promise<boolean> {
    this.assertAvailable();
    if (!this.redisEnabled) {
      if (this.experienceClaims.get(userId) === minute) return false;
      this.experienceClaims.set(userId, minute);
      return true;
    }
    const result = await this.redisClient.set(
      `${KEY_PREFIX}:exp:${userId}:${minute}`,
      "1",
      "EX",
      120,
      "NX",
    );
    return result === "OK";
  }
}

export const voiceStageStore = new VoiceStageStore();
