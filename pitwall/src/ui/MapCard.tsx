import type React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettings } from '../store/settings';
import { SatelliteMap } from './SatelliteMap';
import { C } from './theme';
import { TrackMap, type TrackMapProps } from './TrackMap';

/** Map in a card, with a SATELLITE / LINE switch (satellite needs Apple Maps, so not on web). */
export function MapCard(props: TrackMapProps & { footer?: React.ReactNode }) {
  const mapStyle = useSettings((s) => s.mapStyle);
  const set = useSettings((s) => s.set);
  const canSatellite = Platform.OS !== 'web';
  const satellite = canSatellite && mapStyle === 'satellite';
  return (
    <View style={styles.card}>
      {satellite ? <SatelliteMap {...props} /> : <TrackMap {...props} />}
      {canSatellite && (
        <View style={styles.switch}>
          {(['satellite', 'line'] as const).map((m) => (
            <Pressable key={m} onPress={() => set({ mapStyle: m })} hitSlop={6} style={[styles.opt, mapStyle === m && styles.optOn]}>
              <Text style={[styles.optText, mapStyle === m && { color: C.bg }]}>{m === 'satellite' ? 'SAT' : 'LINE'}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {props.footer}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.panel, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, overflow: 'hidden' },
  switch: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', backgroundColor: 'rgba(7,8,10,0.85)', borderRadius: 9, padding: 3 },
  opt: { paddingHorizontal: 10, height: 30, borderRadius: 7, justifyContent: 'center' },
  optOn: { backgroundColor: C.text },
  optText: { color: C.dim, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
});
