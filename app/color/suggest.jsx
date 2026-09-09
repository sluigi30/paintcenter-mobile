// ─────────────────────────────────────────────────────────────────────────
// COLOUR SUGGESTIONS — capture screen
//
// Point at a room, tap Capture. One frame is segmented with the existing
// wall_seg model; the NON-wall pixels (furniture, decor, floor — the model's
// "bg" class) are sampled and handed to the pure engine in lib/:
//   roomPalette.extractRoomPalette  → dominant room colours + a chromatic anchor
//   wallSuggestions.suggestWallColors → 4 wall-appropriate colours
//
// Deliberately NOT part of live-filter.jsx: that worklet is delicate (mask
// cache, mask lock, gyroscope) and none of it is needed for a one-shot still.
// See COLOR_SUGGESTIONS.md for the design and its honest limitations
// (white-balance skew, floor dominance).
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Camera, useCameraDevice, useCameraPermission, useCameraFormat, useFrameProcessor,
} from 'react-native-vision-camera';
import { loadTensorflowModel } from 'react-native-fast-tflite';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { useSharedValue } from 'react-native-worklets-core';
import { Asset } from 'expo-asset';

import { API_URL } from '../../constants/api';
import { extractRoomPalette } from '../../lib/roomPalette';
import { suggestWallColors } from '../../lib/wallSuggestions';

// Turn a suggested hex into a colour the shop can actually mix. The API's
// gamut rule (CUSTOM_COLOR.md) may pull a colour that is out of the latex gamut
// to the nearest mixable one; if the call fails we keep the raw hex — the order
// flow re-validates server-side regardless, so this is enhancement, not a gate.
async function resolveMixable(hex) {
  try {
    const res = await fetch(`${API_URL}/colors/resolve?hex=${encodeURIComponent(hex)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { hex, adjusted: false };
    const d = await res.json();
    const mix = d.in_gamut ? d.hex : d.nearest_mixable || d.hex;
    return { hex: mix, adjusted: !d.in_gamut };
  } catch {
    return { hex, adjusted: false };
  }
}

const MODEL_W = 224;
const MODEL_H = 224;
// Sample every Nth model pixel. A palette needs a few thousand points, not all
// 50k — this keeps the one-shot worklet cheap while staying representative.
const SAMPLE_STRIDE = 8;
// The model sees an upright room best (AR_PAINT_PREVIEW.md), which sharpens the
// wall/bg split we depend on. Colours themselves are rotation-independent.
const MODEL_ROTATION = '90deg';

export default function ColorSuggest() {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const { resize } = useResizePlugin();

  const format = useCameraFormat(device, [
    { videoResolution: { width: 1280, height: 720 } },
    { fps: 30 },
  ]);

  const [model, setModel] = useState(null);
  const [modelState, setModelState] = useState('loading'); // loading | loaded | error
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { palette, anchor, suggestions }

  // Cross-thread handoff. The worklet consumes `captureReq` and writes sampled
  // RGB into `captureOut`; JS polls `captureOut` for the id it asked for.
  const captureReq = useSharedValue(null);
  const captureOut = useSharedValue(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission]);

  // Load the wall model (expo-asset → file:// URL; see live-filter for why).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const asset = Asset.fromModule(require('../../assets/models/wall_seg.tflite'));
        await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        let m;
        try {
          m = await loadTensorflowModel({ url: uri }, 'android-gpu');
        } catch {
          m = await loadTensorflowModel({ url: uri }, 'default');
        }
        if (!mounted) return;
        setModel(m);
        setModelState('loaded');
      } catch (e) {
        console.error('[suggest] model load failed', e);
        if (mounted) setModelState('error');
      }
    })();
    return () => { mounted = false; };
  }, []);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    const req = captureReq.value;
    if (model == null || req == null) return;
    captureReq.value = null; // consume — process exactly one frame per request

    const input = resize(frame, {
      crop: { x: 0, y: 0, width: frame.width, height: frame.height },
      scale: { width: MODEL_W, height: MODEL_H },
      rotation: MODEL_ROTATION,
      pixelFormat: 'rgb',
      dataType: 'uint8',
    });
    const out = model.runSync([input])[0]; // uint8 [1,224,224,3] class scores

    // Sample the bg class (argmax over bg/wall/ceiling == bg): everything the
    // model does not call wall or ceiling — i.e. the room's contents.
    const N = MODEL_W * MODEL_H;
    const flat = [];
    for (let p = 0; p < N; p += SAMPLE_STRIDE) {
      const o = p * 3;
      const bg = out[o], wall = out[o + 1], ceil = out[o + 2];
      if (bg >= wall && bg >= ceil) {
        flat.push(input[o], input[o + 1], input[o + 2]);
      }
    }
    captureOut.value = { id: req.id, samples: flat };
  }, [model, captureReq, captureOut]);

  const capture = () => {
    if (busy || modelState !== 'loaded') return;
    setBusy(true);
    setError(null);
    setResult(null);

    const id = ++reqId.current;
    captureReq.value = { id };

    const started = Date.now();
    const poll = setInterval(() => {
      const out = captureOut.value;
      if (out && out.id === id) {
        clearInterval(poll);
        finish(out.samples);
      } else if (Date.now() - started > 4000) {
        clearInterval(poll);
        setBusy(false);
        setError('Could not read the room — try again in better light.');
      }
    }, 120);
  };

  const finish = async (flat) => {
    const samples = [];
    for (let i = 0; i + 2 < flat.length; i += 3) {
      samples.push({ r: flat[i], g: flat[i + 1], b: flat[i + 2] });
    }
    if (samples.length < 40) {
      setBusy(false);
      setError('Point at more of the room (furniture, floor) and capture again.');
      return;
    }
    const room = extractRoomPalette(samples);
    // Gamut-clamp every suggestion so each swatch is guaranteed mixable.
    const suggestions = await Promise.all(
      suggestWallColors(room.anchor).map(async (s) => {
        const r = await resolveMixable(s.hex);
        return { ...s, hex: r.hex, adjusted: r.adjusted };
      }),
    );
    setResult({ palette: room.palette, anchor: room.anchor, suggestions });
    setBusy(false);
  };

  const preview = (hex) =>
    router.push({ pathname: '/ar/live-filter', params: { hex } });

  const order = (hex) =>
    router.push({ pathname: '/color/order', params: { hex } });

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>Camera permission is required.</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (device == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>No camera device found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={true}
        frameProcessor={frameProcessor}
      />

      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Colour Suggestions</Text>
        <View style={{ width: 60 }} />
      </View>

      {!result && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {modelState === 'loading'
              ? 'Loading…'
              : modelState === 'error'
                ? 'Model failed to load'
                : 'Point at your room — include the furniture — then Capture'}
          </Text>
        </View>
      )}

      {/* Result sheet */}
      {result && (
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.sheetInner}>
            <Text style={styles.sheetHeading}>Colours in your room</Text>
            <View style={styles.paletteRow}>
              {result.palette.map((c, i) => (
                <View key={i} style={styles.paletteItem}>
                  <View style={[styles.paletteSwatch, { backgroundColor: c.hex }]} />
                  <Text style={styles.paletteShare}>{Math.round(c.share * 100)}%</Text>
                </View>
              ))}
            </View>

            <Text style={styles.sheetHeading}>Suggested wall colours</Text>
            {!result.anchor && (
              <Text style={styles.note}>
                Your room reads mostly neutral — here are versatile go-with-anything shades.
              </Text>
            )}
            {result.suggestions.map((s) => (
              <View key={s.key} style={styles.suggestRow}>
                <TouchableOpacity
                  style={styles.suggestMain}
                  onPress={() => preview(s.hex)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.suggestSwatch, { backgroundColor: s.hex }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.suggestLabel}>{s.label}</Text>
                    <Text style={styles.suggestHex}>
                      {s.hex.toUpperCase()}{s.adjusted ? '  · nearest mixable' : ''}
                    </Text>
                    <Text style={styles.suggestPreviewHint}>Tap to preview on your wall</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={styles.orderBtn} onPress={() => order(s.hex)} activeOpacity={0.85}>
                  <Text style={styles.orderBtnText}>Order</Text>
                </TouchableOpacity>
              </View>
            ))}

            <Text style={styles.disclaimer}>
              Colours are read from your camera, so room lighting can shift them. Tap one to
              preview it on your wall.
            </Text>

            <TouchableOpacity style={styles.retake} onPress={() => setResult(null)}>
              <Ionicons name="camera-reverse-outline" size={18} color="#fff" />
              <Text style={styles.retakeText}>Retake</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* Capture button */}
      {!result && (
        <View style={styles.captureBar}>
          {error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity
            style={[styles.capture, (busy || modelState !== 'loaded') && styles.captureDisabled]}
            onPress={capture}
            disabled={busy || modelState !== 'loaded'}
            activeOpacity={0.85}
          >
            {busy
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Ionicons name="color-palette-outline" size={20} color="#fff" />
                  <Text style={styles.captureText}>Capture &amp; suggest</Text>
                </>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#000' },
  msg: { color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 20 },
  btn: { backgroundColor: '#b91c1c', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 },
  btnText: { color: '#fff', fontWeight: '600' },

  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 },
  backBtn: { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  backText: { color: '#fff', fontWeight: '600' },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },

  banner: { position: 'absolute', top: 120, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, padding: 12 },
  bannerText: { color: '#fff', fontSize: 13, textAlign: 'center' },

  captureBar: { position: 'absolute', bottom: 44, left: 16, right: 16, alignItems: 'center' },
  error: { color: '#fecaca', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, marginBottom: 12, textAlign: 'center' },
  capture: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#b91c1c', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 28, alignSelf: 'stretch',
  },
  captureDisabled: { backgroundColor: 'rgba(185,28,28,0.5)' },
  captureText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '72%',
    backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22,
  },
  sheetInner: { padding: 22, paddingBottom: 34 },
  sheetHeading: { fontSize: 13, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 8, marginBottom: 12 },

  // Neutral grey card behind swatches — CUSTOM_COLOR.md's simultaneous-contrast
  // rule: a swatch is misjudged against a coloured or white surround.
  paletteRow: { flexDirection: 'row', gap: 12, backgroundColor: '#e9e9e9', borderRadius: 14, padding: 14 },
  paletteItem: { alignItems: 'center', gap: 6 },
  paletteSwatch: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' },
  paletteShare: { fontSize: 11, color: '#6b7280', fontWeight: '600' },

  note: { fontSize: 13, color: '#6b7280', marginBottom: 12, lineHeight: 18 },
  suggestRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#e9e9e9', borderRadius: 14, padding: 12, marginBottom: 10,
  },
  suggestMain: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  suggestSwatch: { width: 52, height: 52, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' },
  suggestLabel: { fontSize: 15.5, fontWeight: '700', color: '#1a1a1a' },
  suggestHex: { fontSize: 12.5, color: '#6b7280', marginTop: 2, fontVariant: ['tabular-nums'] },
  suggestPreviewHint: { fontSize: 11, color: '#9ca3af', marginTop: 3 },
  orderBtn: { backgroundColor: '#b91c1c', borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16 },
  orderBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  disclaimer: { fontSize: 12, color: '#9ca3af', lineHeight: 17, marginTop: 6, marginBottom: 18 },
  retake: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#374151', borderRadius: 14, paddingVertical: 14,
  },
  retakeText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
