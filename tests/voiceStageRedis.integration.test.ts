import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { io, type Socket } from "socket.io-client";

type Worker = { process: ChildProcess; port: number; logs: string[] };
type AckResponse = { success?: boolean; userId?: string; stage?: { seats: Array<{ userId: string; isLocked: boolean } | null> } };

const timeoutMs = 10000;
const workerScript = fileURLToPath(new URL("./helpers/voiceStageRedisWorker.mjs", import.meta.url));

async function startWorker(redisUrl: string): Promise<Worker> {
  const child = spawn(process.execPath, [workerScript], {
    cwd: process.cwd(),
    env: { ...process.env, REDIS_URL: redisUrl, REDIS_ENABLED: "true", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout! });
  const logs: string[] = [];
  let diagnostics = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    diagnostics = `${diagnostics}${text}`.slice(-4000);
    logs.push(text);
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Redis worker startup timed out")), timeoutMs);
    lines.on("line", (line) => {
      logs.push(line);
      try {
        const message = JSON.parse(line) as { ready?: number; error?: string };
        if (message.error) {
          clearTimeout(timer);
          reject(new Error(message.error));
        } else if (message.ready) {
          clearTimeout(timer);
          resolve(message.ready);
        }
      } catch {
        // Ignore diagnostic output until the worker reports its listening port.
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Redis worker exited before ready (${code}): ${diagnostics}`));
    });
  });
  return { process: child, port, logs };
}

async function connectWorker(worker: Worker, userId: string, roomId: string): Promise<Socket> {
  const socket = io(`http://127.0.0.1:${worker.port}`, {
    auth: { userId, roomId },
    forceNew: true,
    reconnection: false,
    timeout: timeoutMs,
    transports: ["websocket"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Socket connection timed out"));
    }, timeoutMs);
    timer.unref();
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };
    socket.once("connect", onConnect);
    socket.once("connect_error", onError);
  });
  return socket;
}

function emitAck<T>(socket: Socket, event: string, payload: object): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (error: Error | null, response: T) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

function waitForEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, onEvent);
  });
}

test("Redis coordinates voice seats and Socket.IO events across two server processes", {
  skip: !process.env.REDIS_INTEGRATION_URL,
}, async (t) => {
  const redisUrl = process.env.REDIS_INTEGRATION_URL!;
  const workers: Worker[] = [];
  const clients: Socket[] = [];
  const roomA = `integration-${randomUUID()}`;
  const roomB = `integration-${randomUUID()}`;
  const userA = `integration-${randomUUID()}`;
  const userB = `integration-${randomUUID()}`;

  t.after(async () => {
    const cleanupSocket = clients[0];
    if (cleanupSocket?.connected && workers.length) {
      await emitAck<AckResponse>(cleanupSocket, "integration:cleanup", {
        roomIds: [roomA, roomB],
        userIds: [userA, userB],
      }).catch(() => undefined);
    }
    for (const client of clients) client.disconnect();
    await Promise.all(workers.map(async ({ process: child }) => {
      if (child.exitCode !== null) return;
      const exited = once(child, "exit").catch(() => undefined);
      child.kill();
      await exited;
    }));
  });

  workers.push(await startWorker(redisUrl));
  workers.push(await startWorker(redisUrl));
  const [workerA, workerB] = workers;
  const clientA = await connectWorker(workerA, userA, roomA);
  const clientB = await connectWorker(workerB, userB, roomA);
  clients.push(clientA, clientB);

  assert.equal((await emitAck<AckResponse>(clientA, "integration:ensure-stage", { roomId: roomA })).success, true);
  assert.equal((await emitAck<AckResponse>(clientB, "integration:ensure-stage", { roomId: roomB })).success, true);

  const competingSeats = await Promise.all([
    emitAck<AckResponse>(clientA, "integration:take-seat", { roomId: roomA, seatIndex: 0, userId: userA }),
    emitAck<AckResponse>(clientB, "integration:take-seat", { roomId: roomA, seatIndex: 0, userId: userB }),
  ]);
  assert.equal(competingSeats.filter((result) => result.success).length, 1);
  const winner = competingSeats[0].success ? userA : userB;
  assert.equal((await emitAck<AckResponse>(clientB, "integration:get-stage", { roomId: roomA })).stage?.seats[0]?.userId, winner);

  const mover = winner === userA ? clientB : clientA;
  assert.equal((await emitAck<AckResponse>(mover, "integration:take-seat", { roomId: roomB, seatIndex: 1, userId: winner })).success, true);
  assert.equal((await emitAck<AckResponse>(clientA, "integration:get-stage", { roomId: roomA })).stage?.seats[0], null);
  assert.equal((await emitAck<AckResponse>(clientA, "integration:get-stage", { roomId: roomB })).stage?.seats[1]?.userId, winner);

  assert.equal((await emitAck<AckResponse>(clientA, "integration:set-lock", { roomId: roomA, seatIndex: 0, isLocked: true })).success, true);
  const lockedAttempt = await emitAck<AckResponse>(mover, "integration:take-seat", {
    roomId: roomA,
    seatIndex: 0,
    userId: winner === userA ? userB : userA,
  });
  assert.equal(lockedAttempt.success, false);

  const minute = Date.now();
  const claims = await Promise.all([
    emitAck<{ claimed: boolean }>(clientA, "integration:claim-exp", { userId: winner, minute }),
    emitAck<{ claimed: boolean }>(clientB, "integration:claim-exp", { userId: winner, minute }),
  ]);
  assert.equal(claims.filter(({ claimed }) => claimed).length, 1);

  assert.equal((await emitAck<{ heartbeat: boolean }>(clientA, "integration:heartbeat", { roomId: roomB, userId: winner })).heartbeat, true);
  assert.equal((await emitAck<AckResponse>(clientB, "integration:leave-seat", { userId: winner })).success, true);
  assert.equal((await emitAck<AckResponse>(clientA, "integration:get-stage", { roomId: roomB })).stage?.seats[1], null);
  assert.equal((await emitAck<{ heartbeat: boolean }>(clientA, "integration:heartbeat", { roomId: roomB, userId: winner })).heartbeat, false);

  const roomPayload = { roomId: roomA, seats: [] };
  const roomEvent = waitForEvent<typeof roomPayload>(clientB, "voice_stage:seats_updated");
  const roomPublish = await emitAck<AckResponse>(clientA, "integration:publish-room", {
    roomId: roomA,
    event: "voice_stage:seats_updated",
    payload: roomPayload,
  });
  assert.equal(roomPublish.success, true);
  try {
    assert.deepEqual(await roomEvent, roomPayload);
  } catch (error) {
    const diagnostics = workers.map((worker) => worker.logs.join("\n")).join("\n");
    throw new Error(`${String(error)}\nRedis broker worker logs:\n${diagnostics}`);
  }

  const sameUserClient = await connectWorker(workerA, userB, roomA);
  clients.push(sameUserClient);
  const signalPayload = { roomId: roomA, fromUserId: userB, signal: { sdp: "test-offer" } };
  const userEvent = waitForEvent<typeof signalPayload>(clientB, "voice_stage:signal");
  await emitAck(sameUserClient, "integration:publish-user", {
    userId: userB,
    event: "voice_stage:signal",
    payload: signalPayload,
  });
  assert.deepEqual(await userEvent, signalPayload);
});
