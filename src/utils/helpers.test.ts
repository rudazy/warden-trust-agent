import { describe, it, expect } from "vitest";
import {
  normalizeScore,
  scoreToLevel,
  isValidAddress,
  shortenAddress,
  extractAddress,
  weightedAverage,
  formatTrustScore,
} from "./helpers.js";
import type { TrustScore } from "../types/index.js";

describe("normalizeScore", () => {
  it("normalizes 0.5 in [0,1] to 50", () => {
    expect(normalizeScore(0.5)).toBe(50);
  });

  it("normalizes 0 to 0", () => {
    expect(normalizeScore(0)).toBe(0);
  });

  it("normalizes 1 to 100", () => {
    expect(normalizeScore(1)).toBe(100);
  });

  it("clamps values above max", () => {
    expect(normalizeScore(1.5, 0, 1)).toBe(100);
  });

  it("clamps values below min", () => {
    expect(normalizeScore(-0.5, 0, 1)).toBe(0);
  });

  it("handles custom range", () => {
    expect(normalizeScore(50, 0, 100)).toBe(50);
    expect(normalizeScore(75, 0, 100)).toBe(75);
  });
});

describe("scoreToLevel", () => {
  it("returns correct levels for score ranges", () => {
    expect(scoreToLevel(90)).toBe("very_high");
    expect(scoreToLevel(85)).toBe("very_high");
    expect(scoreToLevel(75)).toBe("high");
    expect(scoreToLevel(70)).toBe("high");
    expect(scoreToLevel(60)).toBe("moderate");
    expect(scoreToLevel(50)).toBe("moderate");
    expect(scoreToLevel(35)).toBe("low");
    expect(scoreToLevel(30)).toBe("low");
    expect(scoreToLevel(15)).toBe("suspicious");
    expect(scoreToLevel(10)).toBe("suspicious");
    expect(scoreToLevel(5)).toBe("unknown");
    expect(scoreToLevel(0)).toBe("unknown");
  });
});

describe("isValidAddress", () => {
  it("validates correct addresses", () => {
    expect(isValidAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18")).toBe(true);
    expect(isValidAddress("0x0000000000000000000000000000000000000000")).toBe(true);
  });

  it("rejects invalid addresses", () => {
    expect(isValidAddress("0x123")).toBe(false);
    expect(isValidAddress("not an address")).toBe(false);
    expect(isValidAddress("742d35Cc6634C0532925a3b844Bc9e7595f2bD18")).toBe(false);
    expect(isValidAddress("0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG")).toBe(false);
    expect(isValidAddress("")).toBe(false);
  });
});

describe("shortenAddress", () => {
  it("shortens valid addresses", () => {
    expect(shortenAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18")).toBe(
      "0x742d...bD18"
    );
  });

  it("returns invalid addresses unchanged", () => {
    expect(shortenAddress("not an address")).toBe("not an address");
  });
});

describe("extractAddress", () => {
  it("extracts address from text", () => {
    expect(
      extractAddress("Check this wallet 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18 please")
    ).toBe("0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18");
  });

  it("extracts first address when multiple present", () => {
    const text =
      "Path from 0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA to 0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    expect(extractAddress(text)).toBe("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("returns null when no address found", () => {
    expect(extractAddress("no address here")).toBeNull();
    expect(extractAddress("0x123 too short")).toBeNull();
  });
});

describe("weightedAverage", () => {
  it("computes correct weighted average", () => {
    const items = [
      { score: 80, weight: 0.5 },
      { score: 60, weight: 0.3 },
      { score: 40, weight: 0.2 },
    ];
    // (80*0.5 + 60*0.3 + 40*0.2) / (0.5+0.3+0.2) = (40+18+8)/1 = 66
    expect(weightedAverage(items)).toBe(66);
  });

  it("returns 0 for empty array", () => {
    expect(weightedAverage([])).toBe(0);
  });

  it("returns 0 when all weights are 0", () => {
    expect(weightedAverage([{ score: 100, weight: 0 }])).toBe(0);
  });

  it("handles single item", () => {
    expect(weightedAverage([{ score: 75, weight: 1 }])).toBe(75);
  });
});

describe("formatTrustScore", () => {
  it("formats a complete trust score", () => {
    const score: TrustScore = {
      address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
      score: 75,
      confidence: 0.85,
      level: "high",
      factors: [
        { name: "Graph Trust", score: 80, weight: 0.35, description: "Strong network" },
      ],
      metadata: {
        chain: "ethereum",
        entityType: "wallet",
        attestationCount: 12,
        totalTransactions: 150,
      },
      timestamp: Date.now(),
    };

    const formatted = formatTrustScore(score);
    expect(formatted).toContain("75/100");
    expect(formatted).toContain("high");
    expect(formatted).toContain("85%");
    expect(formatted).toContain("Graph Trust");
    expect(formatted).toContain("Attestations: 12");
    expect(formatted).toContain("Transactions: 150");
  });

  it("handles score with no factors", () => {
    const score: TrustScore = {
      address: "0x0000000000000000000000000000000000000000",
      score: 0,
      confidence: 0.1,
      level: "unknown",
      factors: [],
      metadata: { chain: "ethereum", entityType: "unknown" },
      timestamp: Date.now(),
    };

    const formatted = formatTrustScore(score);
    expect(formatted).toContain("0/100");
    expect(formatted).toContain("unknown");
    expect(formatted).not.toContain("Factors:");
  });
});
