import { router } from 'expo-router';

import { Button, Card, Empty, ProductThumb, Row, Screen, StoreAvatar, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { groupByStore } from '@/lib/cart';
import { formatMoney, sumLines } from '@/lib/money';
import { getConnector } from '@/lib/stores';
import { useAppState } from '@/state/app-state';

export default function CartScreen() {
  const { state, dispatch } = useAppState();
  const groups = groupByStore(state.cart);

  if (!state.cart.length) {
    return (
      <Screen>
        <Empty
          title="Your cart is empty"
          body="Add things from any store. They all land here, and you check out once."
          action={<Button title="Start shopping" onPress={() => router.navigate('/')} />}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {groups.map(([storeId, lines]) => {
        const store = getConnector(storeId)?.store;
        return (
          <Card key={storeId}>
            <Row>
              <StoreAvatar name={store?.name ?? storeId} color={store?.accent ?? '#888'} />
              <T variant="heading" style={{ flex: 1 }}>
                {store?.name ?? storeId}
              </T>
              <T variant="label" muted>
                {formatMoney(sumLines(lines))}
              </T>
            </Row>
            {lines.map((l) => (
              <Row key={l.productId} style={{ gap: Spacing.md }}>
                <ProductThumb image={l.image} title={l.title} color={store?.accent ?? '#888'} size={52} />
                <T style={{ flex: 1 }} numberOfLines={2}>
                  {l.title}
                  {'\n'}
                  <T variant="caption" muted>
                    {formatMoney(l.price)}
                  </T>
                </T>
                <Button small kind="secondary" title="−" onPress={() => dispatch({ type: 'setQuantity', productId: l.productId, quantity: l.quantity - 1 })} />
                <T variant="label" style={{ minWidth: 20, textAlign: 'center' }}>
                  {l.quantity}
                </T>
                <Button small kind="secondary" title="+" onPress={() => dispatch({ type: 'setQuantity', productId: l.productId, quantity: l.quantity + 1 })} />
              </Row>
            ))}
          </Card>
        );
      })}
      <Card>
        <Row>
          <T variant="heading" style={{ flex: 1 }}>
            Total ({groups.length} {groups.length === 1 ? 'store' : 'stores'})
          </T>
          <T variant="heading">{formatMoney(sumLines(state.cart))}</T>
        </Row>
        <Button title="Check out" onPress={() => router.push('/checkout')} />
      </Card>
    </Screen>
  );
}
