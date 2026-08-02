/**
 * Builds the live-data context block appended to the Ghostphere system prompt.
 * Extracted as a pure-ish function so it can be unit-tested independently of
 * the Express route.
 *
 * @param getPicks   - supplier for the current pick list (injectable for tests)
 * @param getStatus  - supplier for the current cache status (injectable for tests)
 * @param riskProfile    - the user's active risk mode; defaults to "Balanced"
 * @param picksPerTicket - the user's ticket size preference; defaults to 3
 */
export function buildLivePicksContext(
  getPicks: () => Array<{
    playerName: string;
    direction?: string;
    line: number;
    propType: string;
    sport: string;
    confidence: number;
    riskTier: string;
    team: string;
  }>,
  getStatus: () => { lastRefreshedAt: string | null; source: string },
  riskProfile: string = "Balanced",
  picksPerTicket: number = 3,
): string {
  const status = getStatus();
  const picks = getPicks();

  const profileLine =
    `USER BETTING PROFILE: ${riskProfile} · ${picksPerTicket} pick${picksPerTicket !== 1 ? "s" : ""} per ticket\n` +
    `When building ticket suggestions, use ONLY picks from the ${
      riskProfile === "Mixed"
        ? "all three tiers (Safe + Balanced + Aggressive, interleaved)"
        : `${riskProfile} tier`
    } and group them into ${picksPerTicket}-pick parlays. Label each suggested ticket clearly.`;

  if (!picks.length) {
    return (
      `\n\n[GHOSTWATCH DATA: No picks currently loaded — data may be refreshing.]\n\n` +
      profileLine +
      `\n\nPRIZEPICKS RULES: Over/Under player props only. Power Play = all must hit (3=5x, 4=10x, 5=20x, 6=40x). Flex Play = partial credit (3 picks: 2.25x/1.25x, 4: 5x/1.5x, 5: 10x/2x/0.5x, 6: 20x/2x/0.5x).`
    );
  }

  const byTier = {
    Safe: picks.filter((p) => p.riskTier === "Safe").length,
    Balanced: picks.filter((p) => p.riskTier === "Balanced").length,
    Aggressive: picks.filter((p) => p.riskTier === "Aggressive").length,
  };

  const bySport: Record<string, number> = {};
  for (const p of picks) {
    bySport[p.sport] = (bySport[p.sport] ?? 0) + 1;
  }
  const sportSummary = Object.entries(bySport)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s}: ${n}`)
    .join(" | ");

  const topPicks = [...picks]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);

  const pickLines = topPicks
    .map(
      (p) =>
        `  • ${p.playerName} — ${p.direction ?? ""} ${p.line} ${p.propType} | ${p.sport} | ${p.confidence}% conf | ${p.riskTier} | ${p.team}`,
    )
    .join("\n");

  const refreshed = status.lastRefreshedAt
    ? new Date(status.lastRefreshedAt).toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        day: "numeric",
      })
    : "not yet refreshed";

  return `

LIVE GHOSTWATCH DATA (last updated ${refreshed} ET | ${status.source}):
Total picks: ${picks.length} | Safe: ${byTier.Safe} | Balanced: ${byTier.Balanced} | Aggressive: ${byTier.Aggressive}
Sports coverage: ${sportSummary}

Top 10 picks by confidence:
${pickLines}

${profileLine}

PRIZEPICKS RULES (always follow these when building entries):
- All picks are Over/Under player props only. No spreads or moneylines.
- Power Play entries: ALL picks must be correct to win. Multipliers: 2=3x, 3=5x, 4=10x, 5=20x, 6=40x.
- Flex Play entries: partial credit allowed. 3 picks: 2.25x all / 1.25x (1 miss). 4 picks: 5x all / 1.5x (1 miss). 5 picks: 10x all / 2x (1 miss) / 0.5x (2 miss). 6 picks: 20x all / 2x (1 miss) / 0.5x (2 miss).
- Minimum 2 picks per entry, maximum 6. Always state the payout multiplier when suggesting an entry.

Full pick list available if user asks for all picks. Use the above data to answer questions about today's slate, build entry constructions, and analyze specific props.`;
}
