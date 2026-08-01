// Mock data for Ghostwatch — structured to allow easy swap-in of real APIs

export const SPORTS = ["NBA", "WNBA", "NFL", "MLB", "NHL"];

export const mockGames = [
  { id: "g1", homeTeam: "Los Angeles Lakers", awayTeam: "Golden State Warriors", sport: "NBA", scheduledAt: new Date().toISOString(), status: "Scheduled", homeScore: null, awayScore: null, quarter: null, timeRemaining: null },
  { id: "g2", homeTeam: "Boston Celtics", awayTeam: "Miami Heat", sport: "NBA", scheduledAt: new Date().toISOString(), status: "Live", homeScore: 88, awayScore: 84, quarter: "Q3", timeRemaining: "4:22" },
  { id: "g3", homeTeam: "Denver Nuggets", awayTeam: "Oklahoma City Thunder", sport: "NBA", scheduledAt: new Date().toISOString(), status: "Final", homeScore: 112, awayScore: 108, quarter: "Final", timeRemaining: "0:00" },
  { id: "g4", homeTeam: "Dallas Cowboys", awayTeam: "Philadelphia Eagles", sport: "NFL", scheduledAt: new Date().toISOString(), status: "Scheduled", homeScore: null, awayScore: null, quarter: null, timeRemaining: null },
  { id: "g5", homeTeam: "New York Yankees", awayTeam: "Boston Red Sox", sport: "MLB", scheduledAt: new Date().toISOString(), status: "Live", homeScore: 3, awayScore: 2, quarter: "7th", timeRemaining: "Top" },
  { id: "g6", homeTeam: "Las Vegas Aces", awayTeam: "New York Liberty", sport: "WNBA", scheduledAt: new Date().toISOString(), status: "Scheduled", homeScore: null, awayScore: null, quarter: null, timeRemaining: null },
  { id: "g7", homeTeam: "Toronto Raptors", awayTeam: "Chicago Bulls", sport: "NBA", scheduledAt: new Date().toISOString(), status: "Live", homeScore: 67, awayScore: 71, quarter: "Q2", timeRemaining: "1:15" },
];

export const mockPicks = [
  { id: "p1", playerName: "LeBron James", team: "LA Lakers", opponent: "GSW", sport: "NBA", propType: "Points", line: 25.5, direction: "Over", projection: 28.9, confidence: 82, riskTier: "Safe", explanation: "LeBron averaging 29.1 PPG in last 5 vs. Warriors. GSW ranked 28th in perimeter defense. High usage expected with AD questionable.", socialImpact: 0.1, createdAt: new Date().toISOString() },
  { id: "p2", playerName: "Jayson Tatum", team: "Boston Celtics", opponent: "MIA", sport: "NBA", propType: "Points + Rebounds", line: 32.5, direction: "Over", projection: 35.2, confidence: 77, riskTier: "Balanced", explanation: "Tatum thrives vs. zone defenses. Heat will deploy 2-3 zone 60% of the time historically. Double-double candidate.", socialImpact: 0.0, createdAt: new Date().toISOString() },
  { id: "p3", playerName: "Nikola Jokic", team: "Denver Nuggets", opponent: "OKC", sport: "NBA", propType: "Assists", line: 7.5, direction: "Over", projection: 9.1, confidence: 88, riskTier: "Safe", explanation: "Jokic averaging 9.4 APG this month. OKC switches on ball handlers, opening drive-and-dish lanes. Top 3 assist projection of the slate.", socialImpact: -0.05, createdAt: new Date().toISOString() },
  { id: "p4", playerName: "Shai Gilgeous-Alexander", team: "OKC Thunder", opponent: "DEN", sport: "NBA", propType: "Points", line: 30.5, direction: "Over", projection: 33.7, confidence: 79, riskTier: "Balanced", explanation: "SGA leads team in usage at 34.2%. Denver's perimeter defense ranks 22nd. Projected 34-minute floor time.", socialImpact: 0.2, createdAt: new Date().toISOString() },
  { id: "p5", playerName: "Dak Prescott", team: "Dallas Cowboys", opponent: "PHI", sport: "NFL", propType: "Passing Yards", line: 265.5, direction: "Over", projection: 291.0, confidence: 71, riskTier: "Balanced", explanation: "Prescott averaging 287 yards vs. division rivals this season. Eagles secondary depleted with 2 starters questionable.", socialImpact: 0.0, createdAt: new Date().toISOString() },
  { id: "p6", playerName: "Aaron Judge", team: "NY Yankees", opponent: "BOS", sport: "MLB", propType: "Total Bases", line: 1.5, direction: "Over", projection: 2.3, confidence: 64, riskTier: "Aggressive", explanation: "Judge has hit .412 against today's starter in career matchups (7 AB). Wind blowing out 12 mph at Fenway favors long ball.", socialImpact: 0.0, createdAt: new Date().toISOString() },
  { id: "p7", playerName: "A'ja Wilson", team: "Las Vegas Aces", opponent: "NYL", sport: "WNBA", propType: "Points + Rebounds", line: 28.5, direction: "Over", projection: 31.8, confidence: 85, riskTier: "Safe", explanation: "Wilson averaging 31.2 P+R this season. Liberty's frontcourt size mismatch gives Wilson interior advantages. Back-to-back game for NY adds fatigue factor.", socialImpact: 0.0, createdAt: new Date().toISOString() },
  { id: "p8", playerName: "RJ Barrett", team: "Toronto Raptors", opponent: "CHI", sport: "NBA", propType: "Points", line: 20.5, direction: "Over", projection: 18.1, confidence: 45, riskTier: "Aggressive", explanation: "Barrett's usage uptick at home (29.1%) vs. away (23.4%). Chicago ranks 8th in perimeter defense, creating volatile outcome. High ceiling, high floor risk.", socialImpact: -0.4, createdAt: new Date().toISOString() },
];

export const mockLiveGames = [
  { id: "g2", homeTeam: "Boston Celtics", awayTeam: "Miami Heat", sport: "NBA", homeScore: 88, awayScore: 84, quarter: "Q3", timeRemaining: "4:22", pace: "Fast", status: "Live" },
  { id: "g5", homeTeam: "New York Yankees", awayTeam: "Boston Red Sox", sport: "MLB", homeScore: 3, awayScore: 2, quarter: "7th", timeRemaining: "Top", pace: "Normal", status: "Live" },
  { id: "g7", homeTeam: "Toronto Raptors", awayTeam: "Chicago Bulls", sport: "NBA", homeScore: 67, awayScore: 71, quarter: "Q2", timeRemaining: "1:15", pace: "Slow", status: "Live" },
];

export const mockLivePicks = [
  { id: "lp1", gameId: "g2", playerName: "Jayson Tatum", team: "Boston Celtics", propType: "Points", line: 25.5, direction: "Over", projection: 30.2, confidence: 83, riskTier: "Safe", explanation: "Pace is elevated — 112 possessions projected vs. 106 pregame. Tatum already at 22 pts in Q3. On pace for 38. Over is live.", sport: "NBA", detectedSignals: ["PaceSpike", "UsageSpike"] },
  { id: "lp2", gameId: "g2", playerName: "Jimmy Butler", team: "Miami Heat", propType: "Assists", line: 4.5, direction: "Over", projection: 6.1, confidence: 70, riskTier: "Balanced", explanation: "Heat switched to motion offense in Q3, Butler driving and kicking. 4 assists already.", sport: "NBA", detectedSignals: ["UsageSpike"] },
  { id: "lp3", gameId: "g7", playerName: "Pascal Siakam", team: "Toronto Raptors", propType: "Rebounds", line: 7.5, direction: "Over", projection: 9.3, confidence: 76, riskTier: "Balanced", explanation: "Bulls missing starting center — Siakam dominating glass. 6 boards in first half. Bulls pace allows extra offensive rebound opportunities.", sport: "NBA", detectedSignals: ["MismatchDetected"] },
];

export const mockSignals: Record<string, Array<{id: string; gameId: string; type: string; description: string; strength: string; playerName: string; team: string}>> = {
  "g2": [
    { id: "s1", gameId: "g2", type: "PaceSpike", description: "Game pace 8% above pregame projection — 112 possessions on track vs. 104 expected.", strength: "High", playerName: "Jayson Tatum", team: "Boston Celtics" },
    { id: "s2", gameId: "g2", type: "UsageSpike", description: "Tatum usage rate at 38.4% in Q3, up from 29.1% season average.", strength: "High", playerName: "Jayson Tatum", team: "Boston Celtics" },
    { id: "s3", gameId: "g2", type: "InjuryUpdate", description: "Tyler Herro left game in Q2 with ankle sprain — Butler assuming primary ball-handling duties.", strength: "Medium", playerName: "Jimmy Butler", team: "Miami Heat" },
  ],
  "g7": [
    { id: "s4", gameId: "g7", type: "MismatchDetected", description: "Bulls starting center ruled out in warmups — Raptors frontcourt +4 inches average height advantage.", strength: "High", playerName: "Pascal Siakam", team: "Toronto Raptors" },
    { id: "s5", gameId: "g7", type: "FoulTrouble", description: "Anunoby picked up 3rd foul at 6:42 Q2 — reduced minutes expected in Q3.", strength: "Medium", playerName: "OG Anunoby", team: "Toronto Raptors" },
  ],
  "g5": [
    { id: "s6", gameId: "g5", type: "PaceSpike", description: "Yankees bullpen already warming in 7th — starter likely 1 more out.", strength: "Low", playerName: "Aaron Judge", team: "NY Yankees" },
  ],
};

export const mockTickets = [
  {
    id: "t1",
    riskTier: "Safe",
    picks: [mockPicks[0], mockPicks[2], mockPicks[6]],
    combinedConfidence: 85,
    sport: "Mixed",
    createdAt: new Date().toISOString(),
  },
  {
    id: "t2",
    riskTier: "Balanced",
    picks: [mockPicks[1], mockPicks[3], mockPicks[4]],
    combinedConfidence: 75.7,
    sport: "Mixed",
    createdAt: new Date().toISOString(),
  },
  {
    id: "t3",
    riskTier: "Aggressive",
    picks: [mockPicks[5], mockPicks[7]],
    combinedConfidence: 54.5,
    sport: "Mixed",
    createdAt: new Date().toISOString(),
  },
  {
    id: "t4",
    riskTier: "Safe",
    picks: [mockPicks[0], mockPicks[6]],
    combinedConfidence: 83.5,
    sport: "NBA",
    createdAt: new Date().toISOString(),
  },
];

export const mockAlerts = [
  { id: "a1", playerId: "pl1", playerName: "RJ Barrett", team: "Toronto Raptors", alertType: "PartyRisk", description: "Social media activity detected at 2:30 AM local time. Multiple posts from nightclub location.", severity: "High", source: "Social Media Analysis", createdAt: new Date().toISOString() },
  { id: "a2", playerId: "pl2", playerName: "LeBron James", team: "LA Lakers", alertType: "MotivationBoost", description: "Posted pregame hype content. Engagement 3x normal baseline. Competitive messaging detected.", severity: "Low", source: "Social Media Analysis", createdAt: new Date().toISOString() },
  { id: "a3", playerId: "pl3", playerName: "Dak Prescott", team: "Dallas Cowboys", alertType: "FatigueRisk", description: "Red-eye flight from West Coast after away game. 4-hour sleep window detected via activity data.", severity: "Medium", source: "Travel Intelligence", createdAt: new Date().toISOString() },
  { id: "a4", playerId: "pl4", playerName: "Jimmy Butler", team: "Miami Heat", alertType: "InjuryConcern", description: "Seen in ankle wrap during shoot-around. Team listed as questionable on injury report.", severity: "High", source: "Beat Reporter Network", createdAt: new Date().toISOString() },
  { id: "a5", playerId: "pl5", playerName: "Nikola Jokic", team: "Denver Nuggets", alertType: "MotivationBoost", description: "Locked-in demeanor per beat reporters. No off-court distractions detected. Family in town.", severity: "Low", source: "Reporter Intel", createdAt: new Date().toISOString() },
  { id: "a6", playerId: "pl6", playerName: "Aaron Judge", team: "NY Yankees", alertType: "FatigueRisk", description: "5th game in 5 days. Exit velocity trending down 2.1 mph over last 3 games.", severity: "Medium", source: "Statcast Analysis", createdAt: new Date().toISOString() },
  { id: "a7", playerId: "pl7", playerName: "Shai Gilgeous-Alexander", team: "OKC Thunder", alertType: "DramaAlert", description: "Cryptic social post after coaching staff meeting. Unconfirmed reporting of contract frustration.", severity: "Medium", source: "Social Media Analysis", createdAt: new Date().toISOString() },
];

export const mockPlayerSocialScores = [
  { playerId: "pl1", playerName: "RJ Barrett", team: "Toronto Raptors", sport: "NBA", socialImpactScore: -0.82, flags: ["PartyRisk", "FatigueRisk"], updatedAt: new Date().toISOString() },
  { playerId: "pl2", playerName: "LeBron James", team: "LA Lakers", sport: "NBA", socialImpactScore: 0.31, flags: ["MotivationBoost"], updatedAt: new Date().toISOString() },
  { playerId: "pl3", playerName: "Dak Prescott", team: "Dallas Cowboys", sport: "NFL", socialImpactScore: -0.45, flags: ["FatigueRisk"], updatedAt: new Date().toISOString() },
  { playerId: "pl4", playerName: "Jimmy Butler", team: "Miami Heat", sport: "NBA", socialImpactScore: -0.61, flags: ["InjuryConcern"], updatedAt: new Date().toISOString() },
  { playerId: "pl5", playerName: "Nikola Jokic", team: "Denver Nuggets", sport: "NBA", socialImpactScore: 0.22, flags: ["MotivationBoost"], updatedAt: new Date().toISOString() },
  { playerId: "pl6", playerName: "Aaron Judge", team: "NY Yankees", sport: "MLB", socialImpactScore: -0.38, flags: ["FatigueRisk"], updatedAt: new Date().toISOString() },
  { playerId: "pl7", playerName: "Shai Gilgeous-Alexander", team: "OKC Thunder", sport: "NBA", socialImpactScore: -0.29, flags: ["DramaAlert"], updatedAt: new Date().toISOString() },
  { playerId: "pl8", playerName: "A'ja Wilson", team: "Las Vegas Aces", sport: "WNBA", socialImpactScore: 0.45, flags: ["MotivationBoost"], updatedAt: new Date().toISOString() },
];

export const mockTeamPulse = [
  { teamId: "t1", teamName: "Los Angeles Lakers", sport: "NBA", chemistryScore: 72, dramaLevel: "Medium", travelFatigue: "Moderate", recentAlerts: 2, notes: "AD/LeBron dynamic in transition phase. 3 of last 5 games on road." },
  { teamId: "t2", teamName: "Boston Celtics", sport: "NBA", chemistryScore: 91, dramaLevel: "Low", travelFatigue: "None", recentAlerts: 0, notes: "Strong locker room cohesion. Home stand continues." },
  { teamId: "t3", teamName: "Miami Heat", sport: "NBA", chemistryScore: 68, dramaLevel: "High", travelFatigue: "Moderate", recentAlerts: 3, notes: "Butler injury concern dominating narrative. Roster uncertainty affecting preparation." },
  { teamId: "t4", teamName: "OKC Thunder", sport: "NBA", chemistryScore: 79, dramaLevel: "Medium", travelFatigue: "None", recentAlerts: 1, notes: "SGA contract situation creating low-level distraction. Young roster otherwise focused." },
  { teamId: "t5", teamName: "Dallas Cowboys", sport: "NFL", chemistryScore: 63, dramaLevel: "High", travelFatigue: "Severe", recentAlerts: 4, notes: "West Coast trip + late game. Multiple reports of internal disagreements on offensive scheme." },
  { teamId: "t6", teamName: "Denver Nuggets", sport: "NBA", chemistryScore: 88, dramaLevel: "Low", travelFatigue: "None", recentAlerts: 0, notes: "Jokic era continuity. Home court strong. Clean prep week." },
];
