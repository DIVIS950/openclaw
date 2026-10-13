import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { View } from 'react-native';

import { Button, Card, Empty, Progress, Row, Screen, StatusPill, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { carrierTrackingUrl } from '@/lib/tracking/carrier';
import { currentStatus, simulateTracking } from '@/lib/tracking/status';
import { useAppState } from '@/state/app-state';

export default function PackageScreen() {
  const c = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, dispatch } = useAppState();
  const now = useNow(15_000);
  const shipment = state.shipments.find((s) => s.id === id);

  if (!shipment) {
    return (
      <Screen>
        <Empty title="Package not found" body="It may have been removed." />
      </Screen>
    );
  }

  const events = simulateTracking(shipment, now);
  const status = currentStatus(events);
  const carrierUrl = carrierTrackingUrl(shipment.carrier, shipment.trackingNumber);

  return (
    <Screen>
      <Card>
        <Row>
          <T variant="title" style={{ flex: 1 }} numberOfLines={1}>
            {shipment.storeName}
          </T>
          <StatusPill status={status} />
        </Row>
        <T muted>{shipment.title}</T>
        <Progress status={status} />
        <T variant="caption" muted>
          {shipment.carrier} · {shipment.trackingNumber}
          {shipment.orderNumber ? ` · Order ${shipment.orderNumber}` : ''}
        </T>
      </Card>

      <Card>
        <T variant="heading">Timeline</T>
        {events.map((e, i) => (
          <Row key={e.at + e.message} style={{ alignItems: 'flex-start', gap: Spacing.md }}>
            <View style={{ alignItems: 'center', paddingTop: 5 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i === 0 ? c.primary : c.border }} />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="label">{e.message}</T>
              <T variant="caption" muted>
                {new Date(e.at).toLocaleString()}
                {e.location ? ` · ${e.location}` : ''}
              </T>
            </View>
          </Row>
        ))}
        <T variant="caption" muted>
          Demo timeline. Connect a tracking service to show live carrier scans.
        </T>
      </Card>

      {carrierUrl ? (
        <Button kind="secondary" title={`Open on ${shipment.carrier}`} onPress={() => WebBrowser.openBrowserAsync(carrierUrl)} />
      ) : null}
      <Button
        kind="danger"
        title="Remove package"
        onPress={() => {
          dispatch({ type: 'removeShipment', id: shipment.id });
          router.back();
        }}
      />
    </Screen>
  );
}
