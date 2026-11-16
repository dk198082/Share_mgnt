// Quantities cross JSON as numbers, but all ledger arithmetic uses exact hundredths.
// Never round an input to make it valid.
export const MAX_SHARE_QUANTITY = 1_000_000_000_000;
export const SHARE_QUANTITY_MESSAGE = "Enter a positive share quantity with up to 2 decimal places (maximum 1,000,000,000,000).";

export function shareUnits(value: number | string): bigint {
  if (typeof value === "number" && !Number.isFinite(value)) throw new RangeError("Invalid share quantity.");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new RangeError("Share quantities must have at most 2 decimal places.");
  const units = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -units : units;
}

export function sharesFromUnits(units: bigint): number {
  if (units > BigInt(Number.MAX_SAFE_INTEGER) || units < -BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError("Share total exceeds the exact numeric range.");
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const result = Number(`${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`);
  if (shareUnits(result) !== units) throw new RangeError("Share total exceeds the exact numeric range.");
  return result;
}

export function sumShares(values: Iterable<number>): number {
  let units = 0n;
  for (const value of values) units += shareUnits(value);
  return sharesFromUnits(units);
}
export const addShares = (left: number, right: number) => sumShares([left, right]);
export const subtractShares = (left: number, right: number) => sharesFromUnits(shareUnits(left) - shareUnits(right));

export function isShareQuantity(value: unknown): value is number {
  if (typeof value !== "number" || value <= 0 || value > MAX_SHARE_QUANTITY) return false;
  try { return shareUnits(value) > 0n; } catch { return false; }
}

export function parseShareQuantity(text: string): number | null {
  const value = text.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const number = Number(value);
  if (!isShareQuantity(number)) return null;
  return shareUnits(value) === shareUnits(number) ? number : null;
}

export const shareNumberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
