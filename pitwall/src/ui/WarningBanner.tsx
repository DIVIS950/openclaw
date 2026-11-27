import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLive } from '../store/live';
import { useSettings } from '../store/settings';
import { fmtTemp, tempUnit } from './format';
import { C } from './theme';

/** Flashing red banner over every tab while any value is past its limit. */
export function WarningBanner() {
  const warnings = useLive((s) => s.warnings);
  const units = useSettings((s) => s.units);
  const insets = useSafeAreaInsets();
  const [pulse] = useState(() => new Animated.Value(1));
  const on = warnings.length > 0;

  useEffect(() => {
    if (!on) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0, duration: 420, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 420, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [on, pulse]);

  if (!on) return null;
  const text = warnings
    .map((w) => {
      if (w.key === 'test') return 'TEST ALARM — banner & vibration OK';
      if (w.key === 'battLow') return `${w.label} ${w.value.toFixed(1)} V`;
      return `${w.label} ${fmtTemp(w.value, units)}${tempUnit(units)}`;
    })
    .join('   ·   ');

  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 6 }]}>
      <View style={styles.banner}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.glow, { opacity: pulse }]} />
        <Text style={styles.icon}>!</Text>
        <Text style={styles.text} numberOfLines={2}>
          {text}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 10, right: 10, zIndex: 100 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#B3121B', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, overflow: 'hidden' },
  glow: { backgroundColor: C.red },
  icon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', color: C.red, textAlign: 'center', lineHeight: 28, fontWeight: '900', fontSize: 18, overflow: 'hidden' },
  text: { flex: 1, color: '#fff', fontWeight: '900', fontSize: 15, letterSpacing: 1 },
});
