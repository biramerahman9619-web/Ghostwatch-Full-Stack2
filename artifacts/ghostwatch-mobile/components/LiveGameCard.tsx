import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useListSignals } from '@workspace/api-client-react';
import { Ionicons } from '@expo/vector-icons';
import { SignalCard } from '@/components/SignalCard';

interface LiveGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  sport: string;
  homeScore: number;
  awayScore: number;
  quarter: string;
  timeRemaining: string;
  pace: 'Slow' | 'Normal' | 'Fast';
  status: 'Live' | 'Halftime' | 'Final';
}

function GameSignals({ gameId }: { gameId: string }) {
  const colors = useColors();
  const { data: signals, isLoading } = useListSignals({ gameId });

  if (isLoading) {
    return (
      <ActivityIndicator
        size="small"
        color={colors.primary}
        style={styles.sigLoader}
      />
    );
  }

  if (!signals || signals.length === 0) {
    return (
      <Text
        style={[
          styles.noSignals,
          { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
        ]}
      >
        No signals detected for this game
      </Text>
    );
  }

  return (
    <View style={styles.signalsList}>
      {signals.slice(0, 4).map((signal) => (
        <SignalCard key={signal.id} signal={signal} />
      ))}
    </View>
  );
}

export function LiveGameCard({ game }: { game: LiveGame }) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const isLive = game.status === 'Live';

  const paceColor =
    game.pace === 'Fast'
      ? colors.aggressive
      : game.pace === 'Slow'
      ? colors.safe
      : colors.balanced;

  const borderColor = isLive ? colors.primary + '44' : colors.border;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor },
      ]}
    >
      {/* Score row */}
      <View style={styles.scoreRow}>
        {/* Away */}
        <View style={styles.teamBlock}>
          <Text
            style={[
              styles.teamName,
              { color: colors.foreground, fontFamily: 'Inter_600SemiBold' },
            ]}
            numberOfLines={1}
          >
            {game.awayTeam}
          </Text>
          <Text
            style={[
              styles.score,
              { color: colors.foreground, fontFamily: 'Inter_700Bold' },
            ]}
          >
            {game.awayScore}
          </Text>
        </View>

        {/* Centre info */}
        <View style={styles.centre}>
          <Text
            style={[
              styles.sport,
              { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
            ]}
          >
            {game.sport}
          </Text>
          {isLive ? (
            <>
              <Text
                style={[
                  styles.quarter,
                  { color: colors.primary, fontFamily: 'Inter_600SemiBold' },
                ]}
              >
                {game.quarter}
              </Text>
              <Text
                style={[
                  styles.timeRemaining,
                  { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
                ]}
              >
                {game.timeRemaining}
              </Text>
            </>
          ) : (
            <Text
              style={[
                styles.statusLabel,
                { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
              ]}
            >
              {game.status.toUpperCase()}
            </Text>
          )}
        </View>

        {/* Home */}
        <View style={[styles.teamBlock, styles.homeBlock]}>
          <Text
            style={[
              styles.teamName,
              { color: colors.foreground, fontFamily: 'Inter_600SemiBold' },
            ]}
            numberOfLines={1}
          >
            {game.homeTeam}
          </Text>
          <Text
            style={[
              styles.score,
              { color: colors.foreground, fontFamily: 'Inter_700Bold' },
            ]}
          >
            {game.homeScore}
          </Text>
        </View>
      </View>

      {/* Footer: pace + signals toggle */}
      <View style={styles.footer}>
        <View style={[styles.paceBadge, { backgroundColor: paceColor + '22' }]}>
          <Text
            style={[
              styles.paceText,
              { color: paceColor, fontFamily: 'Inter_600SemiBold' },
            ]}
          >
            {game.pace.toUpperCase()} PACE
          </Text>
        </View>
        {isLive && (
          <TouchableOpacity
            style={styles.signalsToggle}
            onPress={() => setExpanded((v) => !v)}
          >
            <Text
              style={[
                styles.signalsToggleText,
                { color: colors.primary, fontFamily: 'Inter_600SemiBold' },
              ]}
            >
              SIGNALS
            </Text>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={13}
              color={colors.primary}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Expanded signals */}
      {expanded && isLive && <GameSignals gameId={game.id} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    padding: 14,
    gap: 12,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  teamBlock: {
    flex: 1,
    gap: 4,
  },
  homeBlock: {
    alignItems: 'flex-end',
  },
  teamName: {
    fontSize: 13,
  },
  score: {
    fontSize: 28,
  },
  centre: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 12,
  },
  sport: {
    fontSize: 9,
    letterSpacing: 1.5,
  },
  quarter: {
    fontSize: 12,
    letterSpacing: 0.5,
  },
  timeRemaining: {
    fontSize: 11,
  },
  statusLabel: {
    fontSize: 10,
    letterSpacing: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  paceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  paceText: {
    fontSize: 9,
    letterSpacing: 1.5,
  },
  signalsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  signalsToggleText: {
    fontSize: 11,
    letterSpacing: 1,
  },
  sigLoader: {
    paddingVertical: 8,
  },
  noSignals: {
    fontSize: 12,
    paddingVertical: 4,
  },
  signalsList: {
    gap: 8,
  },
});
