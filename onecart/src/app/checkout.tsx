import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Field, Row, Screen, StoreAvatar, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { groupByStore } from '@/lib/cart';
import { makeId } from '@/lib/id';
import { formatMoney, sumLines } from '@/lib/money';
import { getConnector } from '@/lib/stores';
import { detectCarrier } from '@/lib/tracking/carrier';
import type { Address } from '@/lib/types';
import { useAppState } from '@/state/app-state';

const EMPTY: Address = { name: '', email: '', line1: '', city: '', postalCode: '', country: '' };

export default function CheckoutScreen() {
  const c = useTheme();
  const { state, dispatch } = useAppState();
  const [address, setAddress] = useState<Address>(state.address ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const groups = groupByStore(state.cart);
  const set = (key: keyof Address) => (value: string) => setAddress((a) => ({ ...a, [key]: value }));
  const complete = address.name && address.line1 && address.city && address.postalCode && address.country;

  // One checkout tap places a separate order with every store in the cart.
  async function placeOrders() {
    setBusy(true);
    setError(undefined);
    dispatch({ type: 'saveAddress', address });
    const failed: string[] = [];
    for (const [storeId, lines] of groups) {
      const connector = getConnector(storeId);
      if (!connector) continue;
      const { store } = connector;
      try {
        const result = await connector.checkout(lines, address);
        const orderId = makeId('ord');
        const placedAt = new Date().toISOString();
        if (result.kind === 'hosted') {
          // Real stores take payment in their own secure checkout, shown inside the app.
          await WebBrowser.openBrowserAsync(result.checkoutUrl, {
            presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
          });
          dispatch({
            type: 'orderPlaced',
            order: { id: orderId, storeId, storeName: store.name, number: 'Pending', lines, placedAt },
          });
          continue;
        }
        dispatch({
          type: 'orderPlaced',
          order: { id: orderId, storeId, storeName: store.name, number: result.orderNumber, lines, placedAt },
          shipment: {
            id: makeId('shp'),
            source: 'order',
            storeName: store.name,
            title: lines.map((l) => l.title).join(', '),
            carrier: detectCarrier(result.trackingNumber),
            trackingNumber: result.trackingNumber,
            createdAt: placedAt,
            orderId,
            orderNumber: result.orderNumber,
          },
        });
      } catch (e) {
        failed.push(`${store.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBusy(false);
    if (failed.length) setError(failed.join('\n'));
    else router.replace('/orders');
  }

  return (
    <Screen>
      <Card>
        <T variant="heading">Ship to</T>
        <Field label="Full name" value={address.name} onChangeText={set('name')} autoComplete="name" />
        <Field label="Email (for receipts)" value={address.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Field label="Street address" value={address.line1} onChangeText={set('line1')} autoComplete="street-address" />
        <Row style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 2 }}>
            <Field label="City" value={address.city} onChangeText={set('city')} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Postal code" value={address.postalCode} onChangeText={set('postalCode')} autoComplete="postal-code" />
          </View>
        </Row>
        <Field label="Country" value={address.country} onChangeText={set('country')} autoComplete="country" />
      </Card>

      <Card>
        <T variant="heading">Your orders</T>
        {groups.map(([storeId, lines]) => {
          const store = getConnector(storeId)?.store;
          return (
            <Row key={storeId}>
              <StoreAvatar name={store?.name ?? storeId} color={store?.accent ?? '#888'} size={24} />
              <T style={{ flex: 1 }}>
                {store?.name} · {lines.reduce((n, l) => n + l.quantity, 0)} items
              </T>
              <T variant="label">{formatMoney(sumLines(lines))}</T>
            </Row>
          );
        })}
        <Row>
          <T variant="heading" style={{ flex: 1 }}>
            Total
          </T>
          <T variant="heading">{formatMoney(sumLines(state.cart))}</T>
        </Row>
        <T variant="caption" muted>
          Demo stores don't charge a card. Real Shopify stores open their own secure checkout inside the app.
        </T>
        {error ? <T style={{ color: c.danger }}>{error}</T> : null}
        <Button title={`Place ${groups.length} ${groups.length === 1 ? 'order' : 'orders'}`} disabled={!complete || !groups.length} loading={busy} onPress={placeOrders} />
      </Card>
    </Screen>
  );
}
