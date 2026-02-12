import type { TrustLevel, TrustScore } from "../types/index.js";

/**
 * Normalize a raw score to the 0-100 range
 */
export function normalizeScore(raw: number, min = 0, max = 1): number {
  const clamped = Math.max(min, Math.min(max, raw));
  return Math.round(((clamped - min) / (max - min)) * 100);
}

/**
 * Map a numeric score (0-100) to a trust level
 */
export function scoreToLevel(score: number): TrustLevel {
  if (score >= 85) return "very_high";
  if (score >= 70) return "high";
  if (score >= 50) return "moderate";
  if (score >= 30) return "low";
  if (score >= 10) return "suspicious";
  return "unknown";
}

/**
 * Validate an Ethereum-style address
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Shorten an address for display: 0x742d...5bD18
 */
export function shortenAddress(address: string): string {
  if (!isValidAddress(address)) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Extract an address from natural language input
 */
export function extractAddress(text: string): string | null {
  const match = text.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : null;
}

/**
 * Calculate weighted average of scored items
 */
export function weightedAverage(
  items: { score: number; weight: number }[]
): number {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = items.reduce(
    (sum, item) => sum + item.score * item.weight,
    0
  );
  return Math.round(weightedSum / totalWeight);
}

/**
 * Format a trust score into a human-readable string
 */
export function formatTrustScore(score: TrustScore): string {
  const emoji = getTrustEmoji(score.level);
  const lines = [
    `${emoji} Trust Score: ${score.score}/100 (${score.level.replace("_", " ")})`,
    `Confidence: ${Math.round(score.confidence * 100)}%`,
    `Entity: ${score.metadata.entityType} on ${score.metadata.chain}`,
  ];

  if (score.factors.length > 0) {
    lines.push("", "Factors:");
    for (const factor of score.factors) {
      lines.push(
        `  - ${factor.name}: ${factor.score}/100 (${factor.description})`
      );
    }
  }

  if (score.metadata.attestationCount) {
    lines.push(`\nAttestations: ${score.metadata.attestationCount}`);
  }
  if (score.metadata.totalTransactions) {
    lines.push(`Transactions: ${score.metadata.totalTransactions}`);
  }

  return lines.join("\n");
}

function getTrustEmoji(level: TrustLevel): string {
  const emojis: Record<TrustLevel, string> = {
    unknown: "?",
    suspicious: "!!",
    low: "!",
    moderate: "[~]",
    high: "[+]",
    very_high: "[++]",
  };
  return emojis[level];
}
