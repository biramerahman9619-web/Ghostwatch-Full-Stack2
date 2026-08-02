import React, { useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  ScrollView,
  Text,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useListAlerts, useListTeamPulse } from '@workspace/api-client-react';
import { GhostHeader } from '@/components/GhostHeader';
import { AlertCard } from '@/components/AlertCard';
import { Ionicons } from '@expo/vector-icons';

function TeamPulseStrip() {
  const colors = useColors();
  const { data: teams } = useListTeamPulse();

  if (!teams || teams.length === 0) return null;

  const dramaColor: Record<string, string> = {
    Low: colors.safe,
    Medium: colors.balanced,
    High: colors.aggressive,
  };

  return (
    <View style={[styles.pulseSection, { borderBottomColor: colors.border }]}>
      <Text
        style={[
          styles.pulseSectionLabel,
          { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
        ]}
      >
        TEAM PULSE
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pulseScroll}
      >
        {teams.map((team) => {
          const dc = dramaColor[team.dramaLevel] ?? colors.mutedForeground;
          return (
            <View
              key={team.teamId}
              style={[
                styles.pulseCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text
                style={[
                  styles.pulseTeam,
                  { color: colors.foreground, fontFamily: 'Inter_600SemiBold' },
                ]}
                numberOfLines={1}
              >
                {team.teamName}
              </Text>
              <View style={styles.pulseRow}>
                <View style={[styles.pulseDot, { backgroundColor: dc }]} />
                <Text
                  style={[
                    styles.pulseDrama,
                    { color: dc, fontFamily: 'Inter_500Medium' },
                  ]}
                >
                  {team.dramaLevel} Drama
                </Text>
              </View>
              <Text
                style={[
                  styles.pulseChem,
                  { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
                ]}
              >
                Chem {Math.round(team.chemistryScore * 100)}%
              </Text>
              {team.travelFatigue !== 'None' && (
                <Text
                  style={[
                    styles.pulseFatigue,
                    { color: colors.balanced, fontFamily: 'Inter_400Regular' },
                  ]}
                >
                  {team.travelFatigue} Fatigue
                </Text>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function AlertsScreen() {
  const colors = useColors();
  const [refreshing, setRefreshing] = useState(false);
  const isWeb = Platform.OS === 'web';

  const { data: alerts, isLoading, refetch } = useListAlerts({});

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <GhostHeader title="GHOST OBS" subtitle="SOCIAL & NEWS INTELLIGENCE" />

      <TeamPulseStrip />

      {/* Active alerts count */}
      {!isLoading && alerts && (
        <View style={[styles.countBar, { borderBottomColor: colors.border }]}>
          <Ionicons name="alert-circle-outline" size={12} color={colors.mutedForeground} />
          <Text
            style={[
              styles.countText,
              { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
            ]}
          >
            {alerts.length} ACTIVE ALERT{alerts.length !== 1 ? 'S' : ''}
          </Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={alerts ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <AlertCard alert={item} />}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 : 100 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          scrollEnabled={!!(alerts && alerts.length > 0)}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="eye-off-outline" size={48} color={colors.mutedForeground} />
              <Text
                style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}
              >
                No active alerts
              </Text>
              <Text
                style={[styles.emptySub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}
              >
                Ghost Observation monitors players for off-field risk signals
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pulseSection: {
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  pulseSectionLabel: {
    fontSize: 9,
    letterSpacing: 2,
    paddingHorizontal: 16,
  },
  pulseScroll: {
    paddingHorizontal: 12,
    gap: 8,
  },
  pulseCard: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 120,
    gap: 4,
  },
  pulseTeam: { fontSize: 12 },
  pulseRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pulseDot: { width: 6, height: 6, borderRadius: 3 },
  pulseDrama: { fontSize: 10 },
  pulseChem: { fontSize: 10 },
  pulseFatigue: { fontSize: 10 },
  countBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  countText: { fontSize: 10, letterSpacing: 1.5 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 12 },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: { fontSize: 18 },
  emptySub: { fontSize: 14, textAlign: 'center' },
});
