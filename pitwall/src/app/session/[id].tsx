import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lapColor, sectorColor } from '../../lap/timingColors';
import { bestLap, idealLapMs } from '../../lap/trace';
import { useLive } from '../../store/live';
import { shareSessionCsv } from '../../storage/exportCsv';
import { loadSession, type SavedSession } from '../../storage/sessions';
import { fmtDate, fmtDelta, fmtLap, fmtSec } from '../../ui/format';
import { Button, Panel } from '../../ui/kit';
import { C, label, num } from '../../ui/theme';

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [session, setSession] = useState<SavedSession | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  // If this is the session being recorded, reload as laps come in.
  const liveLaps = useLive((s) => (s.sessionId === id ? s.laps.length : 0));

  useEffect(() => {
    loadSession(id).then(setSession);
  }, [id, liveLaps]);

  if (!session) return <View style={styles.screen} />;
  const laps = session.laps;
  const best = bestLap(laps);

  const toggle = (n: number) =>
    setSelected((sel) => (sel.includes(n) ? sel.filter((x) => x !== n) : [...sel, n].slice(-2)));

  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <FlatList
        data={laps}
        keyExtractor={(l) => String(l.number)}
        contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 110 }}
        ListHeaderComponent={
          <Panel style={styles.summary}>
            <Text style={styles.date}>{fmtDate(session.startedAt)}</Text>
            <View style={styles.summaryRow}>
              <View>
                <Text style={label}>BEST</Text>
                <Text style={[num, { fontSize: 28, color: C.purple }]}>{fmtLap(best?.timeMs, 3)}</Text>
              </View>
              <View>
                <Text style={label}>IDEAL</Text>
                <Text style={[num, { fontSize: 28 }]}>{fmtLap(idealLapMs(laps), 3)}</Text>
              </View>
              <View>
                <Text style={label}>LAPS</Text>
                <Text style={[num, { fontSize: 28 }]}>{laps.length}</Text>
              </View>
            </View>
            <Text style={styles.hint}>Tap a lap to see it. Tick two laps to compare them.</Text>
            {Platform.OS !== 'web' && laps.length > 0 && (
              <Button title="EXPORT CSV" kind="ghost" small onPress={() => shareSessionCsv(session).catch((e) => Alert.alert('Export failed', String(e)))} />
            )}
          </Panel>
        }
        renderItem={({ item, index }) => {
          const prev = laps[index - 1];
          const on = selected.includes(item.number);
          return (
            <Pressable
              onPress={() => router.push(`/lap?session=${session.id}&a=${item.number}`)}
              style={({ pressed }) => [styles.row, on && { borderColor: C.accent }, pressed && { opacity: 0.7 }]}
            >
              <Text style={[num, styles.lapNo]}>{item.number}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                  <Text style={[num, { fontSize: 22, color: lapColor(item.timeMs, laps) }]}>{fmtLap(item.timeMs, 3)}</Text>
                  {best && item !== best && <Text style={[num, { fontSize: 13, color: C.red }]}>{fmtDelta(item.timeMs - best.timeMs)}</Text>}
                </View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  {item.sectorsMs.map((s, i) => (
                    <Text key={i} style={[num, { fontSize: 13, color: sectorColor(s, i, laps, prev) }]}>
                      {fmtSec(s)}
                    </Text>
                  ))}
                </View>
              </View>
              <Pressable hitSlop={14} accessibilityRole="checkbox" accessibilityLabel={`Select lap ${item.number}`} accessibilityState={{ checked: on }} onPress={() => toggle(item.number)} style={[styles.check, on && { backgroundColor: C.accent, borderColor: C.accent }]}>
                {on && <Text style={styles.checkMark}>✓</Text>}
              </Pressable>
            </Pressable>
          );
        }}
      />
      {selected.length > 0 && (
        <View style={styles.bottom}>
          <Button
            title={selected.length === 2 ? `COMPARE L${selected[0]} vs L${selected[1]}` : 'PICK ONE MORE LAP'}
            disabled={selected.length < 2}
            onPress={() => router.push(`/lap?session=${session.id}&a=${selected[0]}&b=${selected[1]}`)}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  summary: { gap: 12, marginBottom: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  date: { color: C.text, fontSize: 17, fontWeight: '800' },
  hint: { color: C.faint, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.panel, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'transparent' },
  lapNo: { width: 30, fontSize: 18, color: C.dim, textAlign: 'center' },
  check: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: C.bg, fontWeight: '900', fontSize: 15 },
  bottom: { position: 'absolute', left: 16, right: 16, bottom: 34 },
});
