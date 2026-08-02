import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Ionicons } from '@expo/vector-icons';

type SignalType = 'PaceSpike' | 'UsageSpike' | 'MismatchDetected' | 'InjuryUpdate' | 'FoulTrouble';
type SignalStrength = 'Low' | 'Medium' | 'High';

interface Signal {
  id: string;
  gameId: string;
  type: SignalType;
  description: string;
  strength: SignalStrength;
  playerName: string;
  team: string;
}

interface SignalCardProps {
  signal: Signal;
}

const SIGNAL_ICONS: Record<SignalType, keyof typeof Ionicons.glyphMap> = {
  PaceSpike: 'flash',
  UsageSpike: 'trending-up',
  MismatchDetected: 'git-compare',
  InjuryUpdate: 'medkit',
  FoulTrouble: 'warning',
};

function formatSignalType(type: string): string {
  return type.replace(/([A-Z])/g, ' $1').trim();
}

export function SignalCard({ signal }: SignalCardProps) {
  const colors = useColors();
  const strengthColor =
    signal.strength === 'High'
      ? colors.aggressive
      : signal.strength === 'Medium'
      ? colors.balanced
      : colors.mutedForeground;
  const iconName = SIGNAL_ICONS[signal.type as SignalType] ?? 'radio-button-on';

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.secondary, borderColor: colors.border },
      ]}
    >
      <Ionicons name={iconName} size={16} color={strengthColor} style={styles.icon} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text
            style={[
              styles.signalType,
              { color: colors.foreground, fontFamily: 'Inter_600SemiBold' },
            ]}
          >
            {formatSignalType(signal.type)}
          </Text>
          <Text
            style={[
              styles.strength,
              { color: strengthColor, fontFamily: 'Inter_600SemiBold' },
            ]}
          >
            {signal.strength.toUpperCase()}
          </Text>
        </View>
        <Text
          style={[
            styles.player,
            { color: colors.primary, fontFamily: 'Inter_500Medium' },
          ]}
        >
          {signal.playerName} · {signal.team}
        </Text>
        <Text
          style={[
            styles.description,
            { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
          ]}
          numberOfLines={2}
        >
          {signal.description}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    gap: 10,
    alignItems: 'flex-start',
  },
  icon: {
    marginTop: 2,
  },
  body: {
    flex: 1,
    gap: 3,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  signalType: {
    fontSize: 12,
  },
  strength: {
    fontSize: 9,
    letterSpacing: 1,
  },
  player: {
    fontSize: 11,
  },
  description: {
    fontSize: 11,
    lineHeight: 16,
  },
});
