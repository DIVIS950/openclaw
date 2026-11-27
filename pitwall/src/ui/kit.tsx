import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useLive } from '../store/live';
import { C, label } from './theme';

/** Screen frame: safe area, dark background, PITWALL header. */
export function Screen({ title, children, scroll, right }: { title: string; children: ReactNode; scroll?: boolean; right?: ReactNode }) {
  const body = scroll ? (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={styles.body}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.brand}>
          PITWALL<Text style={{ color: C.accent }}> /</Text> <Text style={styles.title}>{title}</Text>
        </Text>
        {right ?? <StatusPill />}
      </View>
      {body}
    </SafeAreaView>
  );
}

export function StatusPill() {
  const { running, status, sourceKind } = useLive(useShallow((s) => ({ running: s.running, status: s.status, sourceKind: s.sourceKind })));
  const dot = status === 'connected' ? C.green : status === 'connecting' ? C.yellow : status === 'error' ? C.red : C.faint;
  const text = status === 'error' ? 'ERROR' : running && status === 'connected' ? 'LIVE' : status === 'connecting' ? 'LINKING' : 'IDLE';
  return (
    <View style={styles.pill}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={styles.pillText}>
        {sourceKind === 'ble' ? 'ESP32' : 'SIM'} · {text}
      </Text>
    </View>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function Label({ children, style, color }: { children: ReactNode; style?: StyleProp<ViewStyle>; color?: string }) {
  return (
    <View style={style}>
      <Text style={[label, color ? { color } : null]}>{children}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  small,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'danger' | 'ghost';
  small?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = kind === 'primary' ? C.accent : kind === 'danger' ? C.red : 'transparent';
  const fg = kind === 'ghost' ? C.text : '#04110F';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, opacity: disabled ? 0.35 : pressed ? 0.75 : 1 },
        kind === 'ghost' && styles.ghost,
        style,
      ]}
    >
      <Text style={[styles.buttonText, small && { fontSize: 13 }, { color: kind === 'danger' ? '#fff' : fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.segment, on && styles.segmentOn]}>
            <Text style={[styles.segmentText, on && { color: C.bg }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  body: { flex: 1, paddingHorizontal: 16 },
  scroll: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  brand: { color: C.text, fontSize: 15, fontWeight: '900', letterSpacing: 2.5 },
  title: { color: C.dim, fontWeight: '700' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.line, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { color: C.text, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  panel: { backgroundColor: C.panel, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, padding: 14 },
  button: { height: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonSmall: { height: 44, borderRadius: 11 },
  ghost: { borderWidth: 1, borderColor: C.line },
  buttonText: { fontSize: 16, fontWeight: '900', letterSpacing: 1.8 },
  segmented: { flexDirection: 'row', backgroundColor: C.panel2, borderRadius: 11, padding: 3 },
  segment: { flex: 1, height: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: C.text },
  segmentText: { color: C.dim, fontWeight: '800', fontSize: 13, letterSpacing: 1 },
});
