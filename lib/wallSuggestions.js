// ─────────────────────────────────────────────────────────────
// Wall colour suggestions from a room's anchor colour.
//
// A wall is a BACKDROP, not an accent object, so the raw complement of a sofa is
// usually wrong on a wall — too saturated, too loud. This does not dump wheel
// math; it produces a small LABELLED set, each constrained to ranges walls
// actually wear. Harmonies are done in LCh (perceptual hue), consistent with the
// rest of the colour system.
//
// Every hex here is still passed through the API's /colors/resolve before it
// reaches the user, so the final swatch is a gamut-clamped, mixable colour.
// ─────────────────────────────────────────────────────────────
import { lchToHex, hexToLch } from './color';

// Wall-livable clamps, with reasons:
//  • Chroma capped well below the vivid furniture that seeds it — a wall at C*40
//    already reads as a strong colour; higher is an accent object, not a room.
//  • Lightness held in a comfortable band — mid-to-light for main walls; the
//    single accent colour is allowed to go deeper.
const MAIN_C_CAP = 34;
const ACCENT_C_CAP = 46;
const L_MAIN = [58, 88];
const L_ACCENT = [46, 82];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Curated neutrals for a room with no chromatic anchor — a genuinely greyscale
// room should get designer neutrals, not a hue invented from sensor noise.
const NEUTRAL_FALLBACK = [
  { key: 'warm-white', label: 'Warm White', hex: '#F1EADB' },
  { key: 'greige',     label: 'Greige',     hex: '#D9CFBE' },
  { key: 'soft-grey',  label: 'Soft Grey',  hex: '#CDD1CE' },
  { key: 'taupe',      label: 'Taupe',      hex: '#B7AB99' },
];

function make(key, label, { h, C, L }, accent = false) {
  const cCap = accent ? ACCENT_C_CAP : MAIN_C_CAP;
  const band = accent ? L_ACCENT : L_MAIN;
  const lch = {
    h: ((h % 360) + 360) % 360,
    C: clamp(C, 0, cCap),
    L: clamp(L, band[0], band[1]),
  };
  return { key, label, hex: lchToHex(lch), lch };
}

/**
 * @param {?{lch:{h,C,L}}} anchor  Dominant chromatic room colour, or null.
 * @returns {Array<{key,label,hex,lch}>} 4 labelled wall suggestions.
 */
export function suggestWallColors(anchor) {
  if (!anchor || !anchor.lch) {
    return NEUTRAL_FALLBACK.map((n) => ({ ...n, lch: hexToLch(n.hex) }));
  }

  const { h, C } = anchor.lch;

  return [
    // Anchor hue, almost no chroma, light — a greige/off-white subtly tinted by
    // the room. The safe, best-selling choice.
    make('soft-neutral', 'Soft Neutral', { h, C: Math.min(C * 0.18, 8), L: 86 }),
    // Analogous: shares the room's family, blends rather than contrasts.
    make('harmonious', 'Harmonious', { h: h + 30, C: C * 0.8, L: 74 }),
    // Complementary: the one bold option, for a single accent wall.
    make('bold-accent', 'Bold Accent', { h: h + 180, C, L: 60 }, true),
    // Monochromatic: a lighter wash of the room's own colour.
    make('tonal', 'Tonal', { h, C: C * 0.55, L: 80 }),
  ];
}
