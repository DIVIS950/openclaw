import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { C } from '../ui/theme';
import { LapFlash } from '../ui/LapFlash';
import { WarningBanner } from '../ui/WarningBanner';

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: C.bg, card: C.bg, border: C.line, primary: C.accent, text: C.text },
};

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <View style={{ flex: 1, backgroundColor: C.bg }}>
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: C.bg },
              headerStyle: { backgroundColor: C.bg },
              headerTintColor: C.text,
              headerTitleStyle: { fontWeight: '800' },
              headerShadowVisible: false,
              headerBackButtonDisplayMode: 'minimal',
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="session/[id]" options={{ title: 'SESSION' }} />
            <Stack.Screen name="lap" options={{ title: 'LAP' }} />
          </Stack>
          <LapFlash />
          <WarningBanner />
        </View>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
