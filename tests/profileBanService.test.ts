import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPermanentSiteBan,
  dedupePlannedBanRows,
  planPermanentBanRows,
  type ExistingBanRow,
} from "../server/services/profileBanService";

const FAKE_ACTOR = "actor-1";

const makePool = (handlers: {
  query: (text: string, values?: any[]) => Promise<{ rows: any[]; rowCount?: number }>;
}) => {
  return { query: handlers.query } as any;
};

test("planPermanentBanRows builds a full plan when every identifier exists", () => {
  const plan = planPermanentBanRows({
    username: "medo",
    ip: "1.2.3.4",
    device_fingerprint: "FP-1",
    device_signature: "SIG-1",
  });
  assert.deepEqual(
    plan.map((r) => r.banType),
    ["name", "ip", "device"],
  );
  assert.equal(plan[1].ipAddress, "1.2.3.4");
  assert.equal(plan[2].deviceFingerprint, "FP-1");
  assert.equal(plan[2].deviceSignature, "SIG-1");
});

test("planPermanentBanRows collapses to a name-only ban without device data", () => {
  const plan = planPermanentBanRows({ username: "medo", ip: null, device_fingerprint: null, device_signature: null });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].banType, "name");
});

test("no plan rows without any identifier", () => {
  assert.equal(planPermanentBanRows({}).length, 0);
});

test("dedupe skips already active identical bans", () => {
  const plan = planPermanentBanRows({ username: "medo", ip: "1.2.3.4" });
  const existing: ExistingBanRow[] = [
    { banType: "name", targetName: "MEDO" },
    { banType: "ip", ipAddress: "1.2.3.4" },
  ];
  const { rows, skipped } = dedupePlannedBanRows(plan, existing);
  assert.deepEqual(rows.map((r) => r.banType), []);
  assert.equal(skipped, 2);
});

test("dedupe keeps rows whose identifiers differ", () => {
  const plan = planPermanentBanRows({ username: "medo", ip: "5.6.7.8" });
  const existing: ExistingBanRow[] = [{ banType: "name", targetName: "other-user" }];
  const { rows, skipped } = dedupePlannedBanRows(plan, existing);
  assert.equal(rows.length, 2);
  assert.equal(skipped, 0);
});

test("applyPermanentSiteBan refuses to ban the site owner", async () => {
  const pool = makePool({
    query: async () => ({ rows: [{ id: "u1", username: "safarihost", display_name: "", ip: "1.1.1.1" }], rowCount: 1 }),
  });
  const res = await applyPermanentSiteBan({
    targetProfile: { id: "u1" },
    actorId: FAKE_ACTOR,
    pool,
  });
  assert.equal(res.banned, false);
  assert.match(String(res.deniedReason), /مالك/);
});

test("applyPermanentSiteBan inserts name + ip + device bans and returns a summary", async () => {
  const inserted: { text: string; values?: any[] }[] = [];
  const pool = makePool({
    query: async (text: string, values?: any[]) => {
      inserted.push({ text, values });
      if (/SELECT CAST\(id AS text\) AS id/.test(text)) {
        return {
          rows: [
            { id: "u2", username: "medo", display_name: "", ip: "2.2.2.2", device_fingerprint: "FP-2", device_signature: "SIG-2" },
          ],
          rowCount: 1,
        };
      }
      if (/FROM moderation_bans/.test(text) && !/INSERT INTO/.test(text)) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    },
  });

  const res = await applyPermanentSiteBan({
    targetProfile: { id: "u2" },
    actorId: FAKE_ACTOR,
    pool,
  });

  assert.equal(res.banned, true);
  assert.equal(res.inserted, 3);
  assert.deepEqual(res.banTypeSummary, ["الاسم", "IP", "بصمة الجهاز"]);
  const banInserts = inserted.filter((i) => /INSERT INTO moderation_bans/.test(i.text));
  assert.equal(banInserts.length, 3);
  assert.deepEqual(banInserts.map((i) => i.values?.[1]), ["name", "ip", "device"]);
  // حظر دائم: expires_at فارغ
  for (const insert of banInserts) {
    assert.ok(insert.text.includes("NULL, $7") || insert.text.includes("NULL"));
  }
});

test("applyPermanentSiteBan falls back to username lookup when id is missing", async () => {
  let lookupValues: any[] | undefined;
  const pool = makePool({
    query: async (text: string, values?: any[]) => {
      if (/SELECT CAST\(id AS text\) AS id/.test(text)) {
        lookupValues = values;
        return { rows: [{ id: "u3", username: "medo3", display_name: "", ip: null, device_fingerprint: null, device_signature: null }], rowCount: 1 };
      }
      if (/FROM moderation_bans/.test(text) && !/INSERT INTO/.test(text)) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    },
  });
  const res = await applyPermanentSiteBan({
    targetProfile: { username: "medo3" },
    actorId: FAKE_ACTOR,
    pool,
  });
  assert.equal(res.banned, true);
  assert.equal(res.inserted, 1);
  assert.deepEqual(res.banTypeSummary, ["الاسم"]);
  assert.equal(String(lookupValues?.[0]), "medo3");
});
