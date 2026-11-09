import { getMinioBucket, getMinioClient } from "./minioClient";

const PRIVATE_RECEIPT_BUCKET = process.env.MINIO_PRIVATE_RECEIPT_BUCKET || "hobi-private-receipts";
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
let bucketReady: Promise<void> | null = null;

const getErrorCode = (error: unknown) =>
  error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "";

export const getExistingLifecycleRules = async <TRule extends { ID?: string }>(
  getLifecycle: () => Promise<{ Rule?: TRule | TRule[] } | null>,
): Promise<TRule[]> => {
  try {
    const lifecycle = await getLifecycle();
    const rules = lifecycle?.Rule;
    if (!rules) return [];
    return Array.isArray(rules) ? rules : [rules];
  } catch (error) {
    if (getErrorCode(error) === "NoSuchLifecycleConfiguration") return [];
    throw error;
  }
};

const hasPublicPrincipal = (principal: unknown) => {
  if (principal === "*") return true;
  if (!principal || typeof principal !== "object") return false;
  const aws = "AWS" in principal ? principal.AWS : undefined;
  return aws === "*" || (Array.isArray(aws) && aws.includes("*"));
};

const hasPublicAllow = (policy: unknown) => {
  if (!policy || typeof policy !== "object" || !("Statement" in policy)) {
    throw new Error("private receipt bucket has an invalid access policy");
  }
  const statements = Array.isArray(policy.Statement) ? policy.Statement : [policy.Statement];
  return statements.some((statement) =>
    Boolean(
      statement &&
      typeof statement === "object" &&
      "Effect" in statement &&
      statement.Effect === "Allow" &&
      "Principal" in statement &&
      hasPublicPrincipal(statement.Principal),
    ),
  );
};

export const isPrivateReceiptPolicy = (policyJson: string) => {
  let policy: unknown;
  try {
    policy = JSON.parse(policyJson);
  } catch {
    throw new Error("private receipt bucket has an invalid access policy");
  }
  return !hasPublicAllow(policy);
};

export const inspectReceiptImage = (buffer: Buffer): { contentType: string; extension: string } | null => {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return { contentType: "image/png", extension: "png" };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) return { contentType: "image/webp", extension: "webp" };
  return null;
};

const ensurePrivateBucket = async () => {
  const client = getMinioClient();
  if (!client) throw new Error("private receipt storage is not configured");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(PRIVATE_RECEIPT_BUCKET)) {
    throw new Error("private receipt bucket name is invalid");
  }
  if (PRIVATE_RECEIPT_BUCKET === getMinioBucket()) {
    throw new Error("private receipt bucket must be separate from the public uploads bucket");
  }

  const exists = await client.bucketExists(PRIVATE_RECEIPT_BUCKET);
  if (!exists) {
    await client.makeBucket(PRIVATE_RECEIPT_BUCKET, "us-east-1");
  } else {
    try {
      const policy = await client.getBucketPolicy(PRIVATE_RECEIPT_BUCKET);
      if (!isPrivateReceiptPolicy(policy)) {
        throw new Error("private receipt bucket allows public access");
      }
    } catch (error) {
      if (getErrorCode(error) !== "NoSuchBucketPolicy") throw error;
    }
  }

  const lifecycleRules = await getExistingLifecycleRules(
    () => client.getBucketLifecycle(PRIVATE_RECEIPT_BUCKET),
  );
  const existingRules = lifecycleRules.filter(
    (rule) => rule.ID !== "hobi-wallet-proofs-retention-30-days",
  );
  await client.setBucketLifecycle(PRIVATE_RECEIPT_BUCKET, {
    Rule: [
      ...existingRules,
      {
        ID: "hobi-wallet-proofs-retention-30-days",
        Status: "Enabled",
        Filter: { Prefix: "wallet-proofs/" },
        Expiration: { Days: 30 },
      },
    ],
  });
};

export const ensurePrivateReceiptBucket = async () => {
  if (!bucketReady) {
    bucketReady = ensurePrivateBucket().catch((error: unknown) => {
      bucketReady = null;
      throw error;
    });
  }
  return bucketReady;
};

export const uploadPrivateReceipt = async (
  objectKey: string,
  buffer: Buffer,
  contentType: string,
) => {
  if (
    !/^wallet-proofs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i.test(objectKey) ||
    buffer.length < 1 ||
    buffer.length > MAX_RECEIPT_BYTES ||
    !["image/jpeg", "image/png", "image/webp"].includes(contentType)
  ) {
    throw new Error("private receipt upload is invalid");
  }
  await ensurePrivateReceiptBucket();
  const client = getMinioClient();
  if (!client) throw new Error("private receipt storage is not configured");
  await client.putObject(PRIVATE_RECEIPT_BUCKET, objectKey, buffer, buffer.length, {
    "Content-Type": contentType,
    "Cache-Control": "private, no-store",
  });
};

export const readPrivateReceipt = async (objectKey: string) => {
  if (!/^wallet-proofs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i.test(objectKey)) {
    throw new Error("private receipt object key is invalid");
  }
  await ensurePrivateReceiptBucket();
  const client = getMinioClient();
  if (!client) throw new Error("private receipt storage is not configured");
  const stream = await client.getObject(PRIVATE_RECEIPT_BUCKET, objectKey);
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_RECEIPT_BYTES) {
      stream.destroy();
      throw new Error("private receipt exceeds the maximum allowed size");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes);
};

export const deletePrivateReceipt = async (objectKey: string) => {
  if (!/^wallet-proofs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i.test(objectKey)) {
    throw new Error("private receipt object key is invalid");
  }
  await ensurePrivateReceiptBucket();
  const client = getMinioClient();
  if (!client) throw new Error("private receipt storage is not configured");
  await client.removeObject(PRIVATE_RECEIPT_BUCKET, objectKey);
};

export const getPrivateReceiptContentType = (objectKey: string) => {
  const extension = /\.([a-z]+)$/i.exec(objectKey)?.[1]?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
};
