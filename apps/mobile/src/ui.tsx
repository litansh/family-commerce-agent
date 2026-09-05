import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

export const c = {
  bg: '#f7f7f5', card: '#ffffff', text: '#1a1a1a', muted: '#6b6b6b', line: '#e6e6e2',
  accent: '#1d6f42', accentText: '#ffffff', warn: '#b8860b', danger: '#b23a3a', good: '#1d6f42',
};

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  pad: { padding: 16 },
  h1: { fontSize: 26, fontWeight: '700', color: c.text, marginBottom: 4, textAlign: 'right' },
  h2: { fontSize: 18, fontWeight: '600', color: c.text, marginBottom: 8, textAlign: 'right' },
  p: { fontSize: 15, color: c.text, textAlign: 'right', lineHeight: 22 },
  muted: { fontSize: 13, color: c.muted, textAlign: 'right' },
  card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.line },
  row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 10, padding: 12, fontSize: 16, textAlign: 'right', color: c.text },
  btn: { backgroundColor: c.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  btnText: { color: c.accentText, fontSize: 16, fontWeight: '600' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.line },
  btnGhostText: { color: c.text },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#eef4ef', alignSelf: 'flex-end', marginTop: 4 },
  pillText: { fontSize: 12, color: c.accent },
});

export const Button = ({ title, onPress, ghost, disabled }: { title: string; onPress: () => void; ghost?: boolean; disabled?: boolean }) => (
  <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [s.btn, ghost && s.btnGhost, (pressed || disabled) && { opacity: 0.6 }]}>
    <Text style={[s.btnText, ghost && s.btnGhostText]}>{title}</Text>
  </Pressable>
);

export const Input = (p: TextInputProps) => <TextInput placeholderTextColor={c.muted} {...p} style={[s.input, p.style]} />;

export const Loading = ({ label }: { label?: string }) => (
  <View style={[s.pad, { alignItems: 'center', paddingTop: 40 }]}>
    <ActivityIndicator color={c.accent} />
    {label ? <Text style={[s.muted, { marginTop: 10, textAlign: 'center' }]}>{label}</Text> : null}
  </View>
);

export const Pill = ({ text, color }: { text: string; color?: string }) => (
  <View style={[s.pill, color ? { backgroundColor: color + '22' } : null]}>
    <Text style={[s.pillText, color ? { color } : null]}>{text}</Text>
  </View>
);
