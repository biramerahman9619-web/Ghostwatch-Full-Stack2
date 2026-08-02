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
import { useListLiveGames, useListLivePicks } from '@workspace/api-client-react';
import { GhostHeader } from '@/components/GhostHeader';
import { LiveGameCard } from '@/components/LiveGameCard';
import { PickCard } from '@/components/PickCard';
import { Ionicons } from '@expo/vector-icons';

type TabView = 'games' | 'picks';

const TABS: { key: TabView; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'games', label: 'LIVE GAMES', icon: 'tv-outline' },
  { key: 'picks', label: 'LIVE PICKS', icon: 'flash-outline' },
];

export default function LiveScreen() {
  const colors = useColors();
  const [activeTab, setActiveTab] = useState<TabView>('games');
  const [refreshing, setRefreshing] = useState(false);
  const isWeb = Platform.OS === 'web';

  const { data: liveGames, isLoading: gamesLoading, refetch: refetchGames } =
    useListLiveGames();
  const { data: livePicks, isLoading: picksLoading, refetch: refetchPicks } =
    useListLivePicks({});

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchGames(), refetchPicks()]);
    setRefreshing(false);
  };

  const isLoading = activeTab === 'games' ? gamesLoading : picksLoading;
  const hasLive = !!(liveGames && liveGames.length > 0);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <GhostHeader
        title="GHOST EXPRESS"
        subtitle="LIVE IN-GAME INTELLIGENCE"
        isLive={hasLive}
      />

      {/* Sub-tab bar */}
      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={[
                styles.tabBtn,
                { borderBottomColor: active ? colors.primary : 'transparent' },
              ]}
            >
              <Ionicons
                name={tab.icon}
                size={14}
                color={active ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.tabText,
                  {
                    color: active ? colors.primary : colors.mutedForeground,
                    fontFamily: active ? 'Inter_600SemiBold' : 'Inter_400Regular',
                  },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isLoading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : activeTab === 'games' ? (
        <FlatList
          data={liveGames ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <LiveGameCard game={item} />}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 : 100 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          scrollEnabled={!!(liveGames && liveGames.length > 0)}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="radio-outline" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                No live games
              </Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                Live signals appear when games are in progress
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={livePicks ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <PickCard pick={item} />}
          contentContainerStyle={[styles.list, { paddingBottom: isWeb ? 34 : 100 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          scrollEnabled={!!(livePicks && livePicks.length > 0)}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="flash-outline" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                No live picks
              </Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                In-game picks appear when games are live
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
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
  },
  tabText: { fontSize: 10, letterSpacing: 1 },
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
