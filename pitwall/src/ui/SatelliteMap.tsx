/**
 * Real satellite imagery (Apple Maps on iPhone, works in Expo Go) under the
 * racing line. The web build uses SatelliteMap.web.tsx instead.
 */
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, type LatLng } from 'react-native-maps';
import { C, SPEED_STOPS, ramp } from './theme';
import type { MapLine, TrackMapProps } from './TrackMap';

/** Keep native polylines light: at most ~500 points per line. */
function coords(lat: number[], lon: number[], max = 500): LatLng[] {
  const step = Math.max(1, Math.ceil(lat.length / max));
  const out: LatLng[] = [];
  for (let i = 0; i < lat.length; i += step) {
    if (Number.isFinite(lat[i]) && Number.isFinite(lon[i])) out.push({ latitude: lat[i], longitude: lon[i] });
  }
  return out;
}

function lineColors(l: MapLine, max = 500): string[] {
  const v = l.v ?? [];
  const step = Math.max(1, Math.ceil(l.lat.length / max));
  if (l.colors) {
    const out: string[] = [];
    for (let i = 0; i < l.lat.length; i += step) if (Number.isFinite(l.lat[i]) && Number.isFinite(l.lon[i])) out.push(l.colors[i]);
    return out;
  }
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const out: string[] = [];
  for (let i = 0; i < l.lat.length; i += step) {
    if (Number.isFinite(l.lat[i]) && Number.isFinite(l.lon[i])) out.push(ramp(SPEED_STOPS, (v[i] - lo) / (hi - lo || 1)));
  }
  return out;
}

export function SatelliteMap({ width, height, lines, trail, car, startFinish, splits, markers }: TrackMapProps) {
  const ref = useRef<MapView>(null);
  const fitted = useRef(0);

  const lineCoords = useMemo(() => lines.map((l) => ({ l, c: coords(l.lat, l.lon), colors: l.v || l.colors ? lineColors(l) : undefined })), [lines]);
  const trailCoords = useMemo(() => (trail ? coords(trail.lat, trail.lon) : []), [trail]);

  // Re-fit the camera when the shape of what we show changes (new best lap, first trail).
  const fitKey = lineCoords.length ? `L${lineCoords.map((x) => x.c.length).join(',')}` : `T${Math.floor(trailCoords.length / 40)}`;
  useEffect(() => {
    const all = lineCoords.length ? lineCoords.flatMap((x) => x.c) : trailCoords;
    if (all.length < 2 || !ref.current) return;
    if (!lineCoords.length && fitted.current > 6) return; // stop chasing the trail after a while
    fitted.current++;
    ref.current.fitToCoordinates(all, { edgePadding: { top: 30, right: 30, bottom: 30, left: 30 }, animated: fitted.current > 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const first = lineCoords[0]?.c[0] ?? trailCoords[0] ?? (car ? { latitude: car.lat, longitude: car.lon } : null);

  return (
    <View style={{ width, height }}>
      {first && (
        <MapView
          ref={ref}
          style={StyleSheet.absoluteFill}
          mapType="satellite"
          userInterfaceStyle="dark"
          pitchEnabled={false}
          rotateEnabled={false}
          showsCompass={false}
          showsPointsOfInterests={false}
          toolbarEnabled={false}
          initialRegion={{ latitude: first.latitude, longitude: first.longitude, latitudeDelta: 0.008, longitudeDelta: 0.008 }}
        >
          {lineCoords.map(({ l, c, colors }, i) => (
            <Polyline
              key={i}
              coordinates={c}
              strokeColor={l.color ?? C.accent}
              strokeColors={colors}
              strokeWidth={l.width ?? 4}
              lineCap="round"
              lineJoin="round"
            />
          ))}
          {trailCoords.length > 1 && <Polyline coordinates={trailCoords} strokeColor="rgba(255,255,255,0.75)" strokeWidth={lines.length ? 2 : 4} />}
          {startFinish && (
            <Polyline
              coordinates={[
                { latitude: startFinish.a.lat, longitude: startFinish.a.lon },
                { latitude: startFinish.b.lat, longitude: startFinish.b.lon },
              ]}
              strokeColor="#FFFFFF"
              strokeWidth={5}
            />
          )}
          {splits?.map((s, i) => (
            <Marker key={i} coordinate={{ latitude: s.lat, longitude: s.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={styles.split} />
            </Marker>
          ))}
          {markers?.map((m, i) => (
            <Marker key={`m${i}`} coordinate={{ latitude: m.lat, longitude: m.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={[styles.dot, { backgroundColor: m.color }]} />
            </Marker>
          ))}
          {car && Number.isFinite(car.lat) && (
            <Marker coordinate={{ latitude: car.lat, longitude: car.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={styles.carHalo}>
                <View style={styles.car} />
              </View>
            </Marker>
          )}
        </MapView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: C.bg },
  split: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.bg, borderWidth: 2, borderColor: '#fff' },
  carHalo: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,224,198,0.3)', alignItems: 'center', justifyContent: 'center' },
  car: { width: 13, height: 13, borderRadius: 7, backgroundColor: C.accent, borderWidth: 2, borderColor: C.bg },
});
