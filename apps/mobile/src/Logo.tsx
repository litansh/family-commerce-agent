/** The Kanili mark, drawn as vectors so it is crisp at any size and takes any colour. */
import React from 'react';
import Svg, { Defs, Mask, Path, Rect } from 'react-native-svg';

export function Mark({ size = 48, color = '#1F6B45' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <Mask id="tick">
          <Rect width="100" height="100" fill="#fff" />
          <Path d="M37 64 L46.5 73.5 L64 54" fill="none" stroke="#000" strokeWidth="9.5" strokeLinecap="round" strokeLinejoin="round" />
        </Mask>
      </Defs>
      <Path d="M34 38 C34 18 66 18 66 38" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" />
      <Rect x="12" y="36" width="76" height="12" rx="6" fill={color} />
      <Path d="M19 48 H81 C81 48 77.5 74 75.5 84 C74.8 88 71.5 91 67.5 91 H32.5 C28.5 91 25.2 88 24.5 84 C22.5 74 19 48 19 48 Z" fill={color} mask="url(#tick)" />
    </Svg>
  );
}

/** Mark on a green tile, for places the brand needs weight (sign-in, splash). */
export function Tile({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect width="100" height="100" rx="24" fill="#1F6B45" />
      <Defs>
        <Mask id="tick2">
          <Rect width="100" height="100" fill="#fff" />
          <Path d="M39.5 61 L47 68.5 L61 53" fill="none" stroke="#000" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" />
        </Mask>
      </Defs>
      <Path d="M37 40 C37 24 63 24 63 40" fill="none" stroke="#FAF8F3" strokeWidth="7.2" strokeLinecap="round" />
      <Rect x="20" y="38" width="60" height="9.5" rx="4.75" fill="#FAF8F3" />
      <Path d="M25.5 47.5 H74.5 C74.5 47.5 71.7 68 70 76 C69.5 79 67 81.5 64 81.5 H36 C33 81.5 30.5 79 30 76 C28.3 68 25.5 47.5 25.5 47.5 Z" fill="#FAF8F3" mask="url(#tick2)" />
    </Svg>
  );
}
