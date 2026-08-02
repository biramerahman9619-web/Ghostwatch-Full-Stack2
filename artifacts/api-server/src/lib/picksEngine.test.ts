/**
 * Unit tests for picksEngine.ts
 *
 * Covers:
 *   1. buildTicketsFromPicks — deterministic IDs (same picks → same IDs across calls)
 *   2. resolveTickets — full match, partial match, and total miss
 */

import { describe, it, expect } from "vitest";
import { buildTicketsFromPicks, resolveTickets } from "./picksEngine.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePick(
  id: string,
  riskTier: "Safe" | "Balanced" | "Aggressive",
  confidence = 70,
) {
  return {
    id,
    playerName: `Player ${id}`,
    team: "TeamA",
    opponent: "TeamB",
    sport: "NBA",
    propType: "Points",
    line: 20,
    direction: "Over" as const,
    projection: 22,
    confidence,
    riskTier,
    explanation: "test",
    socialImpact: null,
    createdAt: new Date().toISOString(),
  };
}

// Build a minimal set of picks: 6 Balanced
const BALANCED_PICKS = [
  makePick("b1", "Balanced", 80),
  makePick("b2", "Balanced", 75),
  makePick("b3", "Balanced", 72),
  makePick("b4", "Balanced", 68),
  makePick("b5", "Balanced", 65),
  makePick("b6", "Balanced", 60),
];

// Mixed: 3 of each tier
const MIXED_PICKS = [
  makePick("s1", "Safe", 85),
  makePick("s2", "Safe", 82),
  makePick("s3", "Safe", 80),
  makePick("b1", "Balanced", 75),
  makePick("b2", "Balanced", 70),
  makePick("b3", "Balanced", 65),
  makePick("a1", "Aggressive", 58),
  makePick("a2", "Aggressive", 54),
  makePick("a3", "Aggressive", 50),
];

// ─── buildTicketsFromPicks ────────────────────────────────────────────────────

describe("buildTicketsFromPicks", () => {
  it("produces deterministic IDs — same picks produce same IDs on repeated calls", () => {
    const first = buildTicketsFromPicks(BALANCED_PICKS, 3, "Balanced");
    const second = buildTicketsFromPicks(BALANCED_PICKS, 3, "Balanced");
    expect(first.map((t) => t.id)).toEqual(second.map((t) => t.id));
  });

  it("only includes the requested tier in single-tier mode", () => {
    const tickets = buildTicketsFromPicks(MIXED_PICKS, 3, "Safe");
    const tiers = [...new Set(tickets.flatMap((t) => t.picks.map((p) => p.riskTier)))];
    expect(tiers).toEqual(["Safe"]);
  });

  it("labels Mixed tickets and interleaves picks from all three tiers", () => {
    const tickets = buildTicketsFromPicks(MIXED_PICKS, 3, "Mixed");
    expect(tickets.length).toBeGreaterThan(0);
    tickets.forEach((t) => expect(t.riskTier).toBe("Mixed"));
    // Each ticket should contain picks from more than one tier
    const firstPickTiers = new Set(tickets[0]!.picks.map((p) => p.riskTier));
    expect(firstPickTiers.size).toBeGreaterThan(1);
  });

  it("respects picksPerTicket within the 3–6 clamp", () => {
    const size4 = buildTicketsFromPicks(BALANCED_PICKS, 4, "Balanced");
    // First full ticket should have 4 picks
    const fullTickets = size4.filter((t) => t.picks.length === 4);
    expect(fullTickets.length).toBeGreaterThan(0);
  });
});

// ─── resolveTickets ───────────────────────────────────────────────────────────

describe("resolveTickets", () => {
  const tickets = buildTicketsFromPicks(BALANCED_PICKS, 3, "Balanced");

  it("returns all requested tickets when IDs still match (no rotation)", () => {
    const ids = tickets.map((t) => t.id);
    const { matched, skippedCount } = resolveTickets(tickets, ids);
    expect(matched.length).toBe(tickets.length);
    expect(skippedCount).toBe(0);
  });

  it("returns partial matches and correct skippedCount when some IDs have rotated", () => {
    const validId = tickets[0]!.id;
    const stalIds = ["ticket-stale-abc123", "ticket-stale-def456"];
    const requestedIds = [validId, ...stalIds];

    const { matched, skippedCount } = resolveTickets(tickets, requestedIds);

    expect(matched.length).toBe(1);
    expect(matched[0]!.id).toBe(validId);
    expect(skippedCount).toBe(2);
  });

  it("returns empty matched array and full skippedCount when ALL IDs have rotated", () => {
    const staleIds = ["ticket-ghost-1", "ticket-ghost-2", "ticket-ghost-3"];
    const { matched, skippedCount } = resolveTickets(tickets, staleIds);
    expect(matched.length).toBe(0);
    expect(skippedCount).toBe(3);
  });

  it("handles an empty request without errors", () => {
    const { matched, skippedCount } = resolveTickets(tickets, []);
    expect(matched.length).toBe(0);
    expect(skippedCount).toBe(0);
  });

  it("handles an empty ticket pool without errors", () => {
    const { matched, skippedCount } = resolveTickets([], ["some-id"]);
    expect(matched.length).toBe(0);
    expect(skippedCount).toBe(1);
  });
});
