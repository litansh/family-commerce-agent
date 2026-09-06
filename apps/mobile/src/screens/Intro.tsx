/**
 * The introduction. Four screens, each one lets the person *do* the thing
 * Kanili is good at rather than read about it. Shown once after sign-in,
 * reopenable from Me.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Mark, Tile } from '../Logo';
import { isRTL, t as tr } from '../lib/i18n';
import { Button, S, t } from '../ui';

const tap = () => { if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
const KEY = 'fca.intro.seen';
export const introSeen = async (): Promise<boolean> => { try { return (await AsyncStorage.getItem(KEY)) === '1'; } catch { return false; } };
const markSeen = async (): Promise<void> => { try { await AsyncStorage.setItem(KEY, '1'); } catch { /* fine */ } };

const CHAINS = ['שופרסל', 'רמי לוי', 'ויקטורי', 'קרפור', 'יוחננוף', 'טיב טעם'];
const STAPLES = [['🥛', 'חלב'], ['🥚', 'ביצים'], ['🍞', 'לחם'], ['🍅', 'עגבניות'], ['🧀', 'קוטג׳'], ['🍼', 'פמפרס']] as const;

export function Intro({ onDone }: { onDone: () => void }) {
  const s = S();
  const rtl = isRTL();
  const [step, setStep] = useState(0);
  const finish = async () => { await markSeen(); onDone(); };
  const next = () => { tap(); if (step === 3) void finish(); else setStep(step + 1); };
  const W = Dimensions.get('window').width;

  return (
    <View style={[s.screen, { paddingTop: 12 }]}>
      <View style={[s.row, { paddingHorizontal: 20 }]}>
        <View style={s.rowStart}><Mark size={24} /><Text style={[s.small, { fontWeight: '700', color: t.ink }]}>{tr('appName')}</Text></View>
        <Pressable onPress={finish} hitSlop={10}><Text style={s.link}>{tr('skip')}</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 24 }}>
        {step === 0 && <StepOneShop rtl={rtl} width={W} />}
        {step === 1 && <StepMemory rtl={rtl} />}
        {step === 2 && <StepForgot rtl={rtl} />}
        {step === 3 && <StepThreeTaps rtl={rtl} />}
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingBottom: 28 }}>
        <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
          {[0, 1, 2, 3].map((i) => <View key={i} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === step ? t.accent : t.line }} />)}
        </View>
        <Button title={step === 3 ? tr('introStart') : tr('introNext')} onPress={next} />
      </View>
    </View>
  );
}

/** Chains slide into one basket. */
function StepOneShop({ rtl, width }: { rtl: boolean; width: number }) {
  const s = S();
  const anim = useRef(CHAINS.map(() => new Animated.Value(0))).current;
  const [merged, setMerged] = useState(false);
  const merge = () => {
    tap();
    Animated.stagger(70, anim.map((a) => Animated.timing(a, { toValue: 1, duration: 550, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }))).start(() => setMerged(true));
  };
  return (
    <View>
      <View style={{ height: 240, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', opacity: merged ? 1 : 0.15 }}><Tile size={merged ? 120 : 96} /></View>
        {CHAINS.map((c, i) => {
          const angle = (i / CHAINS.length) * Math.PI * 2;
          const r = Math.min(width * 0.32, 130);
          const x = anim[i]!.interpolate({ inputRange: [0, 1], outputRange: [Math.cos(angle) * r, 0] });
          const y = anim[i]!.interpolate({ inputRange: [0, 1], outputRange: [Math.sin(angle) * r, 0] });
          const op = anim[i]!.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 0.6, 0] });
          return (
            <Animated.View key={c} style={{ position: 'absolute', transform: [{ translateX: x }, { translateY: y }], opacity: op }}>
              <View style={{ backgroundColor: t.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: t.line }}><Text style={{ fontWeight: '700', color: t.ink }}>{c}</Text></View>
            </Animated.View>
          );
        })}
      </View>
      <Text style={[s.display, { marginTop: 8 }]}>{tr('intro1Title')}</Text>
      <Text style={[s.body, { color: t.muted, marginTop: 8 }]}>{tr('intro1Body')}</Text>
      {!merged ? <Pressable onPress={merge} style={{ marginTop: 16, alignSelf: rtl ? 'flex-end' : 'flex-start' }}><Text style={s.link}>{tr('intro1Tap')} ›</Text></Pressable>
        : <Text style={[s.small, { color: t.accent, marginTop: 16, fontWeight: '700' }]}>{tr('intro1Done')}</Text>}
    </View>
  );
}

/** Tap what you buy; watch memory form. */
function StepMemory({ rtl }: { rtl: boolean }) {
  const s = S();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (k: string) => { tap(); setPicked((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k])); };
  return (
    <View>
      <Text style={s.display}>{tr('intro2Title')}</Text>
      <Text style={[s.body, { color: t.muted, marginTop: 8, marginBottom: 18 }]}>{tr('intro2Body')}</Text>
      <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 10 }}>
        {STAPLES.map(([g, name]) => {
          const on = picked.includes(name);
          return (
            <Pressable key={name} onPress={() => toggle(name)} style={{ backgroundColor: on ? t.accent : t.card, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: on ? t.accent : t.line, flexDirection: rtl ? 'row-reverse' : 'row', gap: 8, alignItems: 'center' }}>
              <Text style={{ fontSize: 22 }}>{g}</Text><Text style={{ fontWeight: '700', color: on ? '#fff' : t.ink, fontSize: 16 }}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[s.card, { marginTop: 22, backgroundColor: t.accentSoft, opacity: picked.length ? 1 : 0.5 }]}>
        <Text style={[s.small, { color: t.accent, fontWeight: '700' }]}>{tr('intro2Memory')}</Text>
        <Text style={[s.body, { marginTop: 4 }]}>{picked.length ? picked.join(' · ') : tr('intro2Empty')}</Text>
        {picked.length >= 3 ? <Text style={[s.small, { marginTop: 6 }]}>{tr('intro2Usual', { n: picked.length })}</Text> : null}
      </View>
    </View>
  );
}

/** The forgetting check, with a live-looking example. */
function StepForgot({ rtl }: { rtl: boolean }) {
  const s = S();
  const [day, setDay] = useState(2);
  useEffect(() => { const h = setInterval(() => setDay((d) => (d >= 6 ? 0 : d + 1)), 700); return () => clearInterval(h); }, []);
  const due = day >= 4;
  return (
    <View>
      <Text style={s.display}>{tr('intro3Title')}</Text>
      <Text style={[s.body, { color: t.muted, marginTop: 8, marginBottom: 18 }]}>{tr('intro3Body')}</Text>
      <View style={[s.card, { backgroundColor: due ? t.amberSoft : t.card }]}>
        <View style={s.row}>
          <View style={s.rowStart}><Text style={{ fontSize: 28 }}>🥛</Text><Text style={[s.title]}>חלב 3%</Text></View>
          <Text style={[s.price, { color: due ? t.amber : t.ink }]}>{tr('intro3Days', { d: day })}</Text>
        </View>
        <View style={{ height: 6, backgroundColor: '#ECE8DF', borderRadius: 3, marginTop: 12, overflow: 'hidden' }}>
          <View style={{ width: `${Math.min(100, (day / 4) * 100)}%`, height: 6, backgroundColor: due ? t.amber : t.accent, alignSelf: rtl ? 'flex-end' : 'flex-start' }} />
        </View>
        <Text style={[s.small, { marginTop: 8, color: due ? t.amber : t.muted, fontWeight: due ? '700' : '400' }]}>{due ? tr('intro3Due') : tr('intro3Rhythm')}</Text>
      </View>
    </View>
  );
}

/** Three taps, counted. */
function StepThreeTaps({ rtl }: { rtl: boolean }) {
  const s = S();
  const [n, setN] = useState(0);
  const steps = [tr('intro4a'), tr('intro4b'), tr('intro4c')];
  return (
    <View>
      <Text style={s.display}>{tr('intro4Title')}</Text>
      <Text style={[s.body, { color: t.muted, marginTop: 8, marginBottom: 18 }]}>{tr('intro4Body')}</Text>
      {steps.map((label, i) => {
        const done = n > i;
        const active = n === i;
        return (
          <Pressable key={label} disabled={!active} onPress={() => { tap(); setN(i + 1); }}
            style={[s.card, { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 14, borderWidth: 2, borderColor: active ? t.accent : done ? t.accentSoft : t.line, opacity: active || done ? 1 : 0.45 }]}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: done ? t.accent : active ? t.accentSoft : '#F1EEE6', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: done ? '#fff' : t.accent, fontWeight: '800', fontSize: 16 }}>{done ? '✓' : i + 1}</Text>
            </View>
            <Text style={[s.title, { fontSize: 18, flex: 1 }]}>{label}</Text>
          </Pressable>
        );
      })}
      {n === 3 ? <Text style={[s.title, { color: t.accent, textAlign: 'center', marginTop: 8 }]}>{tr('intro4Done')}</Text> : null}
    </View>
  );
}
