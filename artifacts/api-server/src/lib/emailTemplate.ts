/**
 * Ghostspere email template — PrizePicks-style HTML + plain-text emails for entry dispatch.
 */

interface Pick {
  playerName: string;
  team: string;
  opponent: string;
  sport: string;
  propType: string;
  line: number;
  direction?: string;
  projection: number;
  confidence: number;
  riskTier: string;
  explanation: string;
}

interface Ticket {
  id: string;
  riskTier: string;
  entryType?: string;
  payoutMultiplier?: number;
  picks: Pick[];
  combinedConfidence: number;
  sport: string;
  createdAt: string;
}

const ENTRY_COLOR: Record<string, string> = {
  PowerPlay: "#7c3aed",
  FlexPlay:  "#0ea5e9",
};

const ENTRY_BG: Record<string, string> = {
  PowerPlay: "#0d0918",
  FlexPlay:  "#00111c",
};

// Flex Play partial-credit breakdowns
const FP_BREAKDOWN: Record<number, string> = {
  2: "3x",
  3: "2.25x · 1.25x (1 miss)",
  4: "5x · 1.5x (1 miss)",
  5: "10x · 2x (1 miss) · 0.5x (2 miss)",
  6: "20x · 2x (1 miss) · 0.5x (2 miss)",
};

function entryBadge(entryType: string): string {
  const color = ENTRY_COLOR[entryType] ?? "#7c3aed";
  const bg    = ENTRY_BG[entryType]   ?? "#0d0d0d";
  const label = entryType === "FlexPlay" ? "FLEX PLAY" : "POWER PLAY";
  return `<span style="display:inline-block;padding:2px 10px;border-radius:4px;border:1px solid ${color};color:${color};background:${bg};font-size:11px;font-family:monospace;font-weight:700;letter-spacing:1px;text-transform:uppercase">${label}</span>`;
}

function renderPick(pick: Pick, idx: number): string {
  const direction  = pick.direction ?? "Over";
  const dirSymbol  = direction === "Over" ? "▲ O" : "▼ U";
  const confColor  = pick.confidence >= 80 ? "#22c55e" : pick.confidence >= 65 ? "#f59e0b" : "#ef4444";

  return `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #1e1e2e">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <div style="font-family:monospace;font-size:13px;color:#e2e8f0;font-weight:700">${idx + 1}. ${pick.playerName}</div>
              <div style="font-family:monospace;font-size:11px;color:#64748b;margin-top:2px">${pick.sport} · ${pick.propType}</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:6px;line-height:1.5">${pick.explanation}</div>
            </td>
            <td style="text-align:right;vertical-align:top;white-space:nowrap;padding-left:16px">
              <div style="font-family:monospace;font-size:18px;font-weight:700;color:#7c3aed">${dirSymbol} ${pick.line}</div>
              <div style="font-family:monospace;font-size:11px;color:${confColor};margin-top:4px">${pick.confidence}% signal</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function renderTicket(ticket: Ticket, ticketNum: number): string {
  const entryType      = ticket.entryType ?? "PowerPlay";
  const multiplier     = ticket.payoutMultiplier ?? (entryType === "PowerPlay" ? 5 : 2.25);
  const entryColor     = ENTRY_COLOR[entryType] ?? "#7c3aed";
  const pickCount      = ticket.picks.length;
  const flexBreakdown  = entryType === "FlexPlay" ? (FP_BREAKDOWN[pickCount] ?? `${multiplier}x`) : null;

  const picksHtml = ticket.picks.map((p, i) => renderPick(p, i)).join("");
  const dateStr   = new Date(ticket.createdAt).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;background:#0f0f1a;border:1px solid #1e1e2e;border-left:3px solid ${entryColor};border-radius:6px">
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #1e1e2e">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <div style="font-family:monospace;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Entry #${ticketNum} · ${pickCount} picks · ${dateStr}</div>
                <div style="margin-top:6px">${entryBadge(entryType)} <span style="font-family:monospace;font-size:11px;color:#64748b;margin-left:8px">${ticket.sport}</span></div>
                ${flexBreakdown ? `<div style="font-family:monospace;font-size:10px;color:#475569;margin-top:6px">Flex payouts: ${flexBreakdown}</div>` : ""}
              </td>
              <td style="text-align:right">
                <div style="font-family:monospace;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Payout</div>
                <div style="font-family:monospace;font-size:28px;font-weight:700;color:${entryColor}">${multiplier}x</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 20px">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${picksHtml}
          </table>
        </td>
      </tr>
    </table>
  `;
}

export function buildEmailHtml(tickets: Ticket[], recipientEmail: string): string {
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const ticketsHtml = tickets.map((t, i) => renderTicket(t, i + 1)).join("");
  const totalPicks  = tickets.reduce((sum, t) => sum + t.picks.length, 0);
  const avgMultiplier = tickets.length
    ? (tickets.reduce((sum, t) => sum + (t.payoutMultiplier ?? 5), 0) / tickets.length).toFixed(1)
    : "0";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ghostspere — PrizePicks Entry Dispatch</title>
</head>
<body style="margin:0;padding:0;background:#080810;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080810;min-height:100vh">
    <tr>
      <td align="center" style="padding:40px 20px">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

          <!-- Header -->
          <tr>
            <td style="padding-bottom:32px;text-align:center">
              <div style="font-family:monospace;font-size:24px;font-weight:700;color:#7c3aed;letter-spacing:2px">👻 GHOSTSPERE</div>
              <div style="font-family:monospace;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:2px;margin-top:4px">PrizePicks Entry Dispatch</div>
              <div style="font-family:monospace;font-size:12px;color:#475569;margin-top:16px">${dateLabel}</div>
            </td>
          </tr>

          <!-- Summary bar -->
          <tr>
            <td style="padding-bottom:28px">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;border:1px solid #1e1e2e;border-radius:6px">
                <tr>
                  <td style="padding:16px 20px;text-align:center;border-right:1px solid #1e1e2e;width:33%">
                    <div style="font-family:monospace;font-size:22px;font-weight:700;color:#e2e8f0">${tickets.length}</div>
                    <div style="font-family:monospace;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:2px">Entries</div>
                  </td>
                  <td style="padding:16px 20px;text-align:center;border-right:1px solid #1e1e2e;width:33%">
                    <div style="font-family:monospace;font-size:22px;font-weight:700;color:#e2e8f0">${totalPicks}</div>
                    <div style="font-family:monospace;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:2px">Total Picks</div>
                  </td>
                  <td style="padding:16px 20px;text-align:center;width:33%">
                    <div style="font-family:monospace;font-size:22px;font-weight:700;color:#7c3aed">${avgMultiplier}x</div>
                    <div style="font-family:monospace;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:2px">Avg Payout</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Entries -->
          ${ticketsHtml}

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;border-top:1px solid #1e1e2e;text-align:center">
              <div style="font-family:monospace;font-size:11px;color:#334155">Dispatched by Ghostspere to ${recipientEmail}</div>
              <div style="font-family:monospace;font-size:10px;color:#1e293b;margin-top:6px">For entertainment purposes only. Not financial advice.</div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export function buildEmailText(tickets: Ticket[]): string {
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const lines: string[] = [
    "GHOSTSPERE — PRIZEPICKS ENTRY DISPATCH",
    "=".repeat(40),
    dateLabel,
    "",
  ];

  for (let i = 0; i < tickets.length; i++) {
    const t          = tickets[i]!;
    const entryType  = t.entryType ?? "PowerPlay";
    const multiplier = t.payoutMultiplier ?? 5;
    const label      = entryType === "FlexPlay" ? "FLEX PLAY" : "POWER PLAY";

    lines.push(`ENTRY #${i + 1} — ${label} · ${t.picks.length} PICKS`);
    lines.push(`Payout: ${multiplier}x | Sport: ${t.sport}`);
    if (entryType === "FlexPlay") {
      const fb = FP_BREAKDOWN[t.picks.length];
      if (fb) lines.push(`Flex payouts: ${fb}`);
    }
    lines.push("-".repeat(36));

    for (const [j, pick] of t.picks.entries()) {
      const dir = pick.direction ?? "Over";
      lines.push(`${j + 1}. ${pick.playerName}`);
      lines.push(`   ${pick.sport} · ${pick.propType} · ${dir === "Over" ? "O" : "U"} ${pick.line}`);
      lines.push(`   Signal: ${pick.confidence}%`);
      lines.push(`   ${pick.explanation}`);
      lines.push("");
    }
    lines.push("");
  }

  lines.push("For entertainment purposes only. Not financial advice.");
  return lines.join("\n");
}
