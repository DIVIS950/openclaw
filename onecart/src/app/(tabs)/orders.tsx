import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { Button, Card, Empty, Progress, Row, Screen, StatusPill, StoreAvatar, T } from '@/components/ui';
import { useNow } from '@/hooks/use-now';
import { formatMoney } from '@/lib/money';
import { getConnector } from '@/lib/stores';
import { currentStatus, simulateTracking } from '@/lib/tracking/status';
import { useAppState } from '@/state/app-state';

export default function OrdersScreen() {
  const { state } = useAppState();
  const now = useNow();

  if (!state.orders.length) {
    return (
      <Screen>
        <Empty
          title="No orders yet"
          body="Orders you place in OneCart show up here, with tracking added automatically."
          action={<Button title="Start shopping" onPress={() => router.navigate('/')} />}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {state.orders.map((o) => {
        const store = getConnector(o.storeId)?.store;
        const shipment = state.shipments.find((s) => s.id === o.shipmentId);
        const status = shipment ? currentStatus(simulateTracking(shipment, now)) : undefined;
        return (
          <Pressable key={o.id} disabled={!shipment} onPress={() => shipment && router.push(`/package/${shipment.id}`)}>
            <Card>
              <Row>
                <StoreAvatar name={o.storeName} color={store?.accent ?? '#888'} />
                <T variant="heading" style={{ flex: 1 }}>
                  {o.storeName}
                </T>
                <T variant="label">{formatMoney(o.total)}</T>
              </Row>
              <T muted numberOfLines={2}>
                Order {o.number} · {new Date(o.placedAt).toLocaleDateString()} · {o.lines.map((l) => `${l.quantity}× ${l.title}`).join(', ')}
              </T>
              {status ? (
                <>
                  <Row>
                    <StatusPill status={status} />
                    <T variant="caption" muted>
                      {shipment!.carrier} {shipment!.trackingNumber}
                    </T>
                  </Row>
                  <Progress status={status} />
                </>
              ) : (
                <T variant="caption" muted>
                  Finishing at the store. Tracking appears when the shipping email arrives.
                </T>
              )}
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
