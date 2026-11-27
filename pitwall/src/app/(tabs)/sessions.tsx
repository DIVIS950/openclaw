import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLive } from '../../store/live';
import { deleteSession, listSessions, type SessionSummary } from '../../storage/sessions';
import { fmtDate, fmtLap } from '../../ui/format';
import { Screen } from '../../ui/kit';
import { C, label, num } from '../../ui/theme';

export default function SessionsScreen() {
  const [list, setList] = useState<SessionSummary[] | null>(null);
  const liveId = useLive((s) => (s.running ? s.sessionId : null));
  const lapCount = useLive((s) => s.laps.length);

  const refresh = useCallback(() => {
    listSessions().then(setList);
  }, []);
  // Reload when the tab is opened, and after every finished lap.
  useFocusEffect(refresh);
  useEffect(refresh, [refresh, lapCount]);

  const confirmDelete = (s: SessionSummary) => {
    if (s.id === liveId) return;
    Alert.alert('Delete session?', `${fmtDate(s.startedAt)} · ${s.lapCount} laps`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteSession(s.id).then(refresh) },
    ]);
  };

  return (
    <Screen title="SESSIONS">
      <FlatList
        data={list ?? []}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ gap: 10, paddingBottom: 24 }}
        ListEmptyComponent={
          list ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No sessions yet</Text>
              <Text style={styles.emptyText}>Press START SESSION on the LIVE tab. Every finished lap is saved here automatically.</Text>
            </View>
          ) : undefined
        }
        renderItem={({ item }) => {
          const live = item.id === liveId;
          return (
            <Pressable
              onPress={() => router.push(`/session/${item.id}`)}
              onLongPress={() => confirmDelete(item)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1, gap: 6 }}>
                <View style={styles.tags}>
                  <Text style={[styles.tag, live && { color: C.bg, backgroundColor: C.accent, borderColor: C.accent }]}>{live ? '● LIVE' : item.source === 'ble' ? 'ESP32' : 'SIM'}</Text>
                  <Text style={label}>{`${item.lapCount} ${item.lapCount === 1 ? 'LAP' : 'LAPS'}`}</Text>
                </View>
                <Text style={styles.date}>{fmtDate(item.startedAt)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={label}>BEST</Text>
                <Text style={[num, { fontSize: 22, color: C.purple }]}>{fmtLap(item.bestMs, 3)}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        }}
        ListFooterComponent={list?.length ? <Text style={styles.footer}>Long-press a session to delete it.</Text> : undefined}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel, borderRadius: 14, padding: 16, minHeight: 76 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tag: { color: C.text, fontSize: 10, fontWeight: '900', letterSpacing: 1.2, borderWidth: 1, borderColor: C.line, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  date: { color: C.text, fontSize: 16, fontWeight: '700' },
  chevron: { color: C.faint, fontSize: 28, fontWeight: '300', marginLeft: 2 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 30, gap: 8 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '800' },
  emptyText: { color: C.dim, textAlign: 'center', lineHeight: 20 },
  footer: { color: C.faint, fontSize: 12, textAlign: 'center', marginTop: 6 },
});
