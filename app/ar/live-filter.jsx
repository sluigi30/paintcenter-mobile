// ─────────────────────────────────────────────────────────────────────────
// PHASE 3 — REALISTIC PAINT RECOLOR
// The detected wall is repainted the product's real color, LIVE:
//   • BlendMode.Color takes the paint's hue+saturation but keeps the wall's
//     own luminance → shadows, corners and texture survive (looks painted,
//     not stickered).
//   • The wall mask is blurred so edges are soft, not blocky.
//   • A swatch row lets you switch colors live; the product's hex seeds it.
//   • Strictness slider (from Phase 2) still controls detection tightness.
//
// Model: Final_Wall_Segmentation.tflite (ADE20K-derived, non-commercial, used
// for this capstone with attribution). input & output BOTH uint8 [1,224,224,3];
// 3 classes: 0=bg, 1=wall, 2=ceiling (argmax over the 3).
// ─────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LogBox } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

// Harmless: react-native-skia's <Canvas> logs this on the New Architecture, but
// we render via the frame processor (not <Canvas>), so it doesn't affect us.
LogBox.ignoreLogs(['<Canvas onLayout']);
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useSkiaFrameProcessor,
} from 'react-native-vision-camera';
import { loadTensorflowModel } from 'react-native-fast-tflite';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { Asset } from 'expo-asset';
import {
  Skia,
  AlphaType,
  ColorType,
  BlendMode,
  TileMode,
} from '@shopify/react-native-skia';

const MODEL_W = 224;
const MODEL_H = 224;
const NUM_CLASSES = 3;

// Preset paint colors for the swatch row (product hex is prepended at runtime).
const SWATCHES = [
  '#dc102e', '#2563eb', '#16a34a', '#f59e0b',
  '#7c3aed', '#0891b2', '#be185d', '#111827',
];

const DEFAULT_RGB = { r: 37, g: 99, b: 235 };
function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return DEFAULT_RGB;
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return DEFAULT_RGB;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return DEFAULT_RGB;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Paint used to composite the recolor onto the camera frame:
//  • BlendMode.Color → hue/sat from the paint, luminance from the wall
//  • blur ImageFilter → soft mask edges instead of blocky 224px stair-steps
const recolorPaint = Skia.Paint();
recolorPaint.setBlendMode(BlendMode.Color);
recolorPaint.setImageFilter(Skia.ImageFilter.MakeBlur(3, 3, TileMode.Clamp, null));

export default function LiveFilter() {
  const { hex } = useLocalSearchParams();
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const { resize } = useResizePlugin();

  const [showPaint, setShowPaint] = useState(true);
  const [model, setModel] = useState(undefined);
  const [modelState, setModelState] = useState('loading'); // loading | loaded | error
  const [minConf, setMinConf] = useState(195); // wall-confidence threshold (Phase 2)
  const [color, setColor] = useState(hex ?? '#2563eb');

  const rgb = useMemo(() => hexToRgb(color), [color]);

  // Swatches = product color (if any) first, then the presets.
  const swatches = useMemo(() => {
    const lower = SWATCHES.map((c) => c.toLowerCase());
    if (hex && !lower.includes(String(hex).toLowerCase())) {
      return [String(hex), ...SWATCHES];
    }
    return SWATCHES;
  }, [hex]);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission]);

  // Load the on-device wall model via expo-asset -> file:// URL (fast-tflite's
  // require() path resolves to a broken localhost URL in Expo dev).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const asset = Asset.fromModule(
          require('../../assets/models/wall_seg.tflite'),
        );
        await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        // Try the GPU delegate for much faster inference; fall back to CPU if
        // the device/model doesn't support it.
        let m;
        try {
          m = await loadTensorflowModel({ url: uri }, 'android-gpu');
          console.log('[wall-model] using GPU delegate');
        } catch (gpuErr) {
          console.warn('[wall-model] GPU unavailable, using CPU', gpuErr);
          m = await loadTensorflowModel({ url: uri }, 'default');
        }
        if (!mounted) return;
        setModel(m);
        setModelState('loaded');
      } catch (e) {
        console.error('[wall-model] load failed', e);
        if (mounted) setModelState('error');
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const frameProcessor = useSkiaFrameProcessor(
    (frame) => {
      'worklet';
      frame.render();

      if (model == null || !showPaint) return;

      const input = resize(frame, {
        scale: { width: MODEL_W, height: MODEL_H },
        pixelFormat: 'rgb',
        dataType: 'uint8',
      });

      const outputs = model.runSync([input]);
      const out = outputs[0]; // Uint8Array length 224*224*3

      const pr = rgb.r;
      const pg = rgb.g;
      const pb = rgb.b;
      const rgba = new Uint8Array(MODEL_W * MODEL_H * 4);
      for (let p = 0; p < MODEL_W * MODEL_H; p++) {
        const o = p * NUM_CLASSES;
        const bg = out[o];
        const wall = out[o + 1];
        const ceil = out[o + 2];
        const q = p * 4;
        rgba[q] = pr;
        rgba[q + 1] = pg;
        rgba[q + 2] = pb;
        rgba[q + 3] = wall > bg && wall >= ceil && wall >= minConf ? 255 : 0;
      }

      const data = Skia.Data.fromBytes(rgba);
      const img = Skia.Image.MakeImage(
        {
          width: MODEL_W,
          height: MODEL_H,
          alphaType: AlphaType.Unpremul,
          colorType: ColorType.RGBA_8888,
        },
        data,
        MODEL_W * 4,
      );
      if (img != null) {
        frame.drawImageRect(
          img,
          Skia.XYWHRect(0, 0, MODEL_W, MODEL_H),
          Skia.XYWHRect(0, 0, frame.width, frame.height),
          recolorPaint,
        );
      }
    },
    [model, showPaint, minConf, rgb],
  );

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

  const statusText =
    modelState === 'loading'
      ? 'Loading wall model…'
      : modelState === 'error'
        ? 'Model failed to load'
        : showPaint
          ? 'Point at a wall · tap a color to repaint it'
          : 'Showing real wall (paint hidden)';

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
      />

      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Paint Preview</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.banner}>
        <Text style={styles.bannerText}>{statusText}</Text>
      </View>

      <View style={styles.bottomBar}>
        {/* Color swatches */}
        <View style={styles.swatchRow}>
          {swatches.map((c) => (
            <TouchableOpacity
              key={c}
              onPress={() => setColor(c)}
              style={[
                styles.swatch,
                { backgroundColor: c },
                color.toLowerCase() === c.toLowerCase() && styles.swatchActive,
              ]}
            />
          ))}
        </View>

        {/* Strictness */}
        <View style={styles.stricRow}>
          {[
            { label: 'Off', v: 0 },
            { label: 'Low', v: 120 },
            { label: 'Med', v: 160 },
            { label: 'High', v: 195 },
          ].map((lvl) => (
            <TouchableOpacity
              key={lvl.label}
              style={[styles.stricBtn, minConf === lvl.v && styles.stricBtnActive]}
              onPress={() => setMinConf(lvl.v)}
            >
              <Text style={styles.stricText}>{lvl.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.toggle, showPaint && styles.toggleActive]}
          onPress={() => setShowPaint((v) => !v)}
        >
          <Text style={styles.toggleText}>
            {showPaint ? 'Hide Paint (see real wall)' : 'Show Paint'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#000' },
  msg: { color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 20 },
  btn: { backgroundColor: '#dc102e', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 },
  btnText: { color: '#fff', fontWeight: '600' },

  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 },
  backBtn: { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  backText: { color: '#fff', fontWeight: '600' },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },

  banner: { position: 'absolute', top: 120, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, padding: 12 },
  bannerText: { color: '#fff', fontSize: 13, textAlign: 'center' },

  bottomBar: { position: 'absolute', bottom: 40, left: 16, right: 16 },
  swatchRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  swatch: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' },
  swatchActive: { borderColor: '#fff', borderWidth: 3, transform: [{ scale: 1.12 }] },

  stricRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  stricBtn: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  stricBtnActive: { backgroundColor: '#16a34a' },
  stricText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  toggle: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  toggleActive: { backgroundColor: '#dc102e' },
  toggleText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
