import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { deltaColor, lapColor, sectorColor } from '../../lap/timingColors';
import { useLive } from '../../store/live';
import { useSettings } from '../../store/settings';
import { fmtDelta, fmtLap, fmtSec, speed, speedUnit } from '../../ui/format';
import { Button, Label, Panel, Screen } from '../../ui/kit';
import { C, label, num } from '../../ui/theme';

/** ±2 s fills the delta bar. */
const BAR_RANGE_MS = 2000;

function DeltaBar({ deltaMs }: { deltaMs: number | null }) {
  const f = deltaMs === null ? 0 : Math.max(-1, Math.min(1, deltaMs / BAR_RANGE_MS));
  return (
    <View style={styles.bar}>
      <View style={styles.barMid} />
      {f !== 0 && (
        <View
          style={[
            styles.barFill,
            { backgroundColor: f < 0 ? C.green : C.red, width: `${Math.abs(f) * 50}%` },
            f < 0 ? { right: '50%' } : { left: '50%' },
          ]}
        />
      )}
    </View>
  );
}

function Stat({ title, value, unit, color, big }: { title: string; value: string; unit?: string; color?: string; big?: boolean }) {
  return (
    <View style={[styles.stat, big && { flex: 0.9 }]}>
      <Text style={label}>{title}</Text>
      <Text style={[num, { fontSize: big ? 40 : 21, color: color ?? C.text, marginTop: 2 }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
        {unit ? <Text style={styles.unit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

export default function LiveScreen() {
  const { running, timer, frame, laps, start, stop, status, statusMessage } = useLive(
    useShallow((s) => ({
      running: s.running,
      timer: s.timer,
      frame: s.frame,
      laps: s.laps,
      start: s.start,
      stop: s.stop,
      status: s.status,
      statusMessage: s.statusMessage,
    })),
  );
  const units = useSettings((s) => s.units);
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  const prev = laps[laps.length - 1];
  const delta = timer.deltaMs;
  const lapLabel = !running && !laps.length ? 'READY' : timer.lapNumber === 0 ? 'OUT LAP' : `LAP ${timer.lapNumber}`;

  const deltaBlock = (
    <Panel style={[styles.deltaPanel, landscape && { flex: 1 }]}>
      <View style={styles.rowBetween}>
        <Text style={label}>DELTA · BEST</Text>
        <Text style={[label, { color: C.text }]}>{lapLabel}</Text>
      </View>
      <Text style={[num, styles.delta, { color: delta === null ? C.faint : deltaColor(delta) }, landscape && { fontSize: 120 }]} numberOfLines={1} adjustsFontSizeToFit>
        {fmtDelta(delta)}
      </Text>
      <DeltaBar deltaMs={delta} />
      <Text style={[num, styles.lapTime, !running && { color: C.faint }]} numberOfLines={1} adjustsFontSizeToFit>
        {fmtLap(running ? timer.currentMs : 0, 1)}
      </Text>
    </Panel>
  );

  const side = (
    <View style={[{ gap: 10 }, landscape && { flex: 1 }]}>
      <Panel style={styles.statsRow}>
        <Stat title="SPEED" value={frame ? String(Math.round(speed(frame.speedKmh, units))) : '—'} unit={speedUnit(units)} big />
        <View style={styles.vline} />
        <Stat title="LAST" value={fmtLap(timer.lastMs, 2)} color={lapColor(timer.lastMs, laps)} />
        <View style={styles.vline} />
        <Stat title="BEST" value={fmtLap(timer.bestMs, 2)} color={timer.bestMs !== null ? C.purple : C.text} />
      </Panel>
      <View style={styles.sectors}>
        {[0, 1, 2].map((i) => {
          // Show the lap in progress; fall back to the last lap's sectors on the first sector.
          const live = timer.currentSectors[i];
          const showPrev = live === null && prev && timer.currentSectors.every((s) => s === null);
          const ms = live ?? (showPrev ? prev.sectorsMs[i] : null);
          const color = ms === null ? C.faint : sectorColor(ms, i, laps, showPrev ? laps[laps.length - 2] : prev);
          return (
            <View key={i} style={[styles.sector, { borderTopColor: color }]}>
              <Text style={label}>{`S${i + 1}`}</Text>
              <Text style={[num, { fontSize: 22, color: ms === null ? C.faint : C.text }]}>{fmtSec(ms)}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.rowBetween}>
        <Label>{`LAPS ${laps.length}`}</Label>
        {status === 'error' && !running ? <Label color={C.red}>{statusMessage ?? 'Connection error'}</Label> : null}
      </View>
      <Button title={running ? 'STOP SESSION' : 'START SESSION'} kind={running ? 'danger' : 'primary'} onPress={running ? stop : start} />
    </View>
  );

  return (
    <Screen title="LIVE">
      <View style={[styles.wrap, landscape && { flexDirection: 'row' }]}>
        {deltaBlock}
        {side}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: 10, paddingBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deltaPanel: { flex: 1, justifyContent: 'space-between', paddingVertical: 16 },
  delta: { fontSize: 110, letterSpacing: -4, textAlign: 'center', marginTop: 4 },
  lapTime: { fontSize: 64, letterSpacing: -2, textAlign: 'center', fontWeight: '600' },
  bar: { height: 10, backgroundColor: C.panel2, borderRadius: 5, overflow: 'hidden', marginVertical: 6 },
  barMid: { position: 'absolute', left: '50%', width: 2, marginLeft: -1, top: 0, bottom: 0, backgroundColor: C.dim },
  barFill: { position: 'absolute', top: 0, bottom: 0 },
  statsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  stat: { flex: 1.1, paddingHorizontal: 8 },
  vline: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: C.line },
  unit: { fontSize: 13, color: C.dim, fontWeight: '700' },
  sectors: { flexDirection: 'row', gap: 8 },
  sector: { flex: 1, backgroundColor: C.panel, borderRadius: 12, borderTopWidth: 3, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
});
