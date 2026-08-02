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
import { useListTickets } from '@workspace/api-client-react';
import { GhostHeader } from '@/components/GhostHeader';
import { TicketCard } from '@/components/TicketCard';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

type RiskFilter = 'All' | 'Safe' | 'Balanced' | 'Aggressive';
const FILTERS: RiskFilter[] = ['All', 'Safe', 'Balanced', 'Aggressive'];

export default function TicketsScreen() {
  const colors = useColors();
  const [filter, setFilter] = useState<RiskFilter>('All');
  const [refreshing, setRefreshing] = useState(false);
  const isWeb = Platform.OS === 'web';

  const { data: tickets, isLoading, refetch } = useListTickets(
    filter !== 'All' ? { riskTier: filter } : {},
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const tierColors: Record<RiskFilter, string> = {
    All: colors.primary,
    Safe: colors.safe,
    Balanced: colors.balanced,
    Aggressive: colors.aggressive,
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <GhostHeader title="GHOSTSPERE" subtitle="AUTO-BUILT BETTING TICKETS" />

      {/* Risk filter */}
      <View style={[styles.filterRow, { borderBottomColor: colors.border }]}>
        {FILTERS.map((f) => {
          const active = filter === f;
          const tc = tierColors[f];
          return (
            <TouchableOpacity
              key={f}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setFilter(f);
              }}
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

      {/* Count label */}
      {!isLoading && tickets && (
        <View style={[styles.countBar, { borderBottomColor: colors.border }]}>
          <Text
            style={[
              styles.countText,
              { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
            ]}
          >
            {tickets.length} TICKET{tickets.length !== 1 ? 'S' : ''} GENERATED
          </Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={tickets ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TicketCard ticket={item} />}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 : 100 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          scrollEnabled={!!(tickets && tickets.length > 0)}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="albums-outline" size={48} color={colors.mutedForeground} />
              <Text
                style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}
              >
                No tickets yet
              </Text>
              <Text
                style={[styles.emptySub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}
              >
                Ghostspere builds tickets from active picks
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
  countBar: {
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
