/** Web has no Apple Maps: show the drawn map instead. */
import { TrackMap, type TrackMapProps } from './TrackMap';

export function SatelliteMap(props: TrackMapProps) {
  return <TrackMap {...props} />;
}
