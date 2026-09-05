/**
 * Design system. One file, so the app reads as one thing.
 *
 * Warm paper background, ink text, a single deep-green accent for the one
 * action that matters on each screen, amber only for "you might have
 * forgotten", red only for "this will not arrive". Prices are the largest
 * number on any screen and always tabular so columns align in Hebrew.
 */
import React from 'react';
import {
  ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View,
  type PressableProps, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';

export const t = {
  bg: '#FAF8F3', card: '#FFFFFF', ink: '#1B1B1A', muted: '#6F6B63', faint: '#A39F96', line: '#ECE8DF',
  accent: '#1F6B45', accentSoft: '#E4F1E9', accentInk: '#FFFFFF',
  amber: '#9A6A0F', amberSoft: '#FBF1DE', red: '#B23A3A', redSoft: '#F9E7E7',
  r: 16, rs: 10,
};

const shadow: ViewStyle = Platform.select({
  ios: { shadowColor: '#3A3A2A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  android: { elevation: 2 },
  default: { boxShadow: '0 4px 14px rgba(58,58,42,0.06)' } as unknown as ViewStyle,
}) as ViewStyle;

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg },
  pad: { paddingHorizontal: 20, paddingVertical: 16 },
  display: { fontSize: 30, fontWeight: '800', color: t.ink, textAlign: 'right', letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: '700', color: t.ink, textAlign: 'right' },
  body: { fontSize: 16, color: t.ink, textAlign: 'right', lineHeight: 23 },
  small: { fontSize: 13, color: t.muted, textAlign: 'right', lineHeight: 18 },
  faint: { fontSize: 12, color: t.faint, textAlign: 'right' },
  price: { fontSize: 22, fontWeight: '800', color: t.ink, ...tabular },
  priceBig: { fontSize: 34, fontWeight: '800', color: t.ink, letterSpacing: -1, ...tabular },
  priceSmall: { fontSize: 14, fontWeight: '600', color: t.muted, ...tabular },
  card: { backgroundColor: t.card, borderRadius: t.r, padding: 16, marginBottom: 12, ...shadow },
  row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  rowStart: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  hair: { height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginVertical: 10 },
  input: { backgroundColor: t.card, borderRadius: t.rs, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, textAlign: 'right', color: t.ink, borderWidth: 1, borderColor: t.line },
  link: { color: t.accent, fontSize: 15, fontWeight: '600' },
});

type BtnKind = 'primary' | 'secondary' | 'quiet';
export function Button({ title, kind = 'primary', disabled, style, ...p }: PressableProps & { title: string; kind?: BtnKind; style?: ViewStyle }) {
  const bg = kind === 'primary' ? t.accent : kind === 'secondary' ? t.accentSoft : 'transparent';
  const fg = kind === 'primary' ? t.accentInk : t.accent;
  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        { backgroundColor: bg, borderRadius: 999, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
        kind === 'quiet' && { paddingVertical: 10 },
        (pressed || disabled) && { opacity: 0.55 },
        style,
      ]}
      {...p}
    >
      <Text style={{ color: fg, fontSize: 16, fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );
}

export const Input = (p: TextInputProps) => <TextInput placeholderTextColor={t.faint} {...p} style={[s.input, p.style]} />;

export function Chip({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const bg = { neutral: '#F1EEE6', good: t.accentSoft, warn: t.amberSoft, bad: t.redSoft }[tone];
  const fg = { neutral: t.muted, good: t.accent, warn: t.amber, bad: t.red }[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export const Loading = ({ label }: { label?: string }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
    <ActivityIndicator color={t.accent} size="large" />
    {label ? <Text style={[s.small, { marginTop: 14, textAlign: 'center' }]}>{label}</Text> : null}
  </View>
);

/** Screen header: big title, one-line context under it, optional action on the left. */
export function Header({ title, subtitle, action, onAction, onBack }: { title: string; subtitle?: string; action?: string; onAction?: () => void; onBack?: () => void }) {
  return (
    <View style={[s.pad, { paddingBottom: 8 }]}>
      {onBack ? <Pressable onPress={onBack} hitSlop={10} style={{ alignSelf: 'flex-end', marginBottom: 6 }}><Text style={s.link}>‹ חזרה</Text></Pressable> : null}
      <View style={s.row}>
        <Text style={s.display}>{title}</Text>
        {action && onAction ? <Pressable onPress={onAction} hitSlop={10}><Text style={s.link}>{action}</Text></Pressable> : null}
      </View>
      {subtitle ? <Text style={[s.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
    </View>
  );
}

/** A big rank letter in a circle: א ב ג. */
export const Rank = ({ letter, best }: { letter: string; best?: boolean }) => (
  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: best ? t.accent : '#F1EEE6', alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ color: best ? t.accentInk : t.muted, fontWeight: '800', fontSize: 16 }}>{letter}</Text>
  </View>
);

export const Empty = ({ title, hint }: { title: string; hint: string }) => (
  <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 }}>
    <Text style={[s.title, { textAlign: 'center' }]}>{title}</Text>
    <Text style={[s.small, { textAlign: 'center', marginTop: 6 }]}>{hint}</Text>
  </View>
);
