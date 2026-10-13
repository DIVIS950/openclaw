import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextProps,
  TextInput,
  type TextInputProps,
  View,
  type ViewProps,
} from 'react-native';

import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { STATUS_LABEL, STATUS_PROGRESS } from '@/lib/tracking/status';
import type { ShipmentStatus } from '@/lib/types';

type TextVariant = 'title' | 'heading' | 'body' | 'label' | 'caption';

export function T({
  variant = 'body',
  muted,
  style,
  ...rest
}: TextProps & { variant?: TextVariant; muted?: boolean }) {
  const c = useTheme();
  return <Text style={[styles[variant], { color: muted ? c.textSecondary : c.text }, style]} {...rest} />;
}

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const c = useTheme();
  const inner = <View style={styles.content}>{children}</View>;
  return scroll ? (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.scroll}>
      {inner}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, backgroundColor: c.background }, styles.scroll]}>{inner}</View>
  );
}

export function Card({ style, ...rest }: ViewProps) {
  const c = useTheme();
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]} {...rest} />;
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  small,
}: {
  title: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
}) {
  const c = useTheme();
  const bg = kind === 'primary' ? c.primary : kind === 'danger' ? c.danger : c.muted;
  const fg = kind === 'secondary' ? c.text : c.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, style, ...rest }: TextInputProps & { label?: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: Spacing.xs, flexGrow: 1 }}>
      {label ? <T variant="label" muted>{label}</T> : null}
      <TextInput
        placeholderTextColor={c.textSecondary}
        style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }, style]}
        {...rest}
      />
    </View>
  );
}

export function StoreAvatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}

export function ProductThumb({ image, title, color, size }: { image?: string; title: string; color: string; size: number }) {
  if (image) return <Image source={image} style={{ width: size, height: size, borderRadius: Radius.md }} contentFit="cover" />;
  return (
    <View style={[styles.thumb, { width: size, height: size, backgroundColor: color + '22' }]}>
      <Text style={{ color, fontSize: size * 0.32, fontWeight: '800' }}>{title[0]}</Text>
    </View>
  );
}

export function StatusPill({ status }: { status: ShipmentStatus }) {
  const c = useTheme();
  const color =
    status === 'delivered' ? c.success : status === 'out_for_delivery' ? c.warning : status === 'unknown' ? c.textSecondary : c.primary;
  return (
    <View style={[styles.pill, { backgroundColor: color + '1F' }]}>
      <Text style={{ color, fontWeight: '700', fontSize: 12 }}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

export function Progress({ status }: { status: ShipmentStatus }) {
  const c = useTheme();
  const color = status === 'delivered' ? c.success : c.primary;
  return (
    <View style={[styles.track, { backgroundColor: c.muted }]}>
      <View style={[styles.fill, { width: `${STATUS_PROGRESS[status] * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xxl }}>
      <T variant="heading">{title}</T>
      <T muted style={{ textAlign: 'center', maxWidth: 360 }}>
        {body}
      </T>
      {action}
    </Card>
  );
}

export function Row({ style, ...rest }: ViewProps) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, style]} {...rest} />;
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  heading: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 13, fontWeight: '600' },
  caption: { fontSize: 12 },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl * 2 },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.lg },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md },
  button: { minHeight: 48, borderRadius: Radius.md, paddingHorizontal: Spacing.lg, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { minHeight: 36, paddingHorizontal: Spacing.md },
  buttonText: { fontSize: 16, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 10, fontSize: 15 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  thumb: { borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.pill, alignSelf: 'flex-start' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
