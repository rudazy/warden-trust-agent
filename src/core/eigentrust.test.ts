import { describe, it, expect } from "vitest";
import { EigenTrustEngine } from "./eigentrust.js";
import type { TrustEdge } from "../types/index.js";

function makeEdge(from: string, to: string, weight = 1): TrustEdge {
  return { from, to, weight, source: "test", timestamp: Date.now() };
}

describe("EigenTrustEngine", () => {
  it("returns empty scores for empty graph", () => {
    const engine = new EigenTrustEngine();
    const result = engine.compute([]);
    expect(result.scores.size).toBe(0);
    expect(result.converged).toBe(true);
  });

  it("computes scores for a simple triangle graph", () => {
    const engine = new EigenTrustEngine();
    const edges: TrustEdge[] = [
      makeEdge("A", "B"),
      makeEdge("B", "C"),
      makeEdge("C", "A"),
    ];

    const result = engine.compute(edges);

    expect(result.converged).toBe(true);
    expect(result.scores.size).toBe(3);

    // In a symmetric cycle, all nodes should have roughly equal trust
    const scores = Array.from(result.scores.values());
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    for (const score of scores) {
      expect(Math.abs(score - avg)).toBeLessThan(0.05);
    }
  });

  it("gives higher score to a node trusted by many", () => {
    const engine = new EigenTrustEngine();
    const edges: TrustEdge[] = [
      makeEdge("A", "D"),
      makeEdge("B", "D"),
      makeEdge("C", "D"),
      makeEdge("D", "A"),
    ];

    const result = engine.compute(edges);

    expect(result.converged).toBe(true);
    const scoreD = result.scores.get("D")!;
    const scoreA = result.scores.get("A")!;
    const scoreB = result.scores.get("B")!;

    // D is trusted by 3 nodes, should have highest score
    expect(scoreD).toBeGreaterThan(scoreA);
    expect(scoreD).toBeGreaterThan(scoreB);
  });

  it("respects pre-trusted peers", () => {
    const engine = new EigenTrustEngine();
    const edges: TrustEdge[] = [
      makeEdge("A", "B"),
      makeEdge("B", "C"),
      makeEdge("C", "A"),
    ];

    const preTrusted = new Set(["A"]);
    const result = engine.compute(edges, preTrusted);

    expect(result.converged).toBe(true);
    const scoreA = result.scores.get("A")!;
    const scoreC = result.scores.get("C")!;

    // A is pre-trusted so should have a higher score
    expect(scoreA).toBeGreaterThan(scoreC);
  });

  it("handles weighted edges", () => {
    const engine = new EigenTrustEngine();
    const edges: TrustEdge[] = [
      makeEdge("A", "B", 0.9),
      makeEdge("A", "C", 0.1),
      makeEdge("B", "A", 1),
      makeEdge("C", "A", 1),
    ];

    const result = engine.compute(edges);

    expect(result.converged).toBe(true);
    const scoreB = result.scores.get("B")!;
    const scoreC = result.scores.get("C")!;

    // B gets 90% of A's trust, C gets 10%
    expect(scoreB).toBeGreaterThan(scoreC);
  });

  it("clamps negative weights to zero", () => {
    const engine = new EigenTrustEngine();
    const edges: TrustEdge[] = [
      makeEdge("A", "B", 1),
      makeEdge("A", "C", -0.5),
      makeEdge("B", "A", 1),
      makeEdge("C", "A", 1),
    ];

    const result = engine.compute(edges);

    expect(result.converged).toBe(true);
    // C should still have a score (from dangling node handling or uniform)
    expect(result.scores.has("C")).toBe(true);
  });

  it("topN returns correct ordering", () => {
    const engine = new EigenTrustEngine();
    const edges: TrustEdge[] = [
      makeEdge("A", "D"),
      makeEdge("B", "D"),
      makeEdge("C", "D"),
      makeEdge("D", "A"),
    ];

    const result = engine.compute(edges);
    const top = engine.topN(result, 2);

    expect(top.length).toBe(2);
    expect(top[0].address).toBe("D");
    expect(top[0].score).toBeGreaterThanOrEqual(top[1].score);
  });

  it("scoreFor returns 0 for unknown address", () => {
    const engine = new EigenTrustEngine();
    const edges: TrustEdge[] = [makeEdge("A", "B")];
    const result = engine.compute(edges);

    expect(engine.scoreFor(result, "Z")).toBe(0);
  });

  it("converges within max iterations for larger graph", () => {
    const engine = new EigenTrustEngine({ maxIterations: 200 });
    const edges: TrustEdge[] = [];

    // Create a 20-node ring graph
    const nodes = Array.from({ length: 20 }, (_, i) => `N${i}`);
    for (let i = 0; i < nodes.length; i++) {
      edges.push(makeEdge(nodes[i], nodes[(i + 1) % nodes.length]));
    }

    const result = engine.compute(edges);

    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThan(200);
    expect(result.scores.size).toBe(20);
  });
});
