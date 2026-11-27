import { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { lapColor, sectorColor } from '../../lap/timingColors';
import { bestLap, idealLapMs, pointAtDistance } from '../../lap/trace';
import { useLive } from '../../store/live';
import { useSettings } from '../../store/settings';
import { fmtLap, fmtSec, speed, speedUnit } from '../../ui/format';
import { Button, Label, Panel, Screen } from '../../ui/kit';
import { TrackMap, type MapLine } from '../../ui/TrackMap';
import { C, SPEED_STOPS, label, num, ramp } from '../../ui/theme';

export default function TrackScreen() {
  const { running, laps, trail, frame, line, timer, setStartFinishHere } = useLive(
    useShallow((s) => ({
      running: s.running,
      laps: s.laps,
      trail: s.trail,
      frame: s.frame,
      line: s.line,
      timer: s.timer,
      setStartFinishHere: s.setStartFinishHere,
    })),
  );
  const units = useSettings((s) => s.units);
  const { width, height } = useWindowDimensions();
  const mapW = width - 32;
  const mapH = Math.min(mapW * 0.85, height * 0.42);

  const best = bestLap(laps);
  // The best lap is the racing line, coloured by speed. Recomputed once per lap.
  const lines = useMemo<MapLine[]>(() => (best ? [{ lat: best.trace.lat, lon: best.trace.lon, v: best.trace.v, width: 5 }] : []), [best]);
  const splits = useMemo(() => {
    if (!best || !timer.sectorSplitsM) return [];
    return timer.sectorSplitsM.map((d) => pointAtDistance(best.trace, d)).filter((p): p is { lat: number; lon: number } => !!p);
  }, [best, timer.sectorSplitsM]);

  const last = laps[laps.length - 1];
  const vMin = best ? Math.min(...best.trace.v) : 0;
  const vMax = best ? Math.max(...best.trace.v) : 0;
  const rows: { name: string; sectors: (number | null)[]; total: number | null; prev?: (typeof laps)[number] }[] = [
    { name: 'NOW', sectors: timer.currentSectors, total: null, prev: last },
    { name: 'LAST', sectors: last ? last.sectorsMs : [null, null, null], total: last?.timeMs ?? null, prev: laps[laps.length - 2] },
    { name: 'BEST', sectors: best ? best.sectorsMs : [null, null, null], total: best?.timeMs ?? null },
  ];

  return (
    <Screen title="TRACK" scroll>
      <Panel style={{ padding: 0, overflow: 'hidden' }}>
        <TrackMap width={mapW} height={mapH} lines={lines} trail={trail} car={frame} startFinish={line} splits={splits} />
        {best && (
          <View style={styles.legend}>
            <Text style={styles.legendText}>{Math.round(speed(vMin, units))}</Text>
            <View style={styles.legendBar}>
              {SPEED_STOPS.map((_, i) => (
                <View key={i} style={{ flex: 1, backgroundColor: ramp(SPEED_STOPS, i / (SPEED_STOPS.length - 1)) }} />
              ))}
            </View>
            <Text style={styles.legendText}>
              {Math.round(speed(vMax, units))} {speedUnit(units)}
            </Text>
          </View>
        )}
      </Panel>

      <Button title="SET START / FINISH HERE" kind="ghost" onPress={setStartFinishHere} disabled={!running || !frame} />
      <Text style={styles.hint}>
        {running
          ? line
            ? 'Line is saved for next time. Moving it starts a new lap and resets the delta.'
            : 'The line is placed where the session starts. Tap to move it to the car.'
          : 'Start a session on LIVE to see the car on the map.'}
      </Text>

      <Panel style={{ gap: 10 }}>
        <View style={styles.tableRow}>
          <Text style={[label, styles.nameCol]} />
          {['S1', 'S2', 'S3'].map((s) => (
            <Text key={s} style={[label, styles.cell]}>
              {s}
            </Text>
          ))}
          <Text style={[label, styles.totalCol]}>LAP</Text>
        </View>
        {rows.map((r) => (
          <View key={r.name} style={styles.tableRow}>
            <Text style={[label, styles.nameCol, { color: C.text }]}>{r.name}</Text>
            {r.sectors.map((ms, i) => (
              <Text key={i} style={[num, styles.cell, { color: ms === null ? C.faint : r.name === 'BEST' ? C.text : sectorColor(ms, i, laps, r.prev) }]}>
                {fmtSec(ms)}
              </Text>
            ))}
            <Text style={[num, styles.totalCol, { color: r.total === null ? C.faint : lapColor(r.total, laps) }]}>{r.total === null ? '—' : fmtLap(r.total, 2)}</Text>
          </View>
        ))}
        <View style={[styles.tableRow, styles.ideal]}>
          <Label style={styles.nameCol}>IDEAL</Label>
          <Text style={[label, { flex: 3 }]}>BEST S1 + S2 + S3</Text>
          <Text style={[num, styles.totalCol, { color: C.purple }]}>{fmtLap(idealLapMs(laps), 2)}</Text>
        </View>
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 12 },
  legendBar: { flex: 1, height: 5, borderRadius: 3, flexDirection: 'row', overflow: 'hidden' },
  legendText: { color: C.dim, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hint: { color: C.faint, fontSize: 12, textAlign: 'center', marginTop: -4 },
  tableRow: { flexDirection: 'row', alignItems: 'center' },
  nameCol: { width: 52 },
  cell: { flex: 1, fontSize: 16, textAlign: 'right' },
  totalCol: { flex: 1.4, fontSize: 16, textAlign: 'right' },
  ideal: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingTop: 10 },
});
