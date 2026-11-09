export type SiteWalletFundingIntent = {
  amountCoins: number;
  externalReference: string;
};

export type SiteWalletFundingAttempt = {
  fingerprint: string;
  idempotencyKey: string;
};

export const getSiteWalletFundingAttempt = (
  intent: SiteWalletFundingIntent,
  previous: SiteWalletFundingAttempt | null,
  createIdempotencyKey: () => string = () => crypto.randomUUID(),
): SiteWalletFundingAttempt => {
  const fingerprint = JSON.stringify([
    intent.amountCoins,
    intent.externalReference.trim().toLowerCase(),
  ]);
  if (previous?.fingerprint === fingerprint) return previous;

  return { fingerprint, idempotencyKey: createIdempotencyKey() };
};
