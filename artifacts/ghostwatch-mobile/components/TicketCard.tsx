import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { RiskBadge } from '@/components/RiskBadge';

interface TicketPick {
  id: string;
  playerName: string;
  propType: string;
  line: number;
  direction?: string | null;
  confidence: number;
  riskTier: string;
}

interface Ticket {
  id: string;
  riskTier: 'Safe' | 'Balanced' | 'Aggressive';
  picks: TicketPick[];
  combinedConfidence: number;
  sport: string;
  createdAt: string;
}

interface TicketCardProps {
  ticket: Ticket;
}

export function TicketCard({ ticket }: TicketCardProps) {
  const colors = useColors();

  const tierColor: Record<string, string> = {
    Safe: colors.safe,
    Balanced: colors.balanced,
    Aggressive: colors.aggressive,
  };
  const tc = tierColor[ticket.riskTier] ?? colors.primary;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderLeftColor: tc,
        },
      ]}
    >
      {/* Ticket header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text
            style={[
              styles.sport,
              { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
            ]}
          >
            {ticket.sport.toUpperCase()}
          </Text>
          <RiskBadge tier={ticket.riskTier} />
        </View>
        <View style={styles.confBlock}>
          <Text
            style={[
              styles.confLabel,
              { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
            ]}
          >
            COMBINED
          </Text>
          <Text
            style={[
              styles.confValue,
              { color: tc, fontFamily: 'Inter_700Bold' },
            ]}
          >
            {Math.round(ticket.combinedConfidence)}%
          </Text>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Pick rows */}
      <View style={styles.picks}>
        {ticket.picks.map((pick, idx) => (
          <View key={pick.id} style={styles.pickRow}>
            <View style={[styles.idx, { backgroundColor: colors.secondary }]}>
              <Text
                style={[
                  styles.idxText,
                  { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' },
                ]}
              >
                {idx + 1}
              </Text>
            </View>
            <View style={styles.pickInfo}>
              <Text
                style={[
                  styles.pickPlayer,
                  { color: colors.foreground, fontFamily: 'Inter_600SemiBold' },
                ]}
                numberOfLines={1}
              >
                {pick.playerName}
              </Text>
              <Text
                style={[
                  styles.pickProp,
                  { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
                ]}
                numberOfLines={1}
              >
                {pick.direction ?? 'OVER'} {pick.line} {pick.propType}
              </Text>
            </View>
            <Text
              style={[
                styles.pickConf,
                { color: colors.primary, fontFamily: 'Inter_600SemiBold' },
              ]}
            >
              {Math.round(pick.confidence)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderLeftWidth: 3,
    marginBottom: 10,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    gap: 6,
  },
  sport: {
    fontSize: 9,
    letterSpacing: 2,
  },
  confBlock: {
    alignItems: 'flex-end',
  },
  confLabel: {
    fontSize: 9,
    letterSpacing: 1.5,
  },
  confValue: {
    fontSize: 26,
    lineHeight: 30,
  },
  divider: {
    height: 1,
  },
  picks: {
    gap: 10,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  idx: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idxText: {
    fontSize: 11,
  },
  pickInfo: {
    flex: 1,
    gap: 2,
  },
  pickPlayer: {
    fontSize: 13,
  },
  pickProp: {
    fontSize: 11,
  },
  pickConf: {
    fontSize: 13,
  },
});
