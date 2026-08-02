import React, { useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import {
  useListPicks,
  useGetPicksSummary,
  useGetGhostwatchStatus,
} from '@workspace/api-client-react';
import { GhostHeader } from '@/components/GhostHeader';
import { PickCard } from '@/components/PickCard';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

type RiskFilter = 'All' | 'Safe' | 'Balanced' | 'Aggressive';

const FILTERS: RiskFilter[] = ['All', 'Safe', 'Balanced', 'Aggressive'];

export default function PicksScreen() {
  const colors = useColors();
  const [filter, setFilter] = useState<RiskFilter>('All');
  const [refreshing, setRefreshing] = useState(false);
  const isWeb = Platform.OS === 'web';

  const { data: picks, isLoading, refetch } = useListPicks(
    filter !== 'All' ? { riskTier: filter } : {},
  );
  const { data: summary } = useGetPicksSummary();
  const { data: status } = useGetGhostwatchStatus();

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleFilter = (f: RiskFilter) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFilter(f);
  };

  const tierColors: Record<RiskFilter, string> = {
    All: colors.primary,
    Safe: colors.safe,
    Balanced: colors.balanced,
    Aggressive: colors.aggressive,
  };

  const isReal = status?.usingRealData;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <GhostHeader
        title="GHOSTWATCH"
        subtitle="PICKS INTELLIGENCE"
        rightElement={
          <Text
            style={[
              styles.dataStatus,
              {
                color: isReal ? colors.safe : colors.mutedForeground,
                fontFamily: 'Inter_500Medium',
              },
            ]}
          >
            {isReal ? '● LIVE' : '◌ DEMO'}
          </Text>
        }
      />

      {/* Summary strip */}
      {summary && (
        <View
          style={[
            styles.summaryRow,
            { backgroundColor: colors.card, borderBottomColor: colors.border },
          ]}
        >
          {[
            { label: 'PICKS', value: String(summary.totalPicks), color: colors.foreground },
            { label: 'AVG CONF', value: `${summary.avgConfidence}%`, color: colors.primary },
            { label: 'SAFE', value: String(summary.byRiskTier?.Safe ?? 0), color: colors.safe },
            { label: 'BAL', value: String(summary.byRiskTier?.Balanced ?? 0), color: colors.balanced },
            { label: 'RISK', value: String(summary.byRiskTier?.Aggressive ?? 0), color: colors.aggressive },
          ].map((item, i, arr) => (
            <React.Fragment key={item.label}>
              <View style={styles.summaryCell}>
                <Text style={[styles.summaryValue, { color: item.color, fontFamily: 'Inter_700Bold' }]}>
                  {item.value}
                </Text>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  {item.label}
                </Text>
              </View>
              {i < arr.length - 1 && (
                <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
              )}
            </React.Fragment>
          ))}
        </View>
      )}

      {/* Filter tabs */}
      <View style={[styles.filterRow, { borderBottomColor: colors.border }]}>
        {FILTERS.map((f) => {
          const active = filter === f;
          const tc = tierColors[f];
          return (
            <TouchableOpacity
              key={f}
              onPress={() => handleFilter(f)}
              style={[
                styles.filterBtn,
                { borderBottomColor: active ? tc : 'transparent' },
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  {
                    color: active ? tc : colors.mutedForeground,
                    fontFamily: active ? 'Inter_600SemiBold' : 'Inter_400Regular',
                  },
                ]}
              >
                {f.toUpperCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isLoading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={picks ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <PickCard pick={item} />}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: isWeb ? 34 : 100 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          scrollEnabled={!!(picks && picks.length > 0)}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="analytics-outline" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                No picks found
              </Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Pull to refresh or change the filter
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
  dataStatus: { fontSize: 10, letterSpacing: 1 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  summaryCell: { flex: 1, alignItems: 'center', gap: 3 },
  summaryValue: { fontSize: 15 },
  summaryLabel: { fontSize: 7, letterSpacing: 1 },
  summaryDivider: { width: 1, height: 28 },
  filterRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: 4,
  },
  filterBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
  },
  filterText: { fontSize: 10, letterSpacing: 1 },
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
