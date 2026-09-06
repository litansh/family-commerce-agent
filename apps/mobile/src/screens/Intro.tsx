/**
 * The introduction, after the design review (docs/intro-design-review.md).
 *
 * Four screens, four colour fields, one arc. Each screen lets the person do
 * the thing Kanili is good at: merge the stores, form a memory, watch milk
 * come due, count three taps. Shown once after sign-in; reopenable from Me.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle } from 'react-native-svg';
import { Mark } from '../Logo';
import { isRTL, t as tr } from '../lib/i18n';
import { S, t } from '../ui';

const tap = () => { if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
const native = Platform.OS !== 'web';
const KEY = 'fca.intro.seen';
export const introSeen = async (): Promise<boolean> => { try { return (await AsyncStorage.getItem(KEY)) === '1'; } catch { return false; } };
const markSeen = async (): Promise<void> => { try { await AsyncStorage.setItem(KEY, '1'); } catch { /* fine */ } };

const CHAINS: { name: string; letter: string; color: string }[] = [
  { name: 'שופרסל', letter: 'ש', color: '#D7263D' }, { name: 'רמי לוי', letter: 'ר', color: '#1B4F9C' }, { name: 'ויקטורי', letter: 'ו', color: '#E4572E' },
  { name: 'קרפור', letter: 'ק', color: '#1F6FB2' }, { name: 'יוחננוף', letter: 'י', color: '#2A9D8F' }, { name: 'טיב טעם', letter: 'ט', color: '#8E44AD' },
];
const STAPLES = [['🥛', 'חלב'], ['🥚', 'ביצים'], ['🍞', 'לחם'], ['🍅', 'עגבניות'], ['🧀', 'קוטג׳'], ['🍼', 'פמפרס']] as const;
const FIELDS = ['#1F6B45', '#9A6A0F', '#1B1B1A', '#1F6B45'];

export function Intro({ onDone, firstTime }: { onDone: () => void; firstTime: boolean }) {
  const s = S();
  const rtl = isRTL();
  const [step, setStep] = useState(0);
  // Each stage must be played before Next unlocks: the intro is something the
  // person does, not reads. Skip exists only once they have seen it all once.
  const [done, setDone] = useState<boolean[]>([false, false, false, false]);
  const ready = done[step] ?? false;
  const complete = (i: number) => setDone((d) => d.map((x, j) => (j === i ? true : x)));
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => { enter.setValue(0); Animated.timing(enter, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start(); }, [step, enter]);
  const finish = async () => { await markSeen(); onDone(); };
  const next = () => { if (!ready) return; tap(); if (step === 3) void finish(); else setStep(step + 1); };
  const W = Dimensions.get('window').width;

  return (
    <View style={[s.screen, { backgroundColor: FIELDS[step] }]}>
      {/* colour field with progress and skip */}
      <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
        <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', gap: 6 }}>
          {[0, 1, 2, 3].map((i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? '#fff' : 'rgba(255,255,255,0.3)' }} />)}
        </View>
        <View style={[s.row, { marginTop: 10 }]}>
          <View style={s.rowStart}><Mark size={22} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700' }}>{tr('appName')}</Text></View>
          {!firstTime ? <Pressable onPress={finish} hitSlop={12}><Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>{tr('skip')}</Text></Pressable> : <View />}
        </View>
      </View>
      <Animated.View style={{ flex: 1, opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
        <View style={{ height: 300, alignItems: 'center', justifyContent: 'center' }}>
          {step === 0 && <MergeStage width={W} onDone={() => complete(0)} />}
          {step === 1 && <MemoryStage onDone={() => complete(1)} />}
          {step === 2 && <RhythmStage onDone={() => complete(2)} />}
          {step === 3 && <TapsStage onDone={() => complete(3)} />}
        </View>
        <View style={{ flex: 1, backgroundColor: t.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 26 }}>
          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            <Text style={[s.display, { fontSize: 32, letterSpacing: -0.8 }]}>{tr(`intro${step + 1}Title`)}</Text>
            <Text style={[s.body, { color: t.muted, fontSize: 17, lineHeight: 26, marginTop: 10 }]}>{tr(`intro${step + 1}Body`)}</Text>
            {step === 3 ? <Text style={[s.small, { marginTop: 10 }]}>{tr('introAfter')}</Text> : null}
            {!ready ? <Text style={[s.small, { marginTop: 10, color: t.amber, fontWeight: '700' }]}>{tr('introTryFirst')}</Text> : null}
          </ScrollView>
          <Pressable onPress={next} disabled={!ready} style={({ pressed }) => [{ backgroundColor: ready ? t.accent : t.line, borderRadius: 999, paddingVertical: 16, alignItems: 'center', marginBottom: 28 }, pressed && ready && { transform: [{ scale: 0.98 }] }]}>
            <Text style={{ color: ready ? '#fff' : t.muted, fontSize: 17, fontWeight: '800' }}>{step === 3 ? tr('introStart') : `${tr('introNext')} · ${step + 1}/4`}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

/** Six storefronts orbit a basket; tap the sentence, they fly in, the basket bounces. */
function MergeStage({ width, onDone }: { width: number; onDone: () => void }) {
  const anim = useRef(CHAINS.map(() => new Animated.Value(0))).current;
  const bounce = useRef(new Animated.Value(1)).current;
  const [merged, setMerged] = useState(false);
  const merge = () => {
    if (merged) return;
    tap();
    Animated.stagger(60, anim.map((a) => Animated.timing(a, { toValue: 1, duration: 520, easing: Easing.in(Easing.cubic), useNativeDriver: native }))).start(() => {
      setMerged(true); onDone();
      Animated.sequence([Animated.timing(bounce, { toValue: 1.15, duration: 140, useNativeDriver: native }), Animated.spring(bounce, { toValue: 1, useNativeDriver: native })]).start();
    });
  };
  const r = Math.min(width * 0.36, 140);
  return (
    <Pressable onPress={merge} style={{ width: '100%', height: 300, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ transform: [{ scale: bounce }], opacity: merged ? 1 : 0.35 }}>
        <View style={{ width: 112, height: 112, borderRadius: 30, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}><Mark size={72} /></View>
      </Animated.View>
      {CHAINS.map((c, i) => {
        const angle = (i / CHAINS.length) * Math.PI * 2 - Math.PI / 2;
        const x = anim[i]!.interpolate({ inputRange: [0, 1], outputRange: [Math.cos(angle) * r, 0] });
        const y = anim[i]!.interpolate({ inputRange: [0, 1], outputRange: [Math.sin(angle) * r, 0] });
        const sc = anim[i]!.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] });
        const op = anim[i]!.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 0.7, 0] });
        return (
          <Animated.View key={c.name} style={{ position: 'absolute', transform: [{ translateX: x }, { translateY: y }, { scale: sc }], opacity: op }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 999, paddingRight: 12, paddingLeft: 4, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: c.color, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '900' }}>{c.letter}</Text></View>
              <Text style={{ fontWeight: '700', color: t.ink }}>{c.name}</Text>
            </View>
          </Animated.View>
        );
      })}
      <Text style={{ position: 'absolute', bottom: 14, color: 'rgba(255,255,255,0.9)', fontWeight: '700' }}>{merged ? tr('intro1Done') : tr('intro1Tap')}</Text>
    </Pressable>
  );
}

/** Tap staples; each one slides into the memory card. */
function MemoryStage({ onDone }: { onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const fired = useRef(false);
  useEffect(() => { if (picked.length >= 3 && !fired.current) { fired.current = true; onDone(); } }, [picked, onDone]);
  const toggle = (k: string) => { tap(); setPicked((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k])); };
  return (
    <View style={{ width: '100%', paddingHorizontal: 24 }}>
      <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
        {STAPLES.map(([g, name]) => {
          const on = picked.includes(name);
          return (
            <Pressable key={name} onPress={() => toggle(name)} style={({ pressed }) => [{ backgroundColor: on ? '#fff' : 'rgba(255,255,255,0.18)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row-reverse', gap: 8, alignItems: 'center' }, pressed && { transform: [{ scale: 0.96 }] }]}>
              <Text style={{ fontSize: 20 }}>{g}</Text><Text style={{ fontWeight: '800', color: on ? t.ink : '#fff', fontSize: 15 }}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ marginTop: 16, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 18, padding: 14, minHeight: 84 }}>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '700', textAlign: 'right' }}>{tr('intro2Memory')}</Text>
        <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'right', marginTop: 6 }}>{picked.length ? picked.join(' · ') : tr('intro2Empty')}</Text>
        {picked.length >= 3 ? <Text style={{ color: '#fff', textAlign: 'right', marginTop: 6 }}>{tr('intro2Usual', { n: picked.length })}</Text> : null}
      </View>
    </View>
  );
}

/** A ring fills over days; at four it turns amber and milk is due. */
function RhythmStage({ onDone }: { onDone: () => void }) {
  const [day, setDay] = useState(0);
  const [added, setAdded] = useState(false);
  useEffect(() => { if (added) return; const h = setInterval(() => setDay((d) => (d >= 5 ? 0 : d + 1)), 800); return () => clearInterval(h); }, [added]);
  const due = day >= 4;
  const R = 78; const C = 2 * Math.PI * R; const pct = Math.min(1, day / 4);
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: 200, height: 200, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={200} height={200} style={{ position: 'absolute' }}>
          <Circle cx={100} cy={100} r={R} stroke="rgba(255,255,255,0.18)" strokeWidth={12} fill="none" />
          <Circle cx={100} cy={100} r={R} stroke={due ? '#F5B942' : '#fff'} strokeWidth={12} fill="none" strokeLinecap="round" strokeDasharray={`${C}`} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 100 100)" />
        </Svg>
        <Text style={{ fontSize: 56 }}>🥛</Text>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16, marginTop: 2 }}>{tr('intro3Days', { d: day })}</Text>
      </View>
      <Pressable disabled={!due || added} onPress={() => { tap(); setAdded(true); onDone(); }} style={({ pressed }) => [{ backgroundColor: added ? '#fff' : due ? '#F5B942' : 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, marginTop: 6 }, pressed && { transform: [{ scale: 0.96 }] }]}>
        <Text style={{ color: added || due ? t.ink : '#fff', fontWeight: '800' }}>{added ? tr('intro3Added') : due ? `${tr('intro3Due')}  +` : tr('intro3Rhythm')}</Text>
      </Pressable>
    </View>
  );
}

/** Three real-looking steps; the third completes the demo and unlocks Start. */
function TapsStage({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState(0);
  const steps = [tr('intro4a'), tr('intro4b'), tr('intro4c')];
  const fired = useRef(false);
  useEffect(() => { if (n === 3 && !fired.current) { fired.current = true; onDone(); } }, [n, onDone]);
  return (
    <View style={{ width: '100%', paddingHorizontal: 24, gap: 10 }}>
      {steps.map((label, i) => {
        const done = n > i; const active = n === i;
        return (
          <Pressable key={label} disabled={!active} onPress={() => { tap(); setN(i + 1); }}
            style={({ pressed }) => [{ backgroundColor: done ? '#fff' : active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 14, flexDirection: 'row-reverse', alignItems: 'center', gap: 14, borderWidth: 2, borderColor: active ? '#fff' : 'transparent' }, pressed && { transform: [{ scale: 0.97 }] }]}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: done ? t.accent : 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>{done ? '✓' : i + 1}</Text>
            </View>
            <Text style={{ color: done ? t.ink : '#fff', fontWeight: '800', fontSize: 17, flex: 1, textAlign: 'right' }}>{label}</Text>
          </Pressable>
        );
      })}
      {n === 3 ? <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '800', fontSize: 18, marginTop: 4 }}>{tr('intro4Done')}</Text> : null}
    </View>
  );
}
