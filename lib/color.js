// ─────────────────────────────────────────────────────────────
// Client-side colour maths for the suggestion engine.
//
// Deliberately the SAME model as the backend `ColorService` (see CUSTOM_COLOR.md
// "Base selection"): sRGB → linearise (piecewise transfer) → XYZ (D65) → CIELAB,
// with the standard 6/29 knee. Clustering and harmonies work in CIELAB / LCh
// because that space is ~perceptually uniform — two shades a human reads as "the
// same beige" sit close, and a hue rotation is a perceptual hue rotation, not the
// lopsided one HSL gives.
// ─────────────────────────────────────────────────────────────

// D65 white point, matching config/paint.php on the API side.
const D65 = { X: 0.95047, Y: 1.0, Z: 1.08883 };
const DELTA = 6 / 29;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const srgbToLinear = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const linearToSrgb = (c) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return clamp(Math.round(v * 255), 0, 255);
};

const f = (t) => (t > DELTA * DELTA * DELTA ? Math.cbrt(t) : t / (3 * DELTA * DELTA) + 4 / 29);
const fInv = (t) => (t > DELTA ? t * t * t : 3 * DELTA * DELTA * (t - 4 / 29));

export function rgbToLab({ r, g, b }) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const X = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
  const Y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const Z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;
  const fx = f(X / D65.X);
  const fy = f(Y / D65.Y);
  const fz = f(Z / D65.Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToRgb({ L, a, b }) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const X = D65.X * fInv(fx);
  const Y = D65.Y * fInv(fy);
  const Z = D65.Z * fInv(fz);
  const rl = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
  const gl = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
  const bl = X * 0.0557 + Y * -0.204 + Z * 1.057;
  return { r: linearToSrgb(rl), g: linearToSrgb(gl), b: linearToSrgb(bl) };
}

export function labToLch({ L, a, b }) {
  const C = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

export function lchToLab({ L, C, h }) {
  const r = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(r), b: C * Math.sin(r) };
}

export const hexToLch = (hex) => labToLch(rgbToLab(hexToRgb(hex)));
export const lchToHex = (lch) => rgbToHex(labToRgb(lchToLab(lch)));

/** CIE76 ΔE — plenty for clustering / round-trip checks; ΔE2000 is not needed. */
export function deltaE(a, b) {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}
