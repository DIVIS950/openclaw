import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useLive } from '../../store/live';
import { LIMIT_RANGE, useSettings, type Limits, type TempChannel } from '../../store/settings';
import { temp, tempUnit } from '../../ui/format';
import { Button, Label, Panel, Screen, Segmented } from '../../ui/kit';
import { C, label, num } from '../../ui/theme';

const LIMIT_ROWS: { key: keyof Limits; name: string }[] = [
  { key: 'tyre', name: 'Tyres' },
  { key: 'brake', name: 'Brake discs' },
  { key: 'coolant', name: 'Coolant' },
  { key: 'oil', name: 'Oil' },
  { key: 'egt', name: 'Exhaust gas (EGT)' },
  { key: 'battLow', name: 'Battery low' },
];

const SENSOR_ROWS: { key: TempChannel; name: string }[] = [
  { key: 'tyre', name: 'Tyre IR sensors (4)' },
  { key: 'brake', name: 'Brake IR sensors (2)' },
  { key: 'coolant', name: 'Coolant' },
  { key: 'oil', name: 'Oil' },
  { key: 'egt', name: 'EGT thermocouple' },
];

function Readout({ title, value, warn }: { title: string; value: string; warn?: boolean }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={label}>{title}</Text>
      <Text style={[num, { fontSize: 24, color: warn ? C.red : C.text }]}>{value}</Text>
    </View>
  );
}

function StepButton({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.step, pressed && { backgroundColor: C.line }]}>
      <Text style={styles.stepText}>{text}</Text>
    </Pressable>
  );
}

export default function DeviceScreen() {
  const s = useSettings();
  const { running, status, statusMessage, frame, start, stop, testWarning } = useLive(
    useShallow((l) => ({
      running: l.running,
      status: l.status,
      statusMessage: l.statusMessage,
      frame: l.frame,
      start: l.start,
      stop: l.stop,
      testWarning: l.testWarning,
    })),
  );
  const u = tempUnit(s.units);
  const statusText =
    status === 'connected' ? 'Connected · receiving data' : status === 'connecting' ? (statusMessage ?? 'Connecting…') : status === 'error' ? (statusMessage ?? 'Error') : 'Not connected';

  const showLimit = (key: keyof Limits) => (key === 'battLow' ? `${s.limits.battLow.toFixed(1)} V` : `${Math.round(temp(s.limits[key], s.units))}${u}`);

  return (
    <Screen title="DEVICE" scroll>
      <Panel style={{ gap: 14 }}>
        <Label>DATA SOURCE</Label>
        <Segmented
          value={s.source}
          options={[
            { value: 'simulator', label: 'SIMULATOR' },
            { value: 'ble', label: 'ESP32 · BLE' },
          ]}
          onChange={(v) => !running && s.set({ source: v })}
        />
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: status === 'connected' ? C.green : status === 'error' ? C.red : status === 'connecting' ? C.yellow : C.faint }]} />
          <Text style={[styles.statusText, status === 'error' && { color: C.red }]}>{statusText}</Text>
        </View>
        {running && <Text style={styles.small}>Stop the session to switch source.</Text>}
        <View style={styles.readouts}>
          <Readout title="GPS RATE" value={frame ? `${frame.gpsHz} Hz` : '—'} />
          <Readout title="SATELLITES" value={frame ? String(frame.sats) : '—'} warn={!!frame && frame.sats < 6} />
          <Readout title="BATTERY" value={frame ? `${frame.battV.toFixed(2)} V` : '—'} warn={!!frame && frame.battV < s.limits.battLow} />
        </View>
        <Button title={running ? 'DISCONNECT' : 'CONNECT & START'} kind={running ? 'danger' : 'primary'} small onPress={running ? stop : start} />
      </Panel>

      <Panel style={{ gap: 4 }}>
        <Label style={{ marginBottom: 6 }}>WARNING LIMITS</Label>
        {LIMIT_ROWS.map(({ key, name }) => (
          <View key={key} style={styles.limitRow}>
            <Text style={styles.rowName}>{name}</Text>
            <StepButton text="−" onPress={() => s.setLimit(key, s.limits[key] - LIMIT_RANGE[key].step * (key === 'battLow' ? 1 : 5))} />
            <Text style={[num, styles.limitValue]}>{showLimit(key)}</Text>
            <StepButton text="+" onPress={() => s.setLimit(key, s.limits[key] + LIMIT_RANGE[key].step * (key === 'battLow' ? 1 : 5))} />
          </View>
        ))}
        <Button title="TEST ALARM" kind="ghost" small style={{ marginTop: 10 }} onPress={testWarning} />
      </Panel>

      <Panel style={{ gap: 4 }}>
        <Label style={{ marginBottom: 6 }}>SENSORS</Label>
        {SENSOR_ROWS.map(({ key, name }) => (
          <View key={key} style={styles.switchRow}>
            <Text style={styles.rowName}>{name}</Text>
            <Switch value={s.sensors[key]} onValueChange={() => s.toggleSensor(key)} trackColor={{ true: C.accent, false: C.line }} thumbColor="#fff" />
          </View>
        ))}
      </Panel>

      <Panel style={{ gap: 14 }}>
        <Label>UNITS</Label>
        <Segmented
          value={s.units}
          options={[
            { value: 'metric', label: 'KM/H · °C' },
            { value: 'imperial', label: 'MPH · °F' },
          ]}
          onChange={(v) => s.set({ units: v })}
        />
        <View style={styles.switchRow}>
          <Text style={styles.rowName}>Vibrate on warnings</Text>
          <Switch value={s.haptics} onValueChange={(v) => s.set({ haptics: v })} trackColor={{ true: C.accent, false: C.line }} thumbColor="#fff" />
        </View>
      </Panel>

      <Panel style={{ gap: 10 }}>
        <Label>START / FINISH</Label>
        <Text style={styles.small}>
          {s.startFinish
            ? `Saved at ${s.startFinish.a.lat.toFixed(5)}, ${s.startFinish.a.lon.toFixed(5)}. Move it from the TRACK tab while driving.`
            : 'Not set. It is placed automatically where your next session starts.'}
        </Text>
        <Button title="CLEAR START / FINISH" kind="ghost" small disabled={!s.startFinish || running} onPress={() => s.set({ startFinish: null })} />
        <Button title="RESET ALL SETTINGS" kind="ghost" small onPress={s.resetDefaults} />
      </Panel>

      <Text style={styles.footer}>PITWALL Telemetry 0.1 · Škoda Fabia race car{'\n'}ESP32 over Bluetooth needs a development build.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { color: C.text, fontWeight: '700', flex: 1 },
  small: { color: C.dim, fontSize: 12, lineHeight: 17 },
  readouts: { flexDirection: 'row', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingTop: 12 },
  limitRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 },
  rowName: { color: C.text, fontSize: 15, fontWeight: '600', flex: 1 },
  limitValue: { fontSize: 18, width: 76, textAlign: 'center' },
  step: { width: 44, height: 44, borderRadius: 11, backgroundColor: C.panel2, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: C.text, fontSize: 24, fontWeight: '500', marginTop: -2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  footer: { color: C.faint, fontSize: 11, textAlign: 'center', lineHeight: 17, marginTop: 4 },
});
