/** Shared token-throughput display formatting. */

/**
 * Decode-throughput figure: whole tokens from ten up, one decimal below.
 * @param tps - Tokens per second.
 * @returns Display number without unit.
 */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}
