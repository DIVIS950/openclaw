import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button, Card, Field, ProductThumb, Row, Screen, StoreAvatar, T } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/money';
import { connectors } from '@/lib/stores';
import type { Product } from '@/lib/types';
import { useAppState } from '@/state/app-state';

export default function ShopScreen() {
  const c = useTheme();
  const { state, dispatch } = useAppState();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [storeFilter, setStoreFilter] = useState<string>();
  const [products, setProducts] = useState<Product[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Search every connected store at once; one failing store doesn't hide the others.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const results = await Promise.allSettled(connectors.map((x) => x.search(query)));
      if (cancelled) return;
      setProducts(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])));
      setErrors(
        results.flatMap((r, i) => (r.status === 'rejected' ? [`${connectors[i].store.name}: ${String(r.reason)}`] : [])),
      );
      setLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const visible = useMemo(
    () => (storeFilter ? products.filter((p) => p.storeId === storeFilter) : products),
    [products, storeFilter],
  );
  const columns = width > 900 ? 4 : width > 600 ? 3 : 2;
  const cardWidth = `${100 / columns}%` as const;
  const inCart = (id: string) => state.cart.find((l) => l.productId === id)?.quantity ?? 0;

  return (
    <Screen>
      <View style={{ gap: Spacing.xs }}>
        <T variant="title">Every store. One cart.</T>
        <T muted>Shop from {connectors.length} stores, check out once, and track every package here.</T>
      </View>

      <Field placeholder="Search all stores…" value={query} onChangeText={setQuery} autoCorrect={false} />

      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label="All stores" active={!storeFilter} onPress={() => setStoreFilter(undefined)} />
        {connectors.map(({ store }) => (
          <Chip
            key={store.id}
            label={store.name}
            color={store.accent}
            active={storeFilter === store.id}
            onPress={() => setStoreFilter(storeFilter === store.id ? undefined : store.id)}
          />
        ))}
      </Row>

      {errors.map((e) => (
        <T key={e} style={{ color: c.danger }}>
          {e}
        </T>
      ))}

      {!loading && visible.length === 0 ? <T muted>No products match “{query}”.</T> : null}

      <View style={styles.grid}>
        {visible.map((p) => {
          const store = connectors.find((x) => x.store.id === p.storeId)!.store;
          const qty = inCart(p.id);
          return (
            <View key={p.id} style={{ width: cardWidth, padding: Spacing.xs }}>
              <Card style={{ flex: 1, gap: Spacing.sm, padding: Spacing.md }}>
                <View style={{ alignItems: 'center' }}>
                  <ProductThumb image={p.image} title={p.title} color={store.accent} size={110} />
                </View>
                <Row>
                  <StoreAvatar name={store.name} color={store.accent} size={18} />
                  <T variant="caption" muted numberOfLines={1} style={{ flex: 1 }}>
                    {store.name}
                  </T>
                </Row>
                <T variant="label" numberOfLines={2}>
                  {p.title}
                </T>
                <T variant="caption" muted numberOfLines={2} style={{ flex: 1 }}>
                  {p.description}
                </T>
                <T variant="heading">{formatMoney(p.price)}</T>
                <Button
                  small
                  kind={qty ? 'secondary' : 'primary'}
                  title={qty ? `In cart (${qty}) · Add` : 'Add to cart'}
                  onPress={() => dispatch({ type: 'addToCart', product: p })}
                />
              </Card>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

function Chip({ label, active, color, onPress }: { label: string; active: boolean; color?: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: active ? (color ?? c.primary) : c.border, backgroundColor: active ? (color ?? c.primary) + '1F' : c.card },
      ]}>
      <T variant="label" style={{ color: active ? (color ?? c.primary) : c.text }}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -Spacing.xs },
  chip: { borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
});
