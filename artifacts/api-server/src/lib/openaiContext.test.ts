/**
 * Unit tests for openaiContext.ts — buildLivePicksContext()
 *
 * Covers:
 *   1. Empty-cache path — profile block always present regardless of pick count
 *   2. Live-picks path — profile block present; tier-specific instructions per mode
 *   3. Mixed mode — instructs AI to blend all three tiers
 *   4. picksPerTicket clamping / grammar (singular vs plural)
 *   5. Default fallback (Balanced / 3 picks) when no args supplied
 */

import { describe, it, expect } from "vitest";
import { buildLivePicksContext } from "./openaiContext.js";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const emptyStatus = () => ({ lastRefreshedAt: null, source: "snapshot" });
const emptyPicks = () => [] as any[];

function makePickList() {
  return [
    { playerName: "Alice", direction: "Over", line: 20, propType: "Points", sport: "NBA", confidence: 85, riskTier: "Safe", team: "TeamA" },
    { playerName: "Bob",   direction: "Under", line: 5,  propType: "Assists", sport: "NBA", confidence: 72, riskTier: "Balanced", team: "TeamB" },
    { playerName: "Carol", direction: "Over", line: 50, propType: "Points", sport: "NFL", confidence: 58, riskTier: "Aggressive", team: "TeamC" },
  ];
}

const liveStatus = () => ({
  lastRefreshedAt: new Date("2026-08-02T10:00:00Z").toISOString(),
  source: "live",
});

// ─── Empty-cache path ─────────────────────────────────────────────────────────

describe("buildLivePicksContext — empty picks cache", () => {
  it("includes the profile name and picks-per-ticket even when no picks are loaded", () => {
    const ctx = buildLivePicksContext(emptyPicks, emptyStatus, "Aggressive", 5);
    expect(ctx).toContain("USER BETTING PROFILE: Aggressive · 5 picks per ticket");
  });

  it("includes Mixed-specific instruction when profile is Mixed (empty cache)", () => {
    const ctx = buildLivePicksContext(emptyPicks, emptyStatus, "Mixed", 6);
    expect(ctx).toContain("all three tiers (Safe + Balanced + Aggressive, interleaved)");
  });

  it("uses singular 'pick' when picksPerTicket is 1", () => {
    // Edge case — even though 1 is below the normal UI clamp, the function
    // should still grammatically correct the label.
    const ctx = buildLivePicksContext(emptyPicks, emptyStatus, "Safe", 1);
    expect(ctx).toContain("1 pick per ticket");
    expect(ctx).not.toContain("1 picks per ticket");
  });

  it("defaults to Balanced / 3 picks when no args are supplied", () => {
    const ctx = buildLivePicksContext(emptyPicks, emptyStatus);
    expect(ctx).toContain("USER BETTING PROFILE: Balanced · 3 picks per ticket");
    expect(ctx).toContain("Balanced tier");
  });
});

// ─── Live-picks path ──────────────────────────────────────────────────────────

describe("buildLivePicksContext — with live picks", () => {
  it("includes the profile block after the pick list", () => {
    const ctx = buildLivePicksContext(makePickList, liveStatus, "Safe", 3);
    expect(ctx).toContain("USER BETTING PROFILE: Safe · 3 picks per ticket");
    expect(ctx).toContain("Safe tier");
  });

  it("instructs AI to use Balanced tier for Balanced profile", () => {
    const ctx = buildLivePicksContext(makePickList, liveStatus, "Balanced", 4);
    expect(ctx).toContain("Balanced tier");
    expect(ctx).not.toContain("Aggressive tier");
  });

  it("instructs AI to use Aggressive tier for Aggressive profile", () => {
    const ctx = buildLivePicksContext(makePickList, liveStatus, "Aggressive", 4);
    expect(ctx).toContain("Aggressive tier");
    expect(ctx).not.toContain("Safe tier");
  });

  it("instructs AI to blend all three tiers for Mixed profile", () => {
    const ctx = buildLivePicksContext(makePickList, liveStatus, "Mixed", 6);
    expect(ctx).toContain("all three tiers (Safe + Balanced + Aggressive, interleaved)");
    expect(ctx).toContain("6-pick parlays");
  });

  it("includes the correct picks-per-ticket number in the parlay instruction", () => {
    const ctx = buildLivePicksContext(makePickList, liveStatus, "Balanced", 5);
    expect(ctx).toContain("5-pick parlays");
  });

  it("includes live-data tier counts and sport coverage", () => {
    const ctx = buildLivePicksContext(makePickList, liveStatus, "Safe", 3);
    expect(ctx).toContain("Safe: 1 | Balanced: 1 | Aggressive: 1");
    expect(ctx).toContain("NBA: 2");
    expect(ctx).toContain("NFL: 1");
  });

  it("lists top picks sorted by confidence descending", () => {
    const ctx = buildLivePicksContext(makePickList, liveStatus, "Balanced", 3);
    const aliceIdx = ctx.indexOf("Alice");
    const carolIdx = ctx.indexOf("Carol");
    // Alice (85%) should appear before Carol (58%)
    expect(aliceIdx).toBeLessThan(carolIdx);
  });
});
