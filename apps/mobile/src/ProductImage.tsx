/**
 * A product picture that never shows a broken image.
 *
 * The aisle glyph is always painted underneath; the photo is layered on top
 * and simply stays transparent until it loads. That way a 404, a slow host
 * or a web renderer that never fires onError all degrade to the same
 * pleasant tile, with no state to get wrong.
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
      <Text style={{ fontSize: size * 0.48, color: t.muted, position: 'absolute' }}>{glyph}</Text>
      {src ? (
        <Image
          source={{ uri: src }}
          style={{ width: size, height: size, position: 'absolute' }}
          contentFit="cover"
          transition={120}
          cachePolicy="disk"
          onError={() => setI((n) => n + 1)}
        />
      ) : null}
    </View>
  );
}
