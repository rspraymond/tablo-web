/**
 * Clamp a volume value to the [0, 1] range.
 * NaN is treated as 0 because a malformed slider value would otherwise be
 * assigned to video.volume, which throws on non-finite numbers.
 */
export function clampVolume(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Move volume by one 0.05 step, clamped to [0, 1].
 * The result is rounded to 2 decimals because 0.05 is not exact in binary;
 * without it, repeated steps drift off the 0 and 1 boundaries.
 */
export function stepVolume(current: number, dir: 1 | -1): number {
  return clampVolume(Math.round((current + dir * 0.05) * 100) / 100);
}