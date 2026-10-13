import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useAppState } from '@/state/app-state';

type IconName = ComponentProps<typeof Ionicons>['name'];

const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color} size={size} />;

export default function TabsLayout() {
  const c = useTheme();
  const { state } = useAppState();
  const cartCount = state.cart.reduce((n, l) => n + l.quantity, 0);
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: c.primary, headerTitleStyle: { fontWeight: '800' } }}>
      <Tabs.Screen name="index" options={{ title: 'Shop', headerTitle: 'OneCart', tabBarIcon: icon('storefront-outline') }} />
      <Tabs.Screen
        name="cart"
        options={{ title: 'Cart', tabBarIcon: icon('cart-outline'), tabBarBadge: cartCount || undefined }}
      />
      <Tabs.Screen name="orders" options={{ title: 'Orders', tabBarIcon: icon('receipt-outline') }} />
      <Tabs.Screen name="packages" options={{ title: 'Packages', tabBarIcon: icon('cube-outline') }} />
    </Tabs>
  );
}
