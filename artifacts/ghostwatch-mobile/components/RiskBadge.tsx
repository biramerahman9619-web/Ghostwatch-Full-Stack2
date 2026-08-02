import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

type RiskTier = 'Safe' | 'Balanced' | 'Aggressive';

interface RiskBadgeProps {
  tier: RiskTier;
  size?: 'sm' | 'md';
}

export function RiskBadge({ tier, size = 'md' }: RiskBadgeProps) {
  const colors = useColors();

  const tierMap: Record<RiskTier, { bg: string; text: string }> = {
    Safe: { bg: colors.safe + '25', text: colors.safe },
    Balanced: { bg: colors.balanced + '25', text: colors.balanced },
    Aggressive: { bg: colors.aggressive + '25', text: colors.aggressive },
  };
  const tc = tierMap[tier] ?? { bg: colors.muted, text: colors.mutedForeground };

  return (
    <View style={[styles.badge, { backgroundColor: tc.bg }, size === 'sm' && styles.badgeSm]}>
      <Text
        style={[
          styles.text,
          { color: tc.text, fontFamily: 'Inter_600SemiBold' },
          size === 'sm' && styles.textSm,
        ]}
      >
        {tier.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 3,
    alignSelf: 'flex-start',
  },
  badgeSm: {
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  text: {
    fontSize: 10,
    letterSpacing: 1.2,
  },
  textSm: {
    fontSize: 9,
  },
});
