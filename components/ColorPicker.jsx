import { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, PanResponder, StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { API_URL } from '../constants/api';
import { loadRecentColors } from '../constants/recentColors';

// Colour picking for custom-mixed paint.
//
// HSL sliders rather than a wheel: a wheel needs two-axis gesture handling and
// still hides lightness, which is the axis that decides whether a colour reads
// as "sage" or "forest" on a wall. Three labelled strips are also the only
// layout where the preview can stay on screen the whole time.
//
// The preview sits on a NEUTRAL GREY card and is never full-bleed. Simultaneous
// contrast shifts perceived hue hard against a coloured or white surround, and a
// customer judging paint against the wrong background is the cheapest complaint
// there is to prevent. See CUSTOM_COLOR.md.

const RESOLVE_MS = 300;   // debounce before asking the server about a colour

// Seeds for someone with no idea where to start. Deliberately muted — these are
// paint colours, not screen colours.
const PRESETS = [
  '#F5F0E6', '#E8DCC8', '#C8D5C0', '#9AA5B1',
  '#7A1F2B', '#1F3A7A', '#2E5D4B', '#3A3A3A',
];

const HUE_STOPS = ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'];

// ── colour maths ───────────────────────────────────────────────

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function hslToHex(h, s, l) {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n) => {
    const v = lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

export function hexToHsl(hex) {
  const clean = String(hex ?? '').replace('#', '');
  const full  = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l   = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = ((b - r) / d + 2);
    else                h = ((r - g) / d + 4);
    h *= 60;
  }

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const normalizeHex = (text) => {
  const clean = String(text ?? '').trim().replace(/^#/, '');
  const full  = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  return /^[0-9a-fA-F]{6}$/.test(full) ? `#${full.toUpperCase()}` : null;
};

// ── one draggable strip ────────────────────────────────────────

const Strip = memo(function Strip({ colors, ratio, onRatio, label, readout }) {
  const box = useRef({ x: 0, w: 1 });
  const ref = useRef(null);

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, _y, w) => {
      // A zero width means the view has not been laid out yet; keeping the old
      // box avoids a divide-by-zero that would pin every drag to one end.
      if (w > 0) box.current = { x, w };
    });
  }, []);

  // Track the callback in a ref so the PanResponder — created once — never
  // closes over a stale onRatio from an earlier render.
  const onRatioRef = useRef(onRatio);
  onRatioRef.current = onRatio;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: (e) => {
        const { x, w } = box.current;
        onRatioRef.current(clamp((e.nativeEvent.pageX - x) / w, 0, 1));
      },
      onPanResponderMove: (_e, gesture) => {
        const { x, w } = box.current;
        onRatioRef.current(clamp((gesture.moveX - x) / w, 0, 1));
      },
    })
  ).current;

  return (
    <View style={styles.stripBlock}>
      <View style={styles.stripLabelRow}>
        <Text style={styles.stripLabel}>{label}</Text>
        <Text style={styles.stripReadout}>{readout}</Text>
      </View>
      <View
        ref={ref}
        onLayout={measure}
        style={styles.stripTouch}
        {...responder.panHandlers}
      >
        <LinearGradient
          colors={colors}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.strip}
        />
        <View style={[styles.thumb, { left: `${ratio * 100}%` }]} pointerEvents="none" />
      </View>
    </View>
  );
});

// ── the picker ─────────────────────────────────────────────────

export default function ColorPicker({ value, onChange, onResolved }) {
  const [hsl, setHsl]         = useState(() => hexToHsl(value) ?? { h: 210, s: 30, l: 60 });
  const [recents, setRecents] = useState([]);
  const [resolved, setResolved] = useState(null);
  const [checking, setChecking] = useState(false);

  // Non-null only while the hex field is being typed in. Keeping the field's
  // text out of state the rest of the time means nothing has to write it back,
  // which is what let the render loop below form in the first place.
  const [draft, setDraft] = useState(null);

  const hex = hslToHex(hsl.h, hsl.s, hsl.l);

  /**
   * The last hex handed to onChange.
   *
   * This picker and its parent form a cycle: we emit a colour, the parent
   * stores it and hands it straight back as `value`. hexToHsl rounds H, S and
   * L to integers, so hex -> hsl -> hex is NOT lossless — the echo can differ
   * from what we hold, we adopt it, emit a different colour, and round again,
   * forever. React kills it with "Maximum update depth exceeded".
   *
   * Recording what we emitted lets us recognise our own echo and ignore it,
   * so only a genuinely external colour (an AR pick, a reopened screen) is
   * ever adopted.
   */
  const lastEmitted = useRef(normalizeHex(value));

  useEffect(() => {
    const incoming = normalizeHex(value);
    if (!incoming || incoming === lastEmitted.current) return;   // our own echo

    const next = hexToHsl(incoming);
    if (!next) return;

    // Claim it before adopting: the hex we settle on may differ from
    // `incoming` by a rounding step, and that difference must not bounce.
    lastEmitted.current = incoming;
    setHsl(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => { loadRecentColors().then(setRecents); }, []);

  // Ask the server which base this colour needs and whether paint can reach it.
  // Debounced because dragging a strip emits a colour per frame.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);

    const timer = setTimeout(async () => {
      try {
        const res  = await fetch(`${API_URL}/colors/resolve?hex=${encodeURIComponent(hex)}`, {
          headers: { Accept: 'application/json' },
        });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        setResolved(data);
        onResolved?.(data);
      } catch {
        // Offline or the server is down: leave the last answer standing rather
        // than blocking the picker. add-to-cart re-validates server-side anyway.
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, RESOLVE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex]);

  useEffect(() => {
    if (hex === lastEmitted.current) return;
    lastEmitted.current = hex;
    onChange?.(hex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex]);

  const applyHex = (raw) => {
    const norm = normalizeHex(raw);
    if (!norm) return;
    const next = hexToHsl(norm);
    if (next) setHsl(next);
  };

  const unmixable = resolved && resolved.in_gamut === false;

  return (
    <View>
      {/* Preview on a neutral grey card — never full-bleed. */}
      <View style={styles.previewCard}>
        <View style={[styles.previewSwatch, { backgroundColor: hex }]} />
        <View style={styles.previewMeta}>
          {/* Shows the live colour except while being typed in, so dragging a
              strip updates it without an effect writing into state. */}
          <TextInput
            style={styles.hexInput}
            value={draft ?? hex}
            onChangeText={setDraft}
            onEndEditing={(e) => { applyHex(e.nativeEvent.text); setDraft(null); }}
            onSubmitEditing={(e) => { applyHex(e.nativeEvent.text); setDraft(null); }}
            onBlur={() => setDraft(null)}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            placeholder="#RRGGBB"
            placeholderTextColor="#aaa"
          />
          <Text style={styles.previewNote}>
            {checking ? 'Checking…' : unmixable ? 'Cannot be mixed' : 'Can be mixed'}
          </Text>
        </View>
      </View>

      {unmixable && (
        <TouchableOpacity
          style={styles.gamutWarning}
          onPress={() => applyHex(resolved.nearest_mixable)}
          activeOpacity={0.8}
        >
          <Text style={styles.gamutTitle}>Brighter than paint can go</Text>
          <Text style={styles.gamutBody}>
            Screens can show colours that pigment cannot reach. Tap to use the
            closest colour we can actually mix.
          </Text>
          <View style={styles.gamutSwapRow}>
            <View style={[styles.gamutChip, { backgroundColor: hex }]} />
            <Text style={styles.gamutArrow}>→</Text>
            <View style={[styles.gamutChip, { backgroundColor: resolved.nearest_mixable }]} />
            <Text style={styles.gamutHex}>{resolved.nearest_mixable}</Text>
          </View>
        </TouchableOpacity>
      )}

      <Strip
        label="Colour"
        readout={`${hsl.h}°`}
        colors={HUE_STOPS}
        ratio={hsl.h / 360}
        onRatio={(r) => setHsl(v => ({ ...v, h: Math.round(r * 360) }))}
      />

      <Strip
        label="Intensity"
        readout={`${hsl.s}%`}
        colors={[hslToHex(hsl.h, 0, hsl.l), hslToHex(hsl.h, 100, hsl.l)]}
        ratio={hsl.s / 100}
        onRatio={(r) => setHsl(v => ({ ...v, s: Math.round(r * 100) }))}
      />

      <Strip
        label="Lightness"
        readout={`${hsl.l}%`}
        colors={['#000000', hslToHex(hsl.h, hsl.s, 50), '#FFFFFF']}
        ratio={hsl.l / 100}
        onRatio={(r) => setHsl(v => ({ ...v, l: Math.round(r * 100) }))}
      />

      {recents.length > 0 && (
        <Swatches title="Recent" colors={recents} active={hex} onPick={applyHex} />
      )}
      <Swatches title="Popular" colors={PRESETS} active={hex} onPick={applyHex} />

      <Text style={styles.disclaimer}>
        Colours shown on your screen are approximate. Screens vary, so the mixed
        paint may look different in your room.
      </Text>
    </View>
  );
}

function Swatches({ title, colors, active, onPick }) {
  return (
    <View style={styles.swatchBlock}>
      <Text style={styles.stripLabel}>{title}</Text>
      <View style={styles.swatchRow}>
        {colors.map(c => (
          <TouchableOpacity
            key={`${title}-${c}`}
            style={[
              styles.swatch,
              { backgroundColor: c },
              active?.toUpperCase() === c.toUpperCase() && styles.swatchActive,
            ]}
            onPress={() => onPick(c)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Preview — the grey is deliberate, see the header comment.
  previewCard:    { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#8a8a8a', borderRadius: 14, padding: 14, marginBottom: 14 },
  previewSwatch:  { width: 72, height: 72, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.18)' },
  previewMeta:    { flex: 1 },
  hexInput:       { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, fontWeight: '700', color: '#1a1a1a', letterSpacing: 1 },
  previewNote:    { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 6, opacity: 0.9 },

  gamutWarning:   { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fcd34d', borderRadius: 12, padding: 14, marginBottom: 14 },
  gamutTitle:     { fontSize: 14, fontWeight: '700', color: '#92400e', marginBottom: 4 },
  gamutBody:      { fontSize: 13, color: '#92400e', lineHeight: 18 },
  gamutSwapRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  gamutChip:      { width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  gamutArrow:     { color: '#92400e', fontSize: 15, fontWeight: '700' },
  gamutHex:       { color: '#92400e', fontSize: 13, fontWeight: '700', marginLeft: 2 },

  stripBlock:     { marginBottom: 16 },
  stripLabelRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  stripLabel:     { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  stripReadout:   { fontSize: 12, color: '#999', fontWeight: '600' },
  // Generous vertical padding: the strip is 22px but the touch target is not.
  stripTouch:     { paddingVertical: 9, justifyContent: 'center' },
  strip:          { height: 22, borderRadius: 11, borderWidth: 1, borderColor: '#e0e0e0' },
  thumb:          { position: 'absolute', width: 22, height: 30, marginLeft: -11, borderRadius: 7, borderWidth: 3, borderColor: '#fff', backgroundColor: 'transparent', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 },

  swatchBlock:    { marginBottom: 16 },
  swatchRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  swatch:         { width: 40, height: 40, borderRadius: 10, borderWidth: 1.5, borderColor: '#e0e0e0' },
  swatchActive:   { borderColor: '#b91c1c', borderWidth: 3 },

  disclaimer:     { fontSize: 12, color: '#999', lineHeight: 17, marginTop: 2, marginBottom: 4 },
});
