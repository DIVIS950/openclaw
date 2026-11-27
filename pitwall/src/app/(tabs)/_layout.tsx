import { Tabs } from 'expo-router/js-tabs';
import { StyleSheet } from 'react-native';
import { Icon } from '../../ui/icons';
import { C } from '../../ui/theme';

const TABS = [
  { name: 'index', title: 'LIVE', icon: 'live' },
  { name: 'track', title: 'TRACK', icon: 'track' },
  { name: 'temps', title: 'TEMPS', icon: 'temps' },
  { name: 'sessions', title: 'SESSIONS', icon: 'sessions' },
  { name: 'device', title: 'DEVICE', icon: 'device' },
] as const;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.faint,
        tabBarStyle: { backgroundColor: '#0A0B0D', borderTopColor: C.line, borderTopWidth: StyleSheet.hairlineWidth },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
        sceneStyle: { backgroundColor: C.bg },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title, tabBarIcon: ({ color }) => <Icon name={t.icon} color={String(color)} /> }} />
      ))}
    </Tabs>
  );
}
