import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface ConfidenceBarProps {
  value: number; // 0–100
  showLabel?: boolean;
}

export function ConfidenceBar({ value, showLabel = true }: ConfidenceBarProps) {
  const colors = useColors();
  const barColor =
    value >= 80 ? colors.safe : value >= 60 ? colors.balanced : colors.aggressive;

  return (
    <View style={styles.container}>
      {showLabel && (
        <Text style={[styles.label, { color: barColor, fontFamily: 'Inter_600SemiBold' }]}>
          {Math.round(value)}%
        </Text>
      )}
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.fill,
            { width: `${Math.min(100, Math.max(0, value))}%` as any, backgroundColor: barColor },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 12,
    width: 34,
    textAlign: 'right',
  },
  track: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
});
