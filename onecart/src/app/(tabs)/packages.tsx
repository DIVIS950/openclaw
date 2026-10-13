import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { Button, Card, Empty, Progress, Row, Screen, StatusPill, T } from '@/components/ui';
import { useNow } from '@/hooks/use-now';
import { currentStatus, simulateTracking } from '@/lib/tracking/status';
import type { Shipment, ShipmentStatus, TrackingEvent } from '@/lib/types';
import { useAppState } from '@/state/app-state';

type Item = { s: Shipment; status: ShipmentStatus; latest?: TrackingEvent };

export default function PackagesScreen() {
  const { state } = useAppState();
  const now = useNow();
  const items: Item[] = state.shipments.map((s) => {
    const events = simulateTracking(s, now);
    return { s, status: currentStatus(events), latest: events[0] };
  });
  const active = items.filter((i) => i.status !== 'delivered');
  const delivered = items.filter((i) => i.status === 'delivered');

  return (
    <Screen>
      <Button title="Find packages in my email" kind="secondary" onPress={() => router.push('/import-email')} />

      {!items.length ? (
        <Empty
          title="Nothing on the way"
          body="Packages from your OneCart orders appear here automatically. Scan your email to add packages from anywhere else."
        />
      ) : null}

      {active.length ? <Section label="On the way" list={active} /> : null}
      {delivered.length ? <Section label="Delivered" list={delivered} /> : null}
    </Screen>
  );
}

function Section({ label, list }: { label: string; list: Item[] }) {
  return (
    <>
      <T variant="label" muted>
        {label.toUpperCase()} · {list.length}
      </T>
      {list.map(({ s, status, latest }) => (
        <Pressable key={s.id} onPress={() => router.push(`/package/${s.id}`)}>
          <Card>
            <Row>
              <T variant="heading" style={{ flex: 1 }} numberOfLines={1}>
                {s.storeName}
              </T>
              <StatusPill status={status} />
            </Row>
            <T muted numberOfLines={1}>
              {s.title}
            </T>
            <Progress status={status} />
            <T variant="caption" muted>
              {latest?.message ?? 'Waiting for carrier'} · {s.carrier} {s.trackingNumber} · {s.source === 'email' ? 'from email' : 'OneCart order'}
            </T>
          </Card>
        </Pressable>
      ))}
    </>
  );
}
