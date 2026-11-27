import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLive } from '../../store/live';
import { useSettings } from '../../store/settings';
import { temp, tempUnit } from '../../ui/format';
import { CarDiagram } from '../../ui/CarDiagram';
import { Gauge } from '../../ui/Gauge';
import { Panel, Screen } from '../../ui/kit';
import { C, label, num } from '../../ui/theme';

const GAUGES = [
  { key: 'coolant', label: 'COOLANT', min: 40, max: 130 },
  { key: 'oil', label: 'OIL', min: 40, max: 150 },
  { key: 'egt', label: 'EGT', min: 200, max: 1100 },
] as const;

function Legend() {
  const items = [
    { c: C.cold, t: 'COLD' },
    { c: C.green, t: 'OPTIMAL' },
    { c: C.amber, t: 'HIGH' },
    { c: C.red, t: 'OVER LIMIT' },
  ];
  return (
    <View style={styles.legend}>
      {items.map((i) => (
        <View key={i.t} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: i.c }]} />
          <Text style={[label, { fontSize: 10 }]}>{i.t}</Text>
        </View>
      ))}
    </View>
  );
}

export default function TempsScreen() {
  const frame = useLive((s) => s.frame);
  const { units, limits, sensors } = useSettings();
  const { width } = useWindowDimensions();
  const inner = Math.min(width - 32, 480);
  const gauge = (inner - 16) / 3;
  const u = tempUnit(units);
  const batt = frame?.battV ?? NaN;

  return (
    <Screen title="TEMPS" scroll>
      <Panel style={{ alignItems: 'center', paddingTop: 18 }}>
        <CarDiagram
          width={inner - 28}
          frame={frame}
          units={units}
          tyreLimit={limits.tyre}
          brakeLimit={limits.brake}
          tyresOn={sensors.tyre}
          brakesOn={sensors.brake}
        />
        <Legend />
      </Panel>

      <Panel style={styles.gauges}>
        {GAUGES.map((g) => (
          <Gauge
            key={g.key}
            size={gauge}
            label={g.label}
            value={frame ? temp(frame[g.key], units) : NaN}
            min={temp(g.min, units)}
            max={temp(g.max, units)}
            limit={temp(limits[g.key], units)}
            unit={u}
            enabled={sensors[g.key]}
          />
        ))}
      </Panel>

      <Panel style={styles.battRow}>
        <Text style={label}>BATTERY</Text>
        <Text style={[num, { fontSize: 22, color: Number.isFinite(batt) && batt < limits.battLow ? C.red : C.text }]}>
          {Number.isFinite(batt) ? batt.toFixed(2) : '—'} <Text style={{ color: C.dim, fontSize: 13 }}>V</Text>
        </Text>
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gauges: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 12, paddingBottom: 4 },
  legend: { flexDirection: 'row', gap: 14, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  battRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
