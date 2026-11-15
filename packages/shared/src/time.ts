// Time helpers. All timestamps stored and returned as UTC RFC 3339 strings
// (CLAUDE.md §9). Internally we keep epoch-second integers for D1 comparisons.

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export const toRfc3339 = (epochSeconds: number): string =>
  new Date(epochSeconds * 1000).toISOString();

export const fromRfc3339 = (value: string): number => Math.floor(new Date(value).getTime() / 1000);

/** Clamp a requested TTL into the allowed [min, max] range. */
export function clampTtl(requested: number, min: number, max: number): number {
  if (Number.isNaN(requested)) return min;
  return Math.min(Math.max(requested, min), max);
}
