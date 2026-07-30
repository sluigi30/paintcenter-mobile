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
  useCameraFormat,
  useSkiaFrameProcessor,
} from 'react-native-vision-camera';
import { loadTensorflowModel } from 'react-native-fast-tflite';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { useSharedValue } from 'react-native-worklets-core';
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

// Both models take the SAME uint8 [1,224,224,3] input, so they are drop-in
// swappable. They differ entirely in what they return (verified on device):
//
//  seg3    out [1,224,224,3] uint8 - three per-pixel class SCORES
//                                    (bg / wall / ceiling), so `minConf`
//                                    thresholding works.
//  ade20k  out [1,56,56]     uint8 - a single per-pixel CLASS INDEX with argmax
//                                    already baked in. ~150 ADE20K classes, so
//                                    furniture exclusion is implicit: a sofa
//                                    simply is not the wall index. But the mask
//                                    is 4x coarser and there is no confidence
//                                    to threshold.
const MODELS = {
  seg3: {
    label: '3-class',
    maskW: 224,
    maskH: 224,
    kind: 'scores3',
  },
  ade20k: {
    label: 'ADE20K',
    maskW: 56,
    maskH: 56,
    kind: 'classes',
  },
};

// Which class index means "wall" in the ADE20K model. MEASURED, not assumed:
// pointed at a wall, the histogram came back
//   hist=1:2013 27:682 8:264 12:73 3:52 39:27 of=3136
// i.e. class 1 covers 57-79% of the frame. So the export is 1-based with 0 as
// background/unlabelled, matching ADE20K's official list where wall is #1.
// (Guessing 0 first produced wallPx=0 and no paint at all.)
const ADE_WALL_IDX = 1;

// ── PHASE 1 PROFILING ────────────────────────────────────────────────────
// Set false to silence. Logs ONE compact line per frame; at the current ~1fps
// that's ~1 log/sec, so the logging overhead is negligible relative to the
// stages being measured. Read with:
//   adb logcat -s ReactNativeJS:V | Select-String PROF
// Columns are milliseconds:
//   res=resize  inf=model.runSync  mask=argmax loop  img=Skia.Data+MakeImage
//   draw=drawImageRect  tot=whole frame processor   dim=camera frame size
const PROFILE = true;

// Log the cached (composite-only) frames too. Off by default: they are ~5x more
// numerous than refresh frames and now reliably boring (tot ~0.3 ms), and the
// volume rolled the logcat ring buffer fast enough to evict the startup lines —
// the model-signature logs were being lost before they could be read.
const PROFILE_CACHED = false;

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

// Same composite WITHOUT the blur ImageFilter.
// (Profiled 2026-07-30: the blur costs 0.26 ms — it is NOT a bottleneck.)
const recolorPaintNoBlur = Skia.Paint();
recolorPaintNoBlur.setBlendMode(BlendMode.Color);

// ── PASS 2: LUMINANCE CORRECTION ─────────────────────────────────────────
// BlendMode.Color keeps the DESTINATION's luminance, so a dark paint on a light
// wall came out far too light — brown rendered as salmon pink. Pass 2 rescales
// luminance inside the mask so the region's MEAN luminance lands on the paint's
// own luminance, while preserving the wall's relative shading (shadows, texture,
// corner falloff) rather than flattening it.
//
// Multiply darkens: L' = L_wall * (L_paint / L_ref)  → mean becomes L_paint
// Screen lightens:  L' = 1-(1-L_wall)(1-s), s = 1-(1-L_paint)/(1-L_ref)
// Both are relative (ratio-preserving), which is why texture survives. Scaling
// all three channels equally also leaves hue and saturation untouched, so
// pass 1's colour is preserved.
function makeLumPaint(mode, blur) {
  const p = Skia.Paint();
  p.setBlendMode(mode);
  // Must match pass 1's edge softness, or the luminance shift gets a hard edge
  // where the colour is soft.
  if (blur) p.setImageFilter(Skia.ImageFilter.MakeBlur(3, 3, TileMode.Clamp, null));
  return p;
}
const lumMultiply = makeLumPaint(BlendMode.Multiply, true);
const lumMultiplyNoBlur = makeLumPaint(BlendMode.Multiply, false);
const lumScreen = makeLumPaint(BlendMode.Screen, true);
const lumScreenNoBlur = makeLumPaint(BlendMode.Screen, false);

// Luma weights from the W3C compositing spec — the same ones Skia's
// non-separable Color/Luminosity blend modes use, so pass 1 and pass 2 agree
// on what "luminance" means.
const LR = 0.3, LG = 0.59, LB = 0.11;

// Luminance the correction is allowed to aim for. Outside this band the
// Multiply/Screen factor saturates and flattens all wall shading — see the
// Ltarget clamp in the frame processor.
const LUM_MIN = 0.1;
const LUM_MAX = 0.85;

// ── PHASE 2: MASK CACHE ──────────────────────────────────────────────────
// Profiled: inference is 80% of frame time (52 ms of 70 ms) and the mask loop
// another 20 ms, while the composite is only ~2 ms. A wall does not move, so
// re-segmenting every frame is wasted work. Instead the mask is kept and
// re-composited every frame, and only refreshed every INFER_MS.
//
// Result: most frames cost ~2 ms and the preview runs at full camera rate,
// with one ~75 ms frame whenever the mask refreshes. NOTE this does not make
// the stall disappear — inference is still synchronous on the frame it runs on,
// so there is a hitch at 1/INFER_MS Hz. Removing it entirely needs inference on
// a separate thread (the runAsync route that previously hit the
// worklets-core/reanimated conflict).
const INFER_INTERVALS = [
  { label: 'Every frame', v: 0 },
  { label: '8 Hz', v: 125 },
  { label: '5 Hz', v: 200 },
  { label: '2 Hz', v: 500 },
];

export default function LiveFilter() {
  const { hex } = useLocalSearchParams();
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const { resize } = useResizePlugin();

  // Without an explicit format VisionCamera handed us 640x480 (measured), which
  // is then upscaled to a ~1080p screen — hence the soft preview. Profiling shows
  // the frame-resolution-dependent stages are nearly free (render 0.0 ms, draw
  // ~1 ms, resize ~1.2 ms), so there is ample headroom to ask for 720p.
  // This sharpens the visible preview AND gives the resize plugin more detail to
  // downsample from. It does NOT improve mask resolution — that is fixed by the
  // model's 224x224 input, and is a separate piece of work.
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1280, height: 720 } },
    { fps: 30 },
  ]);

  const [showPaint, setShowPaint] = useState(true);
  const [model, setModel] = useState(undefined);
  const [modelState, setModelState] = useState('loading'); // loading | loaded | error
  const [minConf, setMinConf] = useState(195); // wall-confidence threshold (Phase 2)
  const [color, setColor] = useState(hex ?? '#2563eb');

  // How strongly to pull the painted region's luminance onto the paint's own
  // lightness. 0 = old behaviour (wall luminance kept, so dark paints read far
  // too light); 1 = the region's mean luminance matches the paint exactly.
  const [lumStrength, setLumStrength] = useState(1);

  // How often the mask is re-segmented (ms). 0 = every frame (old behaviour).
  const [inferMs, setInferMs] = useState(200);

  // Which segmentation model backs the mask. See MODELS.
  // `modelKey` is the SELECTION; `activeCfg` describes the model actually loaded.
  // They must be read separately: loading is async, so deriving the mask geometry
  // from the selection made one frame decode seg3's 150528 score bytes as a
  // 56x56 class map (observed: hist=0:638 1:593 255:374 while activeModel=seg3).
  // activeCfg is only ever set together with the model it describes.
  const [modelKey, setModelKey] = useState('seg3');
  const [activeCfg, setActiveCfg] = useState(MODELS.seg3);
  const maskW = activeCfg.maskW;
  const maskH = activeCfg.maskH;
  const maskKind = activeCfg.kind;

  // Feed the model the whole frame rather than the plugin's implicit centre-crop.
  // false reproduces the old (misaligned) behaviour for comparison.
  const [fullFrameCrop, setFullFrameCrop] = useState(true);

  // Phase 1 profiling isolation switches (see PROFILE above).
  const [useBlur, setUseBlur] = useState(true);       // blur ImageFilter on the composite
  const [doComposite, setDoComposite] = useState(true); // run inference but skip the draw

  // Survives both re-renders and frame-processor rebuilds, and is readable from
  // the worklet thread — holds the last mask so most frames can skip inference.
  const maskCache = useSharedValue(null);

  const rgb = useMemo(() => hexToRgb(color), [color]);

  // Everything baked into the mask IMAGE. When any of it changes the cache must
  // be rebuilt even if INFER_MS has not elapsed, or you would keep seeing the
  // mask from the previous colour.
  // NB must come after `rgb` — reading it earlier gave "Cannot read property 'r'
  // of undefined" (Hermes compiles const to var, so the TDZ surfaces as
  // undefined rather than a ReferenceError).
  const cacheKey = `${modelKey},${rgb.r},${rgb.g},${rgb.b},${minConf},${lumStrength}`;

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
    setModel(undefined);
    setModelState('loading');
    (async () => {
      try {
        // `require` must be a literal path, so both are listed explicitly.
        const asset = Asset.fromModule(
          modelKey === 'ade20k'
            ? require('../../assets/models/wall_ade20k.tflite')
            : require('../../assets/models/wall_seg.tflite'),
        );
        await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        // Try the GPU delegate for much faster inference; fall back to CPU if
        // the device/model doesn't support it. Measured on the Redmi: GPU fails
        // with "Failed to create TFLite interpreter", so this always lands on CPU.
        let m;
        try {
          m = await loadTensorflowModel({ url: uri }, 'android-gpu');
          console.log('PROF delegate=android-gpu');
        } catch (gpuErr) {
          console.warn('PROF delegate=cpu-fallback reason=' + String(gpuErr));
          m = await loadTensorflowModel({ url: uri }, 'default');
        }
        if (!mounted) return;
        // Set together, always: the geometry must describe THIS model.
        setActiveCfg(MODELS[modelKey]);
        setModel(m);
        setModelState('loaded');
        console.log(
          `PROF activeModel=${modelKey} in=` + JSON.stringify(m.inputs) +
          ' out=' + JSON.stringify(m.outputs),
        );
      } catch (e) {
        console.error('[wall-model] load failed', e);
        if (mounted) setModelState('error');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [modelKey]);

  const frameProcessor = useSkiaFrameProcessor(
    (frame) => {
      'worklet';
      // performance.now() if the worklet runtime exposes it, else Date.now().
      // Defined inline (not a captured helper) to avoid nested-worklet issues.
      const P = global.performance;
      const mark = () => (P && P.now ? P.now() : Date.now());

      const tStart = mark();
      frame.render();
      const tRender = mark();

      if (model == null || !showPaint) {
        if (PROFILE) {
          console.log(
            `PROF idle render=${(tRender - tStart).toFixed(1)} dim=${frame.width}x${frame.height}`,
          );
        }
        return;
      }

      // Reuse the cached mask unless it is missing, built for different settings,
      // or older than INFER_MS. Anything that changes the mask IMAGE (colour,
      // strictness, luminance strength) is folded into cacheKey, so switching
      // colour refreshes immediately instead of showing the old one.
      const cached = maskCache.value;
      const isStale = cached == null || cached.key !== cacheKey;
      const doInfer = isStale || inferMs === 0 || tStart - cached.t >= inferMs;

      if (!doInfer) {
        let tDrawnFrom = mark();
        if (doComposite && cached.img != null) {
          const src = Skia.XYWHRect(0, 0, cached.maskW, cached.maskH);
          const dst = Skia.XYWHRect(0, 0, frame.width, frame.height);
          if (cached.lumImg != null) {
            const lp = cached.screen
              ? (useBlur ? lumScreen : lumScreenNoBlur)
              : (useBlur ? lumMultiply : lumMultiplyNoBlur);
            frame.drawImageRect(cached.lumImg, src, dst, lp);
          }
          frame.drawImageRect(
            cached.img, src, dst, useBlur ? recolorPaint : recolorPaintNoBlur,
          );
        }
        if (PROFILE && PROFILE_CACHED) {
          const tEnd = mark();
          console.log(
            `PROF cached render=${(tRender - tStart).toFixed(1)} ` +
              `draw=${(tEnd - tDrawnFrom).toFixed(1)} tot=${(tEnd - tStart).toFixed(1)} ` +
              `age=${(tStart - cached.t).toFixed(0)}`,
          );
        }
        return;
      }

      // `crop` MUST be given explicitly. Left unset, the resize plugin
      // center-crops the frame to the TARGET aspect ratio before scaling — so a
      // 1280x720 frame scaled to 224x224 was silently cropped to the middle
      // 720x720, discarding 44% of the frame width. The resulting mask covered
      // only that centre square, yet it was drawn across the full frame
      // (dst = 0,0,frame.width,frame.height), stretching it ~1.78x on one axis
      // and misaligning it progressively away from centre.
      //
      // Passing the full frame instead means the mask maps 1:1 onto what is
      // displayed. The cost is that the model now sees a non-square-squashed
      // image; the alternative (keep the centre crop, draw the mask only over
      // that region) is geometrically clean but leaves the edges of the preview
      // unpainted, which reads as broken.
      const input = resize(frame, {
        crop: fullFrameCrop
          ? { x: 0, y: 0, width: frame.width, height: frame.height }
          : undefined,
        scale: { width: MODEL_W, height: MODEL_H },
        pixelFormat: 'rgb',
        dataType: 'uint8',
      });
      const tResize = mark();

      const outputs = model.runSync([input]);
      const out = outputs[0]; // Uint8Array length 224*224*3
      const tInfer = mark();

      const pr = rgb.r;
      const pg = rgb.g;
      const pb = rgb.b;
      const isClasses = maskKind === 'classes';
      const N = maskW * maskH;
      // The mask may be coarser than the 224x224 input (56x56 for ADE20K), so
      // mask pixel -> input pixel needs scaling to read the wall's luminance.
      const step = MODEL_W / maskW;

      // Which classes the model actually returns. Only needed once, to find the
      // wall index — see ADE_WALL_IDX.
      if (PROFILE && isClasses) {
        const hist = new Uint32Array(256);
        for (let p = 0; p < N; p++) hist[out[p]]++;
        let top = '';
        for (let k = 0; k < 6; k++) {
          let bi = -1;
          let bv = 0;
          for (let c = 0; c < 256; c++) {
            if (hist[c] > bv) { bv = hist[c]; bi = c; }
          }
          if (bi < 0) break;
          top += (k ? ' ' : '') + bi + ':' + bv;
          hist[bi] = 0;
        }
        console.log(`PROF hist=${top} of=${N}`);
      }

      // Pre-pass: mean luminance of the wall region, read from `input` (the camera
      // frame already downscaled to model size). Subsampled every 8th mask pixel —
      // a mean does not need every pixel, and this keeps the cost trivial.
      let lumSum = 0;
      let lumN = 0;
      for (let p = 0; p < N; p += 8) {
        let isWall;
        if (isClasses) {
          isWall = out[p] === ADE_WALL_IDX;
        } else {
          const o = p * NUM_CLASSES;
          isWall = out[o + 1] > out[o] && out[o + 1] >= out[o + 2] && out[o + 1] >= minConf;
        }
        if (isWall) {
          const mx = p % maskW;
          const my = (p / maskW) | 0;
          const i3 = (((my * step) | 0) * MODEL_W + ((mx * step) | 0)) * 3;
          lumSum += LR * input[i3] + LG * input[i3 + 1] + LB * input[i3 + 2];
          lumN++;
        }
      }

      // Grey level for pass 2, and which blend reaches the target luminance.
      const Lpaint = (LR * pr + LG * pg + LB * pb) / 255;
      // Clamp the TARGET away from pure black/white. At Lpaint=1 the screen
      // factor becomes 1.0, which forces every pixel to pure white and destroys
      // all shading (observed on device: white paint went flat, textureless
      // white). Symmetrically, near-black paint would crush to flat black. Real
      // paint never reaches either extreme under real light — a white wall still
      // has shadows — so aiming slightly inside the range is both safer and more
      // physically honest.
      const Ltarget = Math.max(LUM_MIN, Math.min(LUM_MAX, Lpaint));
      let greyVal = -1; // -1 => skip pass 2
      let useScreen = false;
      let LrefDbg = -1;
      let lrefEma = cached != null ? cached.lrefEma : undefined;
      if (lumN > 0 && lumStrength > 0) {
        const LrefRaw = lumSum / lumN / 255;
        // Smooth Lref over time. Measured raw, it swung 0.486 -> 0.707 between
        // consecutive refreshes as the camera's auto-exposure hunted, which moved
        // `grey` from 232 to 159 and made the painted wall visibly pulse at the
        // refresh rate. The wall's real lightness does not change that fast, so
        // the variation is measurement noise and belongs smoothed away.
        // Carried across colour changes on purpose: Lref describes the WALL, not
        // the paint, so switching swatches should not restart the average.
        lrefEma = lrefEma == null ? LrefRaw : lrefEma * 0.75 + LrefRaw * 0.25;
        const Lref = lrefEma;
        LrefDbg = Lref;
        let g;
        if (Ltarget <= Lref) {
          g = Lref > 0.004 ? Ltarget / Lref : 1;
          g = 1 + (g - 1) * lumStrength; // lerp toward a no-op multiply (1.0)
        } else {
          const denom = 1 - Lref;
          g = denom > 0.004 ? 1 - (1 - Ltarget) / denom : 0;
          g = g * lumStrength; // lerp toward a no-op screen (0.0)
          useScreen = true;
        }
        greyVal = Math.max(0, Math.min(255, Math.round(g * 255)));
      }

      const rgba = new Uint8Array(N * 4);
      const lumRgba = greyVal >= 0 ? new Uint8Array(N * 4) : null;
      for (let p = 0; p < N; p++) {
        let a;
        if (isClasses) {
          a = out[p] === ADE_WALL_IDX ? 255 : 0;
        } else {
          const o = p * NUM_CLASSES;
          const bg = out[o];
          const wall = out[o + 1];
          const ceil = out[o + 2];
          a = wall > bg && wall >= ceil && wall >= minConf ? 255 : 0;
        }
        const q = p * 4;
        rgba[q] = pr;
        rgba[q + 1] = pg;
        rgba[q + 2] = pb;
        rgba[q + 3] = a;
        if (lumRgba !== null) {
          lumRgba[q] = greyVal;
          lumRgba[q + 1] = greyVal;
          lumRgba[q + 2] = greyVal;
          lumRgba[q + 3] = a;
        }
      }
      const tMask = mark();

      const imgInfo = {
        width: maskW,
        height: maskH,
        alphaType: AlphaType.Unpremul,
        colorType: ColorType.RGBA_8888,
      };
      const data = Skia.Data.fromBytes(rgba);
      const img = Skia.Image.MakeImage(imgInfo, data, maskW * 4);
      let lumData = null;
      let lumImg = null;
      if (lumRgba !== null) {
        lumData = Skia.Data.fromBytes(lumRgba);
        lumImg = Skia.Image.MakeImage(imgInfo, lumData, maskW * 4);
      }
      const tImg = mark();

      // Free the entry we are replacing. It is at least one refresh interval
      // (>=125 ms) old, so every draw that referenced it has long since flushed —
      // disposing here is safe, unlike disposing an image drawn on this same frame.
      // Leaving them to the GC instead leaked: native Skia buffers are invisible
      // to JS heap pressure, so nothing triggered collection and the app was
      // killed after a while at 5-8 Hz.
      const prev = maskCache.value;
      if (prev != null) {
        if (prev.img != null && prev.img.dispose) prev.img.dispose();
        if (prev.data != null && prev.data.dispose) prev.data.dispose();
        if (prev.lumImg != null && prev.lumImg.dispose) prev.lumImg.dispose();
        if (prev.lumData != null && prev.lumData.dispose) prev.lumData.dispose();
      }

      maskCache.value = {
        img,
        data,
        lumImg,
        lumData,
        screen: useScreen,
        key: cacheKey,
        t: tStart,
        lrefEma,
        maskW,
        maskH,
      };

      if (img != null && doComposite) {
        const src = Skia.XYWHRect(0, 0, maskW, maskH);
        const dst = Skia.XYWHRect(0, 0, frame.width, frame.height);
        // ORDER MATTERS. Luminance is corrected on the RAW WALL first, and the
        // colour is applied last.
        //
        // Doing colour first and luminance second desaturated the result: Screen
        // (1-(1-dst)(1-src)) compresses toward white, so it washed out the
        // saturation pass 1 had just established — measured on device, brown
        // (Lref 0.318 -> Ltgt 0.441, grey 46) came out salmon, which is exactly
        // a lightened, desaturated brown.
        //
        // In this order the desaturation lands on the bare wall, where it is
        // irrelevant: BlendMode.Color then takes hue AND saturation from the
        // paint and only luminance from the wall. So the final pixel gets the
        // paint's full saturation and the corrected luminance, while the wall's
        // relative shading survives because Multiply/Screen are ratio-based.
        if (lumImg != null) {
          const lp = useScreen
            ? (useBlur ? lumScreen : lumScreenNoBlur)
            : (useBlur ? lumMultiply : lumMultiplyNoBlur);
          frame.drawImageRect(lumImg, src, dst, lp);
        }
        frame.drawImageRect(img, src, dst, useBlur ? recolorPaint : recolorPaintNoBlur);
      }
      const tDraw = mark();

      if (PROFILE) {
        console.log(
          `PROF render=${(tRender - tStart).toFixed(1)} res=${(tResize - tRender).toFixed(1)} ` +
            `inf=${(tInfer - tResize).toFixed(1)} mask=${(tMask - tInfer).toFixed(1)} ` +
            `img=${(tImg - tMask).toFixed(1)} draw=${(tDraw - tImg).toFixed(1)} ` +
            `tot=${(tDraw - tStart).toFixed(1)} ` +
            `dim=${frame.width}x${frame.height} orient=${frame.orientation} ` +
            `mirror=${frame.isMirrored ? 1 : 0} outLen=${out.length} ` +
            `blur=${useBlur ? 1 : 0} comp=${doComposite ? 1 : 0} ` +
            // Luminance-correction internals: Lref = measured mean luminance of
            // the wall region, Lpaint = the paint's own luminance, Ltgt = after
            // the safety clamp, grey/screen = what pass 2 actually drew.
            `Lref=${LrefDbg.toFixed(3)} Lpaint=${Lpaint.toFixed(3)} ` +
            `Ltgt=${Ltarget.toFixed(3)} grey=${greyVal} screen=${useScreen ? 1 : 0} ` +
            `wallPx=${lumN}`,
        );
      }
    },
    [model, showPaint, minConf, rgb, useBlur, doComposite, lumStrength, inferMs,
     cacheKey, maskCache, maskW, maskH, maskKind, fullFrameCrop],
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
        format={format}
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

        {/* Segmentation model. 3-class = fine 224x224 mask but a sofa is only
            "not wall"; ADE20K = coarse 56x56 mask but real per-class semantics. */}
        {PROFILE && (
          <View style={styles.stricRow}>
            {Object.keys(MODELS).map((k) => (
              <TouchableOpacity
                key={k}
                style={[styles.stricBtn, modelKey === k && styles.stricBtnActive]}
                onPress={() => setModelKey(k)}
              >
                <Text style={styles.stricTextSm}>
                  {MODELS[k].label} {MODELS[k].maskW}²
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Mask refresh rate. "Every frame" reproduces the old behaviour, so the
            before/after of the cache is directly comparable. */}
        {PROFILE && (
          <View style={styles.stricRow}>
            {INFER_INTERVALS.map((lvl) => (
              <TouchableOpacity
                key={lvl.label}
                style={[styles.stricBtn, inferMs === lvl.v && styles.stricBtnActive]}
                onPress={() => setInferMs(lvl.v)}
              >
                <Text style={styles.stricTextSm}>{lvl.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Luminance correction strength. "Off" reproduces the old, too-light
            result — useful for showing the before/after side by side. */}
        <View style={styles.stricRow}>
          {[
            { label: 'Lum Off', v: 0 },
            { label: '50%', v: 0.5 },
            { label: '80%', v: 0.8 },
            { label: 'Full', v: 1 },
          ].map((lvl) => (
            <TouchableOpacity
              key={lvl.label}
              style={[styles.stricBtn, lumStrength === lvl.v && styles.stricBtnActive]}
              onPress={() => setLumStrength(lvl.v)}
            >
              <Text style={styles.stricText}>{lvl.label}</Text>
            </TouchableOpacity>
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

        {/* Phase 1 profiling isolation switches — remove once profiling is done */}
        {PROFILE && (
          <View style={styles.stricRow}>
            <TouchableOpacity
              style={[styles.stricBtn, useBlur && styles.stricBtnActive]}
              onPress={() => setUseBlur((v) => !v)}
            >
              <Text style={styles.stricText}>Blur {useBlur ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.stricBtn, doComposite && styles.stricBtnActive]}
              onPress={() => setDoComposite((v) => !v)}
            >
              <Text style={styles.stricText}>Draw {doComposite ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.stricBtn, fullFrameCrop && styles.stricBtnActive]}
              onPress={() => setFullFrameCrop((v) => !v)}
            >
              <Text style={styles.stricTextSm}>
                {fullFrameCrop ? 'Full frame' : 'Centre crop'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

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
  stricTextSm: { color: '#fff', fontWeight: '700', fontSize: 11 },

  toggle: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  toggleActive: { backgroundColor: '#dc102e' },
  toggleText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
