import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { RiskBadge } from '@/components/RiskBadge';
import { ConfidenceBar } from '@/components/ConfidenceBar';

interface Pick {
  id: string;
  playerName: string;
  team: string;
  opponent?: string | null;
  sport: string;
  propType: string;
  line: number;
  direction?: string | null;
  projection: number;
  confidence: number;
  riskTier: string;
  explanation: string;
  createdAt?: string | null;
}

interface PickCardProps {
  pick: Pick;
  compact?: boolean;
}

export function PickCard({ pick, compact = false }: PickCardProps) {
  const colors = useColors();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {/* Header row: player info + risk badge */}
      <View style={styles.header}>
        <View style={styles.playerInfo}>
          <Text
            style={[
              styles.playerName,
              { color: colors.foreground, fontFamily: 'Inter_700Bold' },
            ]}
            numberOfLines={1}
          >
            {pick.playerName}
          </Text>
          <Text
            style={[
              styles.matchup,
              { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
            ]}
            numberOfLines={1}
          >
            {pick.sport} · {pick.team}{pick.opponent ? ` vs ${pick.opponent}` : ''}
          </Text>
        </View>
        <RiskBadge tier={pick.riskTier as 'Safe' | 'Balanced' | 'Aggressive'} size={compact ? 'sm' : 'md'} />
      </View>

      {/* Prop row: type chip + line + projection */}
      <View style={styles.propRow}>
        <View style={[styles.propChip, { backgroundColor: colors.secondary }]}>
          <Text
            style={[
              styles.propType,
              { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
            ]}
          >
            {pick.propType}
          </Text>
        </View>
        <Text
          style={[
            styles.line,
            { color: colors.foreground, fontFamily: 'Inter_700Bold' },
          ]}
        >
          {pick.direction ?? 'OVER'} {pick.line}
        </Text>
        <Text
          style={[
            styles.projection,
            { color: colors.primary, fontFamily: 'Inter_600SemiBold' },
          ]}
        >
          Proj. {pick.projection.toFixed(1)}
        </Text>
      </View>

      {/* Confidence bar */}
      <ConfidenceBar value={pick.confidence} />

      {/* Explanation (full cards only) */}
      {!compact && (
        <Text
          style={[
            styles.explanation,
            { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
          ]}
          numberOfLines={2}
        >
          {pick.explanation}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  playerInfo: {
    flex: 1,
    gap: 2,
  },
  playerName: {
    fontSize: 15,
  },
  matchup: {
    fontSize: 12,
  },
  propRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  propChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
  },
  propType: {
    fontSize: 11,
  },
  line: {
    fontSize: 15,
  },
  projection: {
    fontSize: 13,
    marginLeft: 'auto',
  },
  explanation: {
    fontSize: 12,
    lineHeight: 18,
  },
});
