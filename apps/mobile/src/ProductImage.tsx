/**
 * A product picture that never shows a broken image.
 *
 * Tries the URL the API found, then Rami Levy's host by barcode, then falls
 * back to the aisle glyph on a soft tile. Sized for the row it sits in.
 */
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { AISLES, aisleOf } from './lib/categories';
import { t } from './ui';

export function ProductImage({ url, gtin, name, size = 44, radius = 10 }: { url?: string | null; gtin?: string; name: string; size?: number; radius?: number }) {
  const candidates = [url, gtin ? `https://img.rami-levy.co.il/product/${gtin}/small.jpg` : undefined].filter((x): x is string => !!x);
  const [i, setI] = useState(0);
  const src = candidates[i];
  const glyph = AISLES.find((a) => a.key === aisleOf(name))?.glyph ?? '🛒';
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#F1EEE6', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      {src ? (
        <Image source={{ uri: src }} style={{ width: size, height: size }} contentFit="cover" transition={150} onError={() => setI((n) => n + 1)} cachePolicy="disk" />
      ) : (
        <Text style={{ fontSize: size * 0.5, color: t.muted }}>{glyph}</Text>
      )}
    </View>
  );
}
