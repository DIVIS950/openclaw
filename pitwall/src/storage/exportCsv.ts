import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SavedSession } from './sessions';

const HEADER = 'lap,lap_time_ms,t_ms,dist_m,lat,lon,speed_kmh,tyre_fl_c,tyre_fr_c,tyre_rl_c,tyre_rr_c,brake_fl_c,brake_fr_c,coolant_c,oil_c,egt_c';

/** Every stored sample of every lap as one CSV table (opens in Excel / Numbers / RaceStudio-style tools). */
export function sessionToCsv(s: SavedSession): string {
  const rows = [HEADER];
  for (const lap of s.laps) {
    const tr = lap.trace;
    for (let i = 0; i < tr.t.length; i++) {
      rows.push(
        [lap.number, lap.timeMs, tr.t[i], tr.d[i], tr.lat[i], tr.lon[i], tr.v[i], tr.tfl[i], tr.tfr[i], tr.trl[i], tr.trr[i], tr.bfl[i], tr.bfr[i], tr.coolant[i], tr.oil[i], tr.egt[i]].join(','),
      );
    }
  }
  return rows.join('\n') + '\n';
}

/** Write the CSV to the cache folder and open the iOS share sheet (AirDrop, Mail, Files…). */
export async function shareSessionCsv(s: SavedSession): Promise<void> {
  const name = `pitwall-${new Date(s.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  await file.write(sessionToCsv(s));
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Export session' });
}
