import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useLive } from '../store/live';
import { fmtDelta, fmtLap } from './format';
import { C, label, num } from './theme';

/**
 * Big lap-complete card that pops over any screen for 4 seconds:
 * purple = new session best, green = faster than the previous lap, red = slower.
 */
export function LapFlash() {
  const laps = useLive((s) => s.laps);
  const [shown, setShown] = useState<number | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const seen = useRef(laps.length);

  useEffect(() => {
    if (laps.length <= seen.current) {
      seen.current = laps.length;
      return;
    }
    seen.current = laps.length;
    setShown(laps.length - 1);
    opacity.setValue(0);
    const anim = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(3600),
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => finished && setShown(null));
    return () => anim.stop();
  }, [laps.length, opacity]);

  if (shown === null || !laps[shown]) return null;
  const lap = laps[shown];
  const earlier = laps.slice(0, shown);
  const prevBest = earlier.length ? Math.min(...earlier.map((l) => l.timeMs)) : null;
  const isBest = prevBest === null || lap.timeMs < prevBest;
  const vsBest = prevBest === null ? null : lap.timeMs - prevBest;
  const color = isBest ? C.purple : vsBest !== null && vsBest < 0 ? C.green : C.red;
  const title = prevBest === null ? 'FIRST LAP' : isBest ? 'NEW BEST LAP' : 'LAP COMPLETE';

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View style={[styles.card, { borderColor: color, opacity, transform: [{ scale: opacity.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }]}>
        <Text style={[label, { color, fontSize: 13 }]}>{`${title} · LAP ${lap.number}`}</Text>
        <Text style={[num, styles.time]} numberOfLines={1} adjustsFontSizeToFit>
          {fmtLap(lap.timeMs, 3)}
        </Text>
        {vsBest !== null && <Text style={[num, styles.delta, { color }]}>{fmtDelta(vsBest, 3)}</Text>}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 90 },
  card: { backgroundColor: 'rgba(7,8,10,0.94)', borderRadius: 22, borderWidth: 3, paddingVertical: 22, paddingHorizontal: 28, alignItems: 'center', gap: 4, minWidth: 280 },
  time: { fontSize: 64, letterSpacing: -2 },
  delta: { fontSize: 30 },
});
