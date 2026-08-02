import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Ionicons } from '@expo/vector-icons';

interface Alert {
  id: string;
  playerId: string;
  playerName: string;
  team: string;
  alertType: string;
  description: string;
  severity: 'Low' | 'Medium' | 'High';
  source?: string;
  createdAt: string;
}

const ALERT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  PartyRisk: 'wine',
  FatigueRisk: 'bed',
  MotivationBoost: 'flame',
  InjuryConcern: 'medkit',
  DramaAlert: 'chatbubbles',
  TravelFatigue: 'airplane',
};

function formatAlertType(type: string): string {
  return type.replace(/([A-Z])/g, ' $1').trim();
}

export function AlertCard({ alert }: { alert: Alert }) {
  const colors = useColors();

  const severityColor =
    alert.severity === 'High'
      ? colors.aggressive
      : alert.severity === 'Medium'
      ? colors.balanced
      : colors.safe;

  const iconName: keyof typeof Ionicons.glyphMap =
    ALERT_ICONS[alert.alertType] ?? 'alert-circle';

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {/* Icon */}
      <View
        style={[styles.iconWrap, { backgroundColor: severityColor + '22' }]}
      >
        <Ionicons name={iconName} size={20} color={severityColor} />
      </View>

      {/* Body */}
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text
            style={[
              styles.alertType,
              { color: colors.foreground, fontFamily: 'Inter_700Bold', flex: 1 },
            ]}
            numberOfLines={1}
          >
            {formatAlertType(alert.alertType)}
          </Text>
          <View
            style={[styles.severityBadge, { backgroundColor: severityColor + '22' }]}
          >
            <Text
              style={[
                styles.severityText,
                { color: severityColor, fontFamily: 'Inter_600SemiBold' },
              ]}
            >
              {alert.severity.toUpperCase()}
            </Text>
          </View>
        </View>

        <Text
          style={[
            styles.player,
            { color: colors.primary, fontFamily: 'Inter_500Medium' },
          ]}
        >
          {alert.playerName} · {alert.team}
        </Text>

        <Text
          style={[
            styles.description,
            { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
          ]}
          numberOfLines={3}
        >
          {alert.description}
        </Text>

        {alert.source && (
          <Text
            style={[
              styles.source,
              { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
            ]}
          >
            via {alert.source}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    gap: 12,
    alignItems: 'flex-start',
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alertType: {
    fontSize: 14,
  },
  severityBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 3,
  },
  severityText: {
    fontSize: 9,
    letterSpacing: 1.2,
  },
  player: {
    fontSize: 12,
  },
  description: {
    fontSize: 12,
    lineHeight: 18,
  },
  source: {
    fontSize: 10,
    fontStyle: 'italic',
  },
});
