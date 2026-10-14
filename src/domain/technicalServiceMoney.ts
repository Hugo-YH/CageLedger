/** Decimal half-up to cents, matching the service API's Decimal calculation. */
export function technicalServiceAmount(quantity: number, price: number) {
  if (!Number.isFinite(quantity) || !Number.isFinite(price) || quantity < 0 || price < 0) return 0;
  const parts = [String(quantity), String(price)];
  // Exponent notation is possible only for tiny, non-billable draft input here.
  if (parts.some((part) => part.includes("e"))) return Math.round(quantity * price * 100) / 100;
  const scale = parts.reduce((sum, part) => sum + (part.split(".")[1]?.length || 0), 0);
  const denominator = 10n ** BigInt(scale);
  const numerator = parts.reduce((product, part) => product * BigInt(part.replace(".", "")), 100n);
  return Number((numerator + denominator / 2n) / denominator) / 100;
}
