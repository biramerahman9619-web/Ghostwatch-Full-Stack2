import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

interface GhostHeaderProps {
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
  isLive?: boolean;
}

export function GhostHeader({ title, subtitle, rightElement, isLive }: GhostHeaderProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
          paddingTop: isWeb ? 67 : insets.top + 10,
        },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.titleBlock}>
          <Text
            style={[styles.title, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}
          >
            {title}
          </Text>
          {subtitle && (
            <Text
              style={[
                styles.subtitle,
                { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
              ]}
            >
              {subtitle}
            </Text>
          )}
        </View>
        <View style={styles.right}>
          {isLive && (
            <View style={[styles.liveBadge, { backgroundColor: colors.aggressive + '22' }]}>
              <View style={[styles.liveDot, { backgroundColor: colors.aggressive }]} />
              <Text
                style={[
                  styles.liveText,
                  { color: colors.aggressive, fontFamily: 'Inter_600SemiBold' },
                ]}
              >
                LIVE
              </Text>
            </View>
          )}
          {rightElement}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 18,
    letterSpacing: 3,
  },
  subtitle: {
    fontSize: 10,
    letterSpacing: 1.5,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveText: {
    fontSize: 10,
    letterSpacing: 1.5,
  },
});
