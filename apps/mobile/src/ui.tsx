/**
 * Design system. One file, so the app reads as one thing.
 *
 * Kaniti's look is "fresh, precise, new-era": a clean near-white ground, deep
 * ink, and a signature emerald that runs from spring green to forest in the
 * one gradient the eye is meant to follow — the action that matters on each
 * screen. Amber means "you might have forgotten"; red means "this will not
 * arrive". Prices are the largest number on any screen and always tabular so
 * columns align in Hebrew. Icons are drawn as vectors (no emoji chrome, no
 * dated glyphs) so the app feels designed, not assembled.
 */
import React from 'react';
import { Mark } from './Logo';
import { isRTL, LANGS, setLanguage, t as tr, useLanguage } from './lib/i18n';
import { Modal } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import {
  ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View,
  type PressableProps, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';

export const t = {
  bg: '#F4F6F4', card: '#FFFFFF', ink: '#0E1512', muted: '#5C6862', faint: '#9AA39D', line: '#E7ECE8',
  accent: '#0C7C4F', accent2: '#19C37D', accentSoft: '#E4F6EC', accentInk: '#FFFFFF',
  ink2: '#141E19', inkSoft: '#EEF1EF',
  amber: '#9A6A0F', amberSoft: '#FBF1DE', red: '#B23A3A', redSoft: '#F9E7E7',
  r: 22, rs: 14,
};

/** The signature gradient stops, used by GradientFill and the primary button. */
export const GRAD = ['#1CCB82', '#0B7A4E'] as const;
export const GRAD_INK = ['#20302A', '#0E1512'] as const;

const shadow: ViewStyle = Platform.select({
  ios: { shadowColor: '#0E2E1F', shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  android: { elevation: 3 },
  default: { boxShadow: '0 8px 24px rgba(14,46,31,0.08)' } as unknown as ViewStyle,
}) as ViewStyle;

const lift: ViewStyle = Platform.select({
  ios: { shadowColor: '#0E1512', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  android: { elevation: 5 },
  default: { boxShadow: '0 10px 24px rgba(14,21,18,0.16)' } as unknown as ViewStyle,
}) as ViewStyle;

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

function makeStyles(rtl: boolean) {
  const ta = rtl ? ('right' as const) : ('left' as const);
  const row = rtl ? ('row-reverse' as const) : ('row' as const);
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg },
  pad: { paddingHorizontal: 20, paddingVertical: 16 },
  display: { fontSize: 32, fontWeight: '800', color: t.ink, textAlign: ta, letterSpacing: -0.8 },
  title: { fontSize: 20, fontWeight: '800', color: t.ink, textAlign: ta, letterSpacing: -0.3 },
  body: { fontSize: 16, color: t.ink, textAlign: ta, lineHeight: 23 },
  small: { fontSize: 13, color: t.muted, textAlign: ta, lineHeight: 18 },
  faint: { fontSize: 12, color: t.faint, textAlign: ta },
  price: { fontSize: 22, fontWeight: '800', color: t.ink, ...tabular },
  priceBig: { fontSize: 34, fontWeight: '800', color: t.ink, letterSpacing: -1, ...tabular },
  priceSmall: { fontSize: 14, fontWeight: '600', color: t.muted, ...tabular },
  card: { backgroundColor: t.card, borderRadius: t.r, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: t.line, ...shadow },
  row: { flexDirection: row, alignItems: 'center', justifyContent: 'space-between' },
  rowStart: { flexDirection: row, alignItems: 'center', gap: 8 },
  hair: { height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginVertical: 10 },
  input: { backgroundColor: t.card, borderRadius: t.rs, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, textAlign: ta, color: t.ink, borderWidth: 1.5, borderColor: t.line },
  link: { color: t.accent, fontSize: 15, fontWeight: '700' },
  });
}

const cache = { rtl: makeStyles(true), ltr: makeStyles(false) };
/** Styles for the current direction. Screens call `S()` at render so a region change re-lays out. */
export const S = () => (isRTL() ? cache.rtl : cache.ltr);
/** Back-compat alias used inside this file's components. */
const s = new Proxy({} as ReturnType<typeof makeStyles>, { get: (_o, k) => (S() as never)[k as never] });

/* ------------------------------------------------------------------ *
 * Gradient surface — an absolute SVG fill, portable across native/web *
 * ------------------------------------------------------------------ */
export function GradientFill({ colors = GRAD, radius = t.r, angle = 'diagonal' }: { colors?: readonly [string, string]; radius?: number; angle?: 'diagonal' | 'vertical' }) {
  const id = React.useId();
  const [w, h] = angle === 'vertical' ? [0, 1] : [1, 1];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2={String(w)} y2={String(h)}>
            <Stop offset="0" stopColor={colors[0]} />
            <Stop offset="1" stopColor={colors[1]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" rx={radius} ry={radius} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** A card whose background is the signature gradient. Children render on top. */
export function GradientCard({ children, colors = GRAD, style, onPress, radius = t.r }: { children: React.ReactNode; colors?: readonly [string, string]; style?: ViewStyle; onPress?: () => void; radius?: number }) {
  const box = (pressed: boolean): ViewStyle[] => [{ borderRadius: radius, padding: 20, overflow: 'hidden' } as ViewStyle, lift, ...(pressed ? [{ opacity: 0.92, transform: [{ scale: 0.99 }] } as ViewStyle] : []), ...(style ? [style] : [])];
  if (!onPress) {
    return <View style={box(false)}><GradientFill colors={colors} radius={radius} />{children}</View>;
  }
  return (
    <Pressable onPress={onPress} style={({ pressed }) => box(pressed)}>
      <GradientFill colors={colors} radius={radius} />
      {children}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ *
 * Icon set — Feather: thin, even, professionally drawn line icons.   *
 * Named by meaning so screens never mention the glyph set.           *
 * 'chevron' points forward in the reading direction; 'back' points   *
 * toward the start, so both mirror correctly for Hebrew.             *
 * ------------------------------------------------------------------ */
export type IconName = 'home' | 'basket' | 'receipt' | 'user' | 'plus' | 'minus' | 'search' | 'chevron' | 'back' | 'spark' | 'check' | 'link' | 'store' | 'refresh' | 'sliders' | 'tag' | 'clock' | 'pin' | 'percent' | 'star' | 'heart' | 'arrow' | 'close' | 'scan';
const FEATHER: Record<IconName, React.ComponentProps<typeof Feather>['name']> = {
  home: 'home', basket: 'shopping-bag', receipt: 'file-text', user: 'user', plus: 'plus', minus: 'minus', search: 'search',
  chevron: 'chevron-right', back: 'chevron-left', spark: 'zap', check: 'check', link: 'link', store: 'shopping-cart', refresh: 'refresh-cw',
  sliders: 'sliders', tag: 'tag', clock: 'clock', pin: 'map-pin', percent: 'percent', star: 'star', heart: 'heart', arrow: 'arrow-right', close: 'x', scan: 'maximize',
};
export function Icon({ name, size = 24, color = t.ink }: { name: IconName; size?: number; color?: string; weight?: number }) {
  const rtl = isRTL();
  let glyph = FEATHER[name];
  if (name === 'chevron') glyph = rtl ? 'chevron-left' : 'chevron-right';
  if (name === 'back') glyph = rtl ? 'chevron-right' : 'chevron-left';
  if (name === 'arrow') glyph = rtl ? 'arrow-left' : 'arrow-right';
  return <Feather name={glyph} size={size} color={color} />;
}

type BtnKind = 'primary' | 'secondary' | 'quiet';
export function Button({ title, kind = 'primary', disabled, icon, style, ...p }: PressableProps & { title: string; kind?: BtnKind; icon?: IconName; style?: ViewStyle }) {
  const fg = kind === 'primary' ? t.accentInk : t.accent;
  const base: ViewStyle = { borderRadius: 999, paddingVertical: 16, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', flexDirection: isRTL() ? 'row-reverse' : 'row', gap: 8 };
  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        base,
        kind === 'primary' && { backgroundColor: t.ink },
        kind === 'secondary' && { backgroundColor: t.accentSoft },
        kind === 'quiet' && { paddingVertical: 11 },
        kind === 'primary' && lift,
        (pressed || disabled) && { opacity: 0.6, transform: [{ scale: 0.99 }] },
        style,
      ]}
      {...p}
    >
      {icon ? <Icon name={icon} size={19} color={fg} weight={2.4} /> : null}
      <Text style={{ color: fg, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 }}>{title}</Text>
    </Pressable>
  );
}

export const Input = (p: TextInputProps) => <TextInput placeholderTextColor={t.faint} {...p} style={[s.input, p.style]} />;

export function Chip({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const bg = { neutral: t.inkSoft, good: t.accentSoft, warn: t.amberSoft, bad: t.redSoft }[tone];
  const fg = { neutral: t.muted, good: t.accent, warn: t.amber, bad: t.red }[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700', letterSpacing: -0.1 }}>{text}</Text>
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
  const rtl = isRTL();
  return (
    <View style={[s.pad, { paddingBottom: 10 }]}>
      {onBack ? <Pressable onPress={onBack} hitSlop={10} style={{ alignSelf: rtl ? 'flex-end' : 'flex-start', marginBottom: 8 }}><View style={s.rowStart}><Icon name="back" size={18} color={t.accent} /><Text style={s.link}>{tr('back')}</Text></View></Pressable> : null}
      <View style={s.row}>
        <View style={[s.rowStart, { gap: 10, flexShrink: 1 }]}><Mark size={28} /><Text style={[s.display, { flexShrink: 1 }]} numberOfLines={1}>{title}</Text></View>
        {action && onAction ? <Pressable onPress={onAction} hitSlop={10}><Text style={s.link}>{action}</Text></Pressable> : null}
      </View>
      {subtitle ? <Text style={[s.small, { marginTop: 3 }]} numberOfLines={1}>{subtitle}</Text> : null}
    </View>
  );
}

/** A big rank letter in a circle: א ב ג. */
export const Rank = ({ letter, best }: { letter: string; best?: boolean }) => (
  <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: best ? t.ink : t.inkSoft }}>
    <Text style={{ color: best ? t.accentInk : t.muted, fontWeight: '800', fontSize: 16 }}>{letter}</Text>
  </View>
);

export const Empty = ({ title, hint }: { title: string; hint: string }) => (
  <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 }}>
    <Text style={[s.title, { textAlign: 'center' }]}>{title}</Text>
    <Text style={[s.small, { textAlign: 'center', marginTop: 6 }]}>{hint}</Text>
  </View>
);

/** A brief confirmation that fades. Kept tiny on purpose. */
export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', bottom: 120, left: 0, right: 0, alignItems: 'center' }}>
      <View style={{ borderRadius: 999, backgroundColor: t.ink, paddingHorizontal: 18, paddingVertical: 11, ...lift }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>{text}</Text>
      </View>
    </View>
  );
}

/** Placeholder card while a real one is on its way. */
export const Skeleton = ({ lines = 3 }: { lines?: number }) => (
  <View style={[s.card, { opacity: 0.6 }]}>
    {Array.from({ length: lines }, (_, i) => (
      <View key={i} style={{ height: i === 0 ? 20 : 12, borderRadius: 6, backgroundColor: t.inkSoft, marginBottom: 10, width: i === 0 ? '55%' : i === 1 ? '35%' : '80%', alignSelf: 'flex-end' }} />
    ))}
  </View>
);

/** Language dropdown: a chip that opens a small sheet of languages. */
export function LanguagePicker({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const lang = useLanguage();
  const [open, setOpen] = React.useState(false);
  const current = LANGS.find((l) => l.key === lang)?.label ?? 'עברית';
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: tone === 'dark' ? 'rgba(255,255,255,0.15)' : t.inkSoft, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 }}>
        <Text style={{ color: tone === 'dark' ? '#fff' : t.ink, fontWeight: '700' }}>{current}</Text>
        <Text style={{ color: tone === 'dark' ? '#fff' : t.muted, fontSize: 10 }}>▼</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 34 }}>
            <Text style={[s.title, { marginBottom: 8 }]}>{tr('language')}</Text>
            {LANGS.map((l) => (
              <Pressable key={l.key} onPress={() => { setLanguage(l.key); setOpen(false); }} style={[s.row, { paddingVertical: 14, borderTopWidth: 1, borderColor: t.line }]}>
                <Text style={[s.body, { fontSize: 17, fontWeight: l.key === lang ? '800' : '500' }]}>{l.label}</Text>
                {l.key === lang ? <Icon name="check" size={18} color={t.accent} weight={2.6} /> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
