export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeCount(value: unknown): number {
  if (!isFiniteNumber(value)) return 0;
  if (value <= 0) return 0;
  return Math.round(value);
}

export function normalizePositiveInt(value: unknown, fallback: number): number {
  if (!isFiniteNumber(value) || value <= 0) return fallback;
  return Math.round(value);
}

export function toRounded(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}
