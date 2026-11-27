import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { timeDelta } from '../lap/trace';
import { useSettings } from '../store/settings';
import { loadSession, type SavedLap, type SavedSession } from '../storage/sessions';
import { fmtDelta, fmtLap, fmtSec, speed, speedUnit, temp, tempUnit } from '../ui/format';
import { Panel } from '../ui/kit';
import { LineChart, type Series } from '../ui/LineChart';
import { TrackMap, type MapLine } from '../ui/TrackMap';
import { C, label, num } from '../ui/theme';

const A_COLOR = C.accent;
const B_COLOR = C.purple;
const TYRE_COLORS = { fl: C.accent, fr: C.purple, rl: C.yellow, rr: '#FF7AB6' };

function Chart({ title, legend, children }: { title: string; legend?: { color: string; text: string }[]; children: ReactNode }) {
  return (
    <Panel style={{ gap: 8 }}>
      <View style={styles.chartHead}>
        <Text style={label}>{title}</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {legend?.map((l) => (
            <View key={l.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={[styles.swatch, { backgroundColor: l.color }]} />
              <Text style={[label, { fontSize: 10 }]}>{l.text}</Text>
            </View>
          ))}
        </View>
      </View>
      {children}
    </Panel>
  );
}

export default function LapScreen() {
  const params = useLocalSearchParams<{ session: string; a: string; b?: string }>();
  const [session, setSession] = useState<SavedSession | null>(null);
  const units = useSettings((s) => s.units);
  const { width } = useWindowDimensions();
  const w = width - 32 - 28;

  useEffect(() => {
    loadSession(params.session).then(setSession);
  }, [params.session]);

  const a = session?.laps.find((l) => l.number === Number(params.a)) ?? null;
  const b = params.b ? (session?.laps.find((l) => l.number === Number(params.b)) ?? null) : null;

  const lines = useMemo<MapLine[]>(() => {
    if (!a) return [];
    if (!b) return [{ lat: a.trace.lat, lon: a.trace.lon, v: a.trace.v, width: 5 }];
    return [
      { lat: b.trace.lat, lon: b.trace.lon, color: B_COLOR, width: 4, opacity: 0.9 },
      { lat: a.trace.lat, lon: a.trace.lon, color: A_COLOR, width: 2.5 },
    ];
  }, [a, b]);

  const delta = useMemo(() => (a && b ? timeDelta(a.trace, b.trace) : null), [a, b]);

  if (!session || !a) return <View style={styles.screen} />;

  const sp = (l: SavedLap, color: string): Series => ({ x: l.trace.d, y: l.trace.v.map((v) => speed(v, units)), color });
  const tu = tempUnit(units);
  const tc = (xs: number[]) => xs.map((x) => temp(x, units));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: b ? `L${a.number} vs L${b.number}` : `LAP ${a.number}` }} />

      <Panel style={styles.times}>
        {[a, b].filter((l): l is SavedLap => !!l).map((l, i) => (
          <View key={l.number} style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {b && <View style={[styles.swatch, { backgroundColor: i === 0 ? A_COLOR : B_COLOR }]} />}
              <Text style={label}>{`LAP ${l.number}`}</Text>
            </View>
            <Text style={[num, { fontSize: 26 }]}>{fmtLap(l.timeMs, 3)}</Text>
            <Text style={[num, { fontSize: 12, color: C.dim }]}>{l.sectorsMs.map((s) => fmtSec(s)).join('  ')}</Text>
            <Text style={[num, { fontSize: 12, color: C.dim }]}>
              {`MAX ${Math.round(speed(l.maxKmh, units))} ${speedUnit(units)}`}
            </Text>
          </View>
        ))}
        {b && (
          <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
            <Text style={label}>GAP</Text>
            <Text style={[num, { fontSize: 22, color: b.timeMs < a.timeMs ? C.green : C.red }]}>{fmtDelta(b.timeMs - a.timeMs, 3)}</Text>
          </View>
        )}
      </Panel>

      <Panel style={{ padding: 0, alignItems: 'center' }}>
        <TrackMap width={width - 32} height={(width - 32) * 0.8} lines={lines} startFinish={session.startFinish} />
      </Panel>

      <Chart title={`SPEED · ${speedUnit(units).toUpperCase()}`} legend={b ? [{ color: A_COLOR, text: `L${a.number}` }, { color: B_COLOR, text: `L${b.number}` }] : undefined}>
        <LineChart width={w} height={150} series={b ? [sp(b, B_COLOR), sp(a, A_COLOR)] : [sp(a, A_COLOR)]} />
      </Chart>

      {delta && b && (
        <Chart title={`TIME GAP L${b.number} − L${a.number} · S`}>
          <LineChart width={w} height={110} series={[{ x: delta.d, y: delta.dt, color: C.yellow }]} zero={0} formatY={(v) => v.toFixed(1)} />
          <Text style={styles.note}>Above the line: L{b.number} is behind. Going up = losing time there.</Text>
        </Chart>
      )}

      {b ? (
        <Chart title={`HOTTEST FRONT TYRE · ${tu}`} legend={[{ color: A_COLOR, text: `L${a.number}` }, { color: B_COLOR, text: `L${b.number}` }]}>
          <LineChart
            width={w}
            height={130}
            series={[b, a].map((l, i) => ({ x: l.trace.d, y: tc(l.trace.tfl.map((x, k) => Math.max(x, l.trace.tfr[k]))), color: i === 0 ? B_COLOR : A_COLOR }))}
          />
        </Chart>
      ) : (
        <Chart title={`TYRES · ${tu}`} legend={(['fl', 'fr', 'rl', 'rr'] as const).map((k) => ({ color: TYRE_COLORS[k], text: k.toUpperCase() }))}>
          <LineChart
            width={w}
            height={130}
            series={[
              { x: a.trace.d, y: tc(a.trace.tfl), color: TYRE_COLORS.fl },
              { x: a.trace.d, y: tc(a.trace.tfr), color: TYRE_COLORS.fr },
              { x: a.trace.d, y: tc(a.trace.trl), color: TYRE_COLORS.rl },
              { x: a.trace.d, y: tc(a.trace.trr), color: TYRE_COLORS.rr },
            ]}
          />
        </Chart>
      )}

      <Chart
        title={`FRONT BRAKES · ${tu}`}
        legend={b ? [{ color: A_COLOR, text: `L${a.number}` }, { color: B_COLOR, text: `L${b.number}` }] : [{ color: TYRE_COLORS.fl, text: 'FL' }, { color: TYRE_COLORS.fr, text: 'FR' }]}
      >
        <LineChart
          width={w}
          height={130}
          series={
            b
              ? [b, a].map((l, i) => ({ x: l.trace.d, y: tc(l.trace.bfl), color: i === 0 ? B_COLOR : A_COLOR }))
              : [
                  { x: a.trace.d, y: tc(a.trace.bfl), color: TYRE_COLORS.fl },
                  { x: a.trace.d, y: tc(a.trace.bfr), color: TYRE_COLORS.fr },
                ]
          }
        />
      </Chart>

      {!b && (
        <Chart title={`ENGINE · ${tu}`} legend={[{ color: C.cold, text: 'COOLANT' }, { color: C.amber, text: 'OIL' }]}>
          <LineChart
            width={w}
            height={110}
            series={[
              { x: a.trace.d, y: tc(a.trace.coolant), color: C.cold },
              { x: a.trace.d, y: tc(a.trace.oil), color: C.amber },
            ]}
          />
        </Chart>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  times: { flexDirection: 'row', gap: 12 },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  note: { color: C.faint, fontSize: 11 },
});
