// Calendar dates use UTC consistently, including the definition of "today".
export const priceToday = () => new Date().toISOString().slice(0, 10);
export function validPriceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
export function pricePolicyError(effectiveDate: string, reason: string | undefined, today = priceToday()): string | null {
  if (!validPriceDate(effectiveDate)) return "Enter a valid effective date.";
  if (effectiveDate < today && !reason?.trim()) return "A reason is required for a backdated price.";
  return null;
}
