// ─────────────────────────────────────────────────────────────────────────
// LIVE PAINT PREVIEW
//
// Point the camera at a wall; the wall — and only the wall — is repainted in the
// product's colour, live. Furniture, doors, windows and wall art are excluded
// per-pixel, which is why this uses CV segmentation rather than ARCore plane
// tracking (a plane has no idea a sofa stands in front of it). Runs on any
// camera phone; no ARCore, no certified device.
//
// Model: assets/models/wall_seg.tflite — ADE20K-derived, NON-COMMERCIAL, used
// for this capstone with attribution. Must be replaced before any commercial
// release. Input and output both uint8 [1,224,224,3]; three per-pixel class
// scores, argmax over 0=bg, 1=wall, 2=ceiling.
//
// How it works, and why each piece exists, is documented in AR_PAINT_PREVIEW.md
// together with the measurements behind it. In short:
//   • mask cache      — inference is ~70% of a frame, so the mask is reused and
//                       only re-segmented every INFER_MS; cached frames cost
//                       ~0.3 ms
//   • two-pass recolour — luminance is corrected on the raw wall FIRST, colour
//                       applied second. The reverse order desaturates (brown
//                       came out salmon).
//   • explicit crop   — the resize plugin centre-crops to the target aspect
//                       unless told otherwise, which was stretching the mask
//                       1.78x and inflating every exclusion edge.
//
// Known limitation: doors are sometimes partly painted. The model has no `door`
// class, only "not wall", and it has not learned that boundary. Swapping to a
// full-class ADE20K model was measured twice and was worse overall.
//
// PROFILE (below) gates all development controls and instrumentation.
// ─────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LogBox } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

// VisionCamera's own SkiaCameraCanvas calls console.error with this on the New
// Architecture. It concerns a <Canvas> sizing feature we never use — we render
// through the frame processor — so it is pure noise, but it repeats on every
// render and buries real logs in the Metro terminal.
//
// LogBox.ignoreLogs only silences the in-app overlay, not the terminal, so the
// message is filtered at console.error too. Matched narrowly on purpose:
// everything else passes straight through.
LogBox.ignoreLogs(['<Canvas onLayout']);
const NOISY_CANVAS_WARNING = '<Canvas onLayout';
const origConsoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes(NOISY_CANVAS_WARNING)) return;
  origConsoleError(...args);
};
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
import { Gyroscope } from 'expo-sensors';
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
//
// Also gates every development control on this screen (model, rotation, refresh
// rate, luminance strength, strictness, blur/draw/crop, and the Test Bench link).
// Flip to true to get them all back.
const PROFILE = false;

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

// Edge softness applied to all three passes. Was 3 px, chosen to hide the hard
// 0/255 stair-steps the old one-bit mask produced. With the alpha ramp (see
// ALPHA_MARGIN_MIN below) the softness now comes from the model's own
// uncertainty and follows the real boundary, so a fixed radius on top is doing
// the same job twice and over-softens. Halved rather than removed: the mask is
// still 224² upscaled, so some smoothing still earns its place.
// Declared here, not with the other mask constants: the paints below are built
// at module load and would hit the temporal dead zone otherwise.
const EDGE_BLUR_PX = 1.5;

// Paint used to composite the recolor onto the camera frame:
//  • BlendMode.Color → hue/sat from the paint, luminance from the wall
//  • blur ImageFilter → soft mask edges instead of blocky 224px stair-steps
const recolorPaint = Skia.Paint();
recolorPaint.setBlendMode(BlendMode.Color);
recolorPaint.setImageFilter(Skia.ImageFilter.MakeBlur(EDGE_BLUR_PX, EDGE_BLUR_PX, TileMode.Clamp, null));

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
// ONE blend mode, HardLight, driven by a PER-PIXEL grey:
//
//   s < 0.5   HardLight = Multiply(dst, 2s)      → darkens
//   s ≥ 0.5   HardLight = Screen(dst, 2s−1)      → lightens
//   s = 0.5   identity, so the two branches meet with no seam
//
// Both directions are needed in the SAME frame, and that is why the old global
// Multiply/Screen pair had to go. Flattening (LUM_FLATTEN) means pulling a dark
// stain UP and a blown highlight DOWN at once; Multiply can only darken, Screen
// can only lighten, and the blend mode is fixed per DRAW, not per pixel. A
// single scalar grey could therefore only ever move the whole wall one way.
//
// Why not skip the blend and draw the finished luminance with SrcOver, since we
// now compute it exactly? Because the grey buffer is only 224², so replacing
// luminance outright would flatten the wall to a smooth upscaled gradient and
// throw away the camera's real texture. HardLight stays ratio-based inside each
// branch, so full-resolution detail survives as a ratio on top of the
// correction. That is the same reason the original pass was ratio-based; only
// the gain has changed.
//
// Scaling all three channels equally also leaves hue and saturation untouched,
// so pass 1's colour is preserved.
function makeLumPaint(blur) {
  const p = Skia.Paint();
  p.setBlendMode(BlendMode.HardLight);
  // Must match pass 1's edge softness, or the luminance shift gets a hard edge
  // where the colour is soft.
  if (blur) p.setImageFilter(Skia.ImageFilter.MakeBlur(EDGE_BLUR_PX, EDGE_BLUR_PX, TileMode.Clamp, null));
  return p;
}
const lumPaint = makeLumPaint(true);
const lumPaintNoBlur = makeLumPaint(false);

// ── PASS 3: SPECULAR SHEEN (gloss finishes) ──────────────────────────────
// Passes 1+2 render a matte finish: the wall's diffuse shading recoloured. A
// glossy paint additionally throws a specular highlight — its BRIGHTEST areas
// (a window's reflection, light falloff near a lamp) lift toward white, which
// is what the eye reads as "shiny". Drawn as an ADDITIVE (Plus) pass AFTER the
// colour: a real specular highlight is white and desaturated, so it belongs on
// top of the paint, not tinting it — which is why this sits outside the
// order-sensitive luminance/colour pair and cannot re-trigger the salmon bug.
const specPaint = Skia.Paint();
specPaint.setBlendMode(BlendMode.Plus);
specPaint.setImageFilter(Skia.ImageFilter.MakeBlur(EDGE_BLUR_PX, EDGE_BLUR_PX, TileMode.Clamp, null));
const specPaintNoBlur = Skia.Paint();
specPaintNoBlur.setBlendMode(BlendMode.Plus);

// Finish → how the paint reflects light, from the product's category.
//   sheen  strength of the specular pass (0 = pure matte, zero extra cost)
//   hi     wall luminance above which sheen appears (highlight threshold)
//   pow    sharpness — higher tightens the highlight to the very brightest spots
// Textured paints ARE sold, but their surface-texture overlay is a later phase,
// so for now they render matte (see TODO(phase2)).
const FINISHES = {
  matte:    { sheen: 0 },
  gloss:    { sheen: 0.6, hi: 0.62, pow: 2.5 },
  textured: { sheen: 0 }, // TODO(phase2): tiling texture overlay, not sheen
};
const DEFAULT_FINISH = 'matte';

// Luma weights from the W3C compositing spec — the same ones Skia's
// non-separable Color/Luminosity blend modes use, so pass 1 and pass 2 agree
// on what "luminance" means.
const LR = 0.3, LG = 0.59, LB = 0.11;

// Luminance the correction is allowed to aim for. Outside this band the
// correction factor saturates and flattens all wall shading — see the
// Ltarget clamp in the frame processor.
const LUM_MIN = 0.1;
const LUM_MAX = 0.85;

// How much of the wall's own luminance variation survives into the paint.
//
// Pass 2 was ratio-based with an implicit gain of 1.0: every pixel kept its
// luminance relative to the wall mean. That preserves shading, which was the
// intent — but luminance carries two different things and the old code could
// not tell them apart:
//
//   LIGHTING  (lamp falloff, corner shadow) — low frequency, and real paint
//             does show it. Keep.
//   ALBEDO    (stains, scuffs, dirt marks)  — high frequency, and real paint
//             COVERS it. Two coats over a dark spot leaves no dark spot.
//
// Testers named this directly: "may dark spots nga sa pader ko and dahil
// na-ooverlay lang siya sinusundan niya lang yung darker tone na yun" — the
// preview tracked the dirt, so it read as a filter over a photo rather than as
// paint on a wall. Screenshots 21/23/30/31.
//
// So each wall pixel is pulled toward the target, keeping k of its deviation:
//     L' = Ltarget + k·(Lw − Lref)
//   k = 1  → the old behaviour, every mark preserved
//   k = 0  → dead flat, no shading at all, reads as a sticker
// 0.35 keeps the broad falloff the eye reads as lighting while collapsing the
// narrow dips it reads as dirt. This is the one value in the luminance pass
// worth arguing about — tune it on a real wall, not on the test set.
const LUM_FLATTEN = 0.35;

// ── ALPHA RAMP (mask edge) ───────────────────────────────────────────────
// The mask used to be one bit: `wall >= minConf ? 255 : 0`. But the model
// returns a per-pixel SCORE, and collapsing it to a bit threw that away — a
// pixel the model thought was "probably wall, not sure" rendered identically to
// one it knew was a fan. Every object boundary is a band of exactly those
// pixels, so every object came out ringed in bare wall.
//
// Tester round 2 (2026-09-14): a white outline around the electric fan, the mat
// roll and the left wall edge, in SHARP settled frames — a permanent defect,
// not motion lag.
//
// So alpha ramps on the MARGIN — how far `wall` beats its nearest rival —
// but ONLY below the old threshold. A pixel that cleared `minConf` before still
// gets a flat 255, byte for byte. That is deliberate: this change can only ADD
// a graded rim under the old cut, never alter coverage that already worked, so
// anything new on device is the rim and nothing else. It also means we are not
// assuming the three scores are normalised — the old condition is reused as-is
// rather than re-derived in margin terms.
//
//   margin <= ALPHA_MARGIN_MIN    bare. Without this floor every pixel the model
//                                 merely leans toward picks up a tint, and dim
//                                 or cluttered rooms haze over — which is the
//                                 round-1 "pati appliances tinatamaan" complaint
//                                 coming back by another route.
//   margin >= ALPHA_MARGIN_FULL   as opaque as the ramp goes (254).
//   between                       linear fade.
//
// MEASURED on device, 2026-09-14. At MIN=40 with a linear ramp the trade landed
// wrong: the white squares of a checkered pillow came out terracotta and an
// electric fan's blades and hub picked up paint, while at the previous build the
// fan had been cleanly excluded. White and mid-tone surfaces read as wall-ish to
// the model, so it mildly favours "wall" on them, and a low floor turns that
// mild preference into visible colour. A wire fan cage is the worst case: every
// 224² mask pixel blends cage, blade and wall, so the whole object sits in the
// ambiguous band.
//
// Hence a higher floor AND a squared ramp. The floor cuts the ambiguous tail
// off entirely; the curve then keeps what survives quiet unless the model
// genuinely leans wall. Linear gave a half-confident pixel half the paint, which
// is far too generous — halfway up this ramp is now a quarter of the alpha.
const ALPHA_MARGIN_MIN = 80;
const ALPHA_MARGIN_FULL = 150;
// Exponent on the normalised margin. 1 = linear (too generous, see above),
// 2 = quadratic. Raise to bleed less, lower to fill more halo.
const ALPHA_RAMP_POW = 2;

// How far from CONFIDENT wall a pixel may be and still earn ramp alpha, in mask
// pixels.
//
// Raising the floor above cleaned the pillow but left an electric fan's blades
// orange, and no floor fixes that: a wire cage has real wall visible between the
// wires, so the model's score there is honest. Confidence cannot separate "thin
// gap beside a wall" from "large object the model is unsure about" — they sit in
// the same band.
//
// Position can. A halo hugs confident wall by definition; a fan's interior is
// surrounded by more fan. So ramp alpha is granted ONLY within this radius of a
// pixel that cleared `minConf` outright. The fan's outer rim still softens,
// which is right — that rim really is a boundary — while its middle stays bare.
//
// 2 mask pixels is roughly 11 frame pixels at 224² over a 1280-wide frame.
// Raise if the halo comes back; lower if paint creeps around object edges.
const ALPHA_NEAR_RADIUS = 2;


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
// ── MASK LOCK ────────────────────────────────────────────────────────────
// Re-segmenting a static wall every 200 ms makes the paint visibly crawl: on a
// low-texture wall the model sits near its decision boundary, so each fresh
// inference lands differently and whole regions pop in and out between frames.
//
// That instability is not fixable — it is a 3 MB network being genuinely
// uncertain. Averaging masks over time would only turn flickering regions into
// permanently half-transparent ones.
//
// But it only matters while the user is LOOKING, and while they are looking the
// view is not changing. So once the phone is held still the mask is frozen: no
// recomputation, therefore no flicker, by construction rather than by tuning.
// Movement resumes it immediately.
//
// Rotation rate is the right signal — panning changes what the camera sees far
// more than translation does. Held-still hands read ~0.02-0.05 rad/s; a
// deliberate pan is well above 0.15.
const GYRO_INTERVAL_MS = 100;
const MOVE_THRESHOLD = 0.12;  // rad/s
const STILL_DELAY_MS = 350;   // must be quiet this long before locking

// ── DRIFT BREAK ──────────────────────────────────────────────────────────
// The lock above keys on INSTANTANEOUS rotation rate, and that is a bug: a
// drift that never crosses MOVE_THRESHOLD never touches `lastMovedAt`, so
// `isStill` stays true, `doInfer` stays false, and the mask is frozen
// INDEFINITELY while the view keeps moving. Staleness was unbounded, not one
// refresh interval.
//
// Tester round 2 (2026-09-14) is full of it: holes cut around an electric fan
// sitting in open wall, paint on a ceiling with a sharp diagonal edge where the
// wall/ceiling line used to be. Slow hand drift, frozen mask, scene moved on.
//
// So track how far the view has ACTUALLY turned since the cached mask was
// built, and break the lock on accumulated angle rather than on current speed.
//
// The noise floor is what makes this work. Held-still hands read 0.02-0.05
// rad/s (measured, see the mask-lock note above). Integrated raw, that reaches
// DRIFT_BREAK_RAD in about a second of holding perfectly still — the lock would
// break constantly and bring back the exact flicker it exists to prevent. Only
// rotation above GYRO_NOISE accumulates, which biases the estimate LOW. That is
// the safe direction: this is a trigger, not a correction.
const GYRO_NOISE = 0.06;       // rad/s — below this, rotation is sensor noise
// ~2°. The frame is 1280 px across roughly a 65° FOV, so ~1000 px/rad: 0.035 rad
// is ~35 px of mask misalignment, about where a mask edge visibly separates from
// the object it was cut around.
const DRIFT_BREAK_RAD = 0.035;

// Hard ceiling on how old a reused mask may be, whatever the sensor says.
//
// The deadband above trades "does not false-trigger on hand noise" against
// "catches very slow drift", and those two overlap: a steady 0.05 rad/s pan and
// a still hand's jitter are the same magnitude, so the gyro cannot tell them
// apart. No threshold closes that gap — a drift just under GYRO_NOISE would
// accumulate nothing and freeze the mask forever, which is the bug all over
// again in a narrower band.
//
// So bound the staleness directly instead of inferring it. This is the only
// guarantee here that does not depend on the sensor being right.
//
// The cost is one re-segment every 4 s while genuinely still, which can pop a
// low-confidence region in or out — the flicker the mask lock exists to stop.
// At 0.25 Hz that is a rare blink rather than the 5 Hz crawl; an unboundedly
// stale mask is the worse failure. Tune on device if the blink is noticeable.
const MAX_MASK_AGE_MS = 4000;

// ── PAN THROTTLE ─────────────────────────────────────────────────────────
// Inference is synchronous on the frame it runs on, so every refresh is a ~70 ms
// stall in a pipeline where normal frames cost ~2 ms. At INFER_MS that is FIVE
// stalls per second, and while panning it reads as the camera image itself
// juddering — which is exactly what the release build was reported as doing.
// (Tested on release, not debug: the dev-build overhead was ruled out first.)
//
// The GPU delegate would fix it properly and does not work: it cannot build an
// interpreter for this model on this hardware, so inference is on CPU. The real
// fix is off-thread inference, which previously hit a worklets-core/reanimated
// conflict. Both are out of reach today.
//
// So trade the thing nobody is looking at for the thing everybody sees. Nobody
// judges paint colour mid-swing, and a mask computed from a motion-blurred frame
// was poor anyway — that is why `settled` exists. During a deliberate pan the
// refresh interval stretches, cutting stalls from 5/s to 2/s. Stop moving and
// `needsSettledPass` forces a fresh mask immediately.
//
// Threshold sits well above MOVE_THRESHOLD (0.12, "is it moving at all") so slow
// deliberate adjustments keep refreshing at full rate — it is only the fast
// sweep that throttles. Push PAN_INFER_MS higher for fewer stalls and a staler
// mask mid-pan; Infinity would suppress inference entirely while panning.
const FAST_PAN_RAD_S = 0.35;
const PAN_INFER_MS = 500;

export default function LiveFilter() {
  const { hex, finish } = useLocalSearchParams();
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
  const [color, setColor] = useState(hex ?? '#2563eb');

  // Paint finish from the product's category (matte / gloss / textured). Drives
  // the specular sheen pass. Falls back to matte for an unknown or absent value.
  const finishKey = finish && FINISHES[finish] ? finish : DEFAULT_FINISH;
  const finishCfg = FINISHES[finishKey] ?? FINISHES[DEFAULT_FINISH];
  const sheen   = finishCfg.sheen;
  const specHi  = finishCfg.hi ?? 0.6;
  const specPow = finishCfg.pow ?? 2.5;

  // ── Fixed pipeline settings ──────────────────────────────────────────────
  // These were on-screen dev toggles, stripped for release (recoverable via git).
  // The values are the production defaults those toggles were used to find; the
  // full reasoning behind each is in AR_PAINT_PREVIEW.md.
  const minConf = 195;         // wall-confidence threshold
  const lumStrength = 1;       // pull the painted region's mean luminance fully onto the paint
  const inferMs = 200;         // re-segment every 200 ms (~5 Hz)
  const rotDeg = 0;            // rotation applied to the model's input
  const fullFrameCrop = true;  // feed the whole frame, not the plugin's centre-crop
  const useBlur = true;        // blur ImageFilter softens the mask edge
  const doComposite = true;    // draw the recolour

  // `modelKey` selects the model; `activeCfg` describes the one actually loaded
  // (set together with it, since loading is async — deriving geometry from the
  // selection alone once decoded seg3's scores as a 56x56 map).
  const modelKey = 'seg3';
  const [activeCfg, setActiveCfg] = useState(MODELS.seg3);
  const maskW = activeCfg.maskW;
  const maskH = activeCfg.maskH;
  const maskKind = activeCfg.kind;

  // Survives both re-renders and frame-processor rebuilds, and is readable from
  // the worklet thread — holds the last mask so most frames can skip inference.
  const maskCache = useSharedValue(null);

  // True once the phone has been held still for STILL_DELAY_MS. Read from the
  // worklet thread to decide whether the mask may be frozen.
  const isStill = useSharedValue(false);

  // Total angle the phone has turned through since the screen opened, in
  // radians, ignoring anything below the noise floor. Monotonic on purpose: the
  // frame processor records its value when it builds a mask and subtracts later,
  // so "how far has the view moved since THIS mask" is one subtraction between
  // two reads of the same counter — no alignment between the sensor clock and
  // the camera clock, which is the part of motion compensation that goes wrong
  // silently.
  const gyroTravel = useSharedValue(0);

  // Instantaneous rotation rate, rad/s. `isStill` already answers "is it moving
  // at all"; this answers "how fast", which the pan throttle needs.
  const gyroRate = useSharedValue(0);

  useEffect(() => {
    Gyroscope.setUpdateInterval(GYRO_INTERVAL_MS);
    let lastMovedAt = Date.now();
    let lastSampleAt = Date.now();
    let travel = 0;
    const sub = Gyroscope.addListener(({ x, y, z }) => {
      const rate = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();
      // Real elapsed time, not GYRO_INTERVAL_MS: delivery is not exact, and a
      // dropped sample would otherwise under-count the rotation it covered.
      // Capped so returning from background does not dump one huge interval in.
      const dt = Math.min(now - lastSampleAt, 500) / 1000;
      lastSampleAt = now;
      if (rate > GYRO_NOISE) travel += (rate - GYRO_NOISE) * dt;
      gyroTravel.value = travel;
      gyroRate.value = rate;
      if (rate > MOVE_THRESHOLD) lastMovedAt = now;
      isStill.value = now - lastMovedAt > STILL_DELAY_MS;
    });
    return () => sub.remove();
  }, [isStill, gyroTravel, gyroRate]);

  const rgb = useMemo(() => hexToRgb(color), [color]);

  // Everything baked into the mask IMAGE. When any of it changes the cache must
  // be rebuilt even if INFER_MS has not elapsed, or you would keep seeing the
  // mask from the previous colour.
  // NB must come after `rgb` — reading it earlier gave "Cannot read property 'r'
  // of undefined" (Hermes compiles const to var, so the TDZ surfaces as
  // undefined rather than a ReferenceError).
  const cacheKey = `${modelKey},${rgb.r},${rgb.g},${rgb.b},${minConf},${lumStrength},${finishKey}`;

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
          if (PROFILE) console.log('PROF delegate=android-gpu');
        } catch (gpuErr) {
          // Expected on this hardware: the GPU delegate cannot build an
          // interpreter for this model, so inference runs on CPU (~50 ms).
          // Not an error, and not worth shouting about outside profiling.
          if (PROFILE) console.log('PROF delegate=cpu-fallback reason=' + String(gpuErr));
          m = await loadTensorflowModel({ url: uri }, 'default');
        }
        if (!mounted) return;
        // Set together, always: the geometry must describe THIS model.
        setActiveCfg(MODELS[modelKey]);
        setModel(m);
        setModelState('loaded');
        if (PROFILE) {
          console.log(
            `PROF activeModel=${modelKey} in=` + JSON.stringify(m.inputs) +
            ' out=' + JSON.stringify(m.outputs),
          );
        }
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
      const still = isStill.value;

      // Freeze once still — but only after ONE inference taken while already
      // still. Without that the frozen mask would be whatever was computed
      // mid-pan, from a motion-blurred frame, and it would stay wrong until the
      // user moved again. `settled` records that the cached mask was produced
      // from a steady view.
      const needsSettledPass = still && !isStale && cached.settled !== true;

      // The view has turned far enough since this mask was built that it no
      // longer lines up — even if the phone never crossed MOVE_THRESHOLD and so
      // still counts as "held still". Without this a slow drift freezes the mask
      // forever; see the DRIFT BREAK note.
      const drifted =
        !isStale &&
        cached.gyro != null &&
        gyroTravel.value - cached.gyro > DRIFT_BREAK_RAD;

      // Sensor-independent backstop for drift too slow to clear the noise floor.
      const tooOld = !isStale && tStart - cached.t > MAX_MASK_AGE_MS;
      // Stretch the refresh interval during a deliberate pan — see PAN THROTTLE.
      // `isStale` (a colour change) bypasses this entirely, so tapping a swatch
      // mid-pan still repaints at once.
      const effInferMs =
        gyroRate.value > FAST_PAN_RAD_S ? PAN_INFER_MS : inferMs;
      const dueByTime = inferMs === 0 || tStart - cached?.t >= effInferMs;
      // `dueByTime` still gates the drift path: a mask that has fallen out of
      // alignment is refreshed at the normal rate, never faster, so breaking the
      // lock cannot turn into inference on every frame.
      const doInfer =
        isStale || needsSettledPass || ((!still || drifted || tooOld) && dueByTime);

      if (!doInfer) {
        let tDrawnFrom = mark();
        if (doComposite && cached.img != null) {
          const src = Skia.XYWHRect(0, 0, cached.maskW, cached.maskH);
          const dst = Skia.XYWHRect(0, 0, frame.width, frame.height);
          if (cached.lumImg != null) {
            frame.drawImageRect(
              cached.lumImg, src, dst, useBlur ? lumPaint : lumPaintNoBlur,
            );
          }
          frame.drawImageRect(
            cached.img, src, dst, useBlur ? recolorPaint : recolorPaintNoBlur,
          );
          if (cached.specImg != null) {
            frame.drawImageRect(cached.specImg, src, dst, useBlur ? specPaint : specPaintNoBlur);
          }
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
      // `rotation` matters because the camera buffer is landscape-right while the
      // phone is held portrait (measured: orient=landscape-right on a 1280x720
      // frame). Left at 0deg the model sees the room on its side — wall/ceiling
      // junctions as vertical lines, floor off to one side — and semantic
      // segmentation leans hard on exactly those priors.
      const input = resize(frame, {
        crop: fullFrameCrop
          ? { x: 0, y: 0, width: frame.width, height: frame.height }
          : undefined,
        scale: { width: MODEL_W, height: MODEL_H },
        rotation: rotDeg === 0 ? undefined : `${rotDeg}deg`,
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

      // Anchor for pass 2. The grey itself is PER PIXEL now, so it is built in
      // the mask loop below — this only settles the two values every pixel
      // shares: where the correction is aiming, and what it measures from.
      const Lpaint = (LR * pr + LG * pg + LB * pb) / 255;
      // Clamp the TARGET away from pure black/white. At Lpaint=1 the correction
      // forces every pixel to pure white and destroys all shading (observed on
      // device: white paint went flat, textureless white). Symmetrically,
      // near-black paint would crush to flat black. Real paint never reaches
      // either extreme under real light — a white wall still has shadows — so
      // aiming slightly inside the range is both safer and more physically
      // honest.
      const Ltarget = Math.max(LUM_MIN, Math.min(LUM_MAX, Lpaint));
      let LrefDbg = -1;
      let lrefEma = cached != null ? cached.lrefEma : undefined;
      const doLum = lumN > 0 && lumStrength > 0;
      if (doLum) {
        const LrefRaw = lumSum / lumN / 255;
        // Smooth Lref over time. Measured raw, it swung 0.486 -> 0.707 between
        // consecutive refreshes as the camera's auto-exposure hunted, which moved
        // the correction far enough to make the painted wall visibly pulse at the
        // refresh rate. The wall's real lightness does not change that fast, so
        // the variation is measurement noise and belongs smoothed away.
        // Carried across colour changes on purpose: Lref describes the WALL, not
        // the paint, so switching swatches should not restart the average.
        // It matters more than it used to: Lref is now the pivot every pixel is
        // flattened around, not just the mean the whole region is scaled by.
        lrefEma = lrefEma == null ? LrefRaw : lrefEma * 0.75 + LrefRaw * 0.25;
        LrefDbg = lrefEma;
      }
      const Lref = LrefDbg;

      // Confident core, in MODEL space (indexed like the score array, not like
      // the frame). Built up front because the alpha ramp needs to know whether
      // a pixel sits near confident wall, and that cannot be answered while
      // walking pixels one at a time — the neighbours may not be decided yet.
      // One extra Uint8Array(50,176) ≈ 50 KB per refresh, alongside the ~200 KB
      // buffers already allocated here.
      const core = isClasses ? null : new Uint8Array(N);
      if (core !== null) {
        for (let m = 0; m < N; m++) {
          const o = m * NUM_CLASSES;
          const b = out[o];
          const w = out[o + 1];
          const c = out[o + 2];
          core[m] = w > b && w >= c && w >= minConf ? 1 : 0;
        }
      }

      const rgba = new Uint8Array(N * 4);
      const lumRgba = doLum ? new Uint8Array(N * 4) : null;
      // Specular buffer only for glossy finishes; a matte paint (sheen 0) pays
      // nothing here and the pipeline is byte-for-byte its old self.
      const doSpec = sheen > 0;
      const specRgba = doSpec ? new Uint8Array(N * 4) : null;
      // `p` walks the mask image in FRAME space; the model output is in ROTATED
      // space when rotDeg != 0, so it has to be read back through the inverse
      // rotation or the mask lands transposed. Both mask sizes are square, so
      // maskW serves for both axes.
      const M = maskW;
      for (let p = 0; p < N; p++) {
        let mi;
        if (rotDeg === 0) {
          mi = p;
        } else {
          const fx = p % M;
          const fy = (p / M) | 0;
          if (rotDeg === 90) mi = fx * M + (M - 1 - fy);
          else if (rotDeg === 180) mi = (M - 1 - fy) * M + (M - 1 - fx);
          else mi = (M - 1 - fx) * M + fy; // 270
        }
        let a;
        if (isClasses) {
          // ADE20K returns an argmax with no score behind it, so there is
          // nothing to ramp — it stays one bit by necessity.
          a = out[mi] === ADE_WALL_IDX ? 255 : 0;
        } else {
          const o = mi * NUM_CLASSES;
          const bg = out[o];
          const wall = out[o + 1];
          const ceil = out[o + 2];
          if (wall > bg && wall >= ceil) {
            if (wall >= minConf) {
              a = 255; // unchanged from before — the confident core
            } else {
              // Below the old cut: fade in on how far wall beats its rival,
              // instead of discarding the pixel outright.
              const rival = bg > ceil ? bg : ceil;
              const margin = wall - rival;
              if (margin <= ALPHA_MARGIN_MIN) {
                a = 0;
              } else {
                // Adjacency gate — see ALPHA_NEAR_RADIUS. Scan outward for any
                // pixel that cleared minConf outright; bail on the first hit,
                // which for a genuine halo pixel is usually immediate.
                const cx = mi % maskW;
                const cy = (mi / maskW) | 0;
                let y0 = cy - ALPHA_NEAR_RADIUS; if (y0 < 0) y0 = 0;
                let y1 = cy + ALPHA_NEAR_RADIUS; if (y1 >= maskH) y1 = maskH - 1;
                let x0 = cx - ALPHA_NEAR_RADIUS; if (x0 < 0) x0 = 0;
                let x1 = cx + ALPHA_NEAR_RADIUS; if (x1 >= maskW) x1 = maskW - 1;
                let near = false;
                for (let yy = y0; yy <= y1; yy++) {
                  const row = yy * maskW;
                  for (let xx = x0; xx <= x1; xx++) {
                    if (core[row + xx] === 1) { near = true; break; }
                  }
                  if (near) break;
                }
                if (!near) {
                  a = 0; // an object's interior, not a wall's edge
                } else {
                  let t = (margin - ALPHA_MARGIN_MIN) /
                          (ALPHA_MARGIN_FULL - ALPHA_MARGIN_MIN);
                  if (t > 1) t = 1;
                  // Curved, not linear: a barely-favoured pixel should get
                  // barely any paint, or whole objects wash over.
                  a = (255 * Math.pow(t, ALPHA_RAMP_POW)) | 0;
                  if (a > 254) a = 254; // 255 is reserved for the confident core
                }
              }
            }
          } else {
            a = 0;
          }
        }
        const q = p * 4;
        rgba[q] = pr;
        rgba[q + 1] = pg;
        rgba[q + 2] = pb;
        rgba[q + 3] = a;
        // Wall luminance at this pixel, read in the model's (rotated) space via
        // `mi` and scaled up to the input resolution — the same mapping the
        // luminance pre-pass uses, so the correction and the highlight stay
        // aligned with each other and with the mean. Passes 2 and 3 both want
        // it, so it is read ONCE here rather than per pass. -1 = not a wall
        // pixel, or nothing downstream needs it.
        let Lw = -1;
        if (a !== 0 && (lumRgba !== null || specRgba !== null)) {
          const smx = mi % maskW;
          const smy = (mi / maskW) | 0;
          const si = (((smy * step) | 0) * MODEL_W + ((smx * step) | 0)) * 3;
          Lw = (LR * input[si] + LG * input[si + 1] + LB * input[si + 2]) / 255;
        }
        if (lumRgba !== null) {
          // 128 is HardLight's identity, so off-wall pixels are a no-op even
          // before alpha masks them out.
          let s = 128;
          if (Lw >= 0) {
            // Where this pixel should land: the paint's luminance, plus the
            // LUM_FLATTEN share of its own deviation from the wall mean.
            // lumStrength lerps the whole correction back toward a no-op (Lw),
            // so the dev toggle keeps its old meaning.
            const Lwant =
              Lw + lumStrength * (Ltarget + LUM_FLATTEN * (Lw - Lref) - Lw);
            // Invert HardLight to find the source grey that lands on Lwant.
            // Below the pivot it multiplies, above it screens; the guards are
            // for pixels already at pure black or white, where the ratio has no
            // solution and the identity is the honest answer.
            let g;
            if (Lwant <= Lw) {
              g = Lw > 0.004 ? Lwant / (2 * Lw) : 0.5;
            } else {
              g = Lw < 0.996 ? 1 - (1 - Lwant) / (2 * (1 - Lw)) : 0.5;
            }
            s = Math.max(0, Math.min(255, Math.round(g * 255)));
          }
          lumRgba[q] = s;
          lumRgba[q + 1] = s;
          lumRgba[q + 2] = s;
          lumRgba[q + 3] = a;
        }
        if (specRgba !== null) {
          let v = 0;
          // Was `a === 255`. With the alpha ramp almost nothing is exactly 255
          // any more, so that test would have silently switched gloss off for
          // every pixel outside the confident core. `Lw >= 0` is true for every
          // pixel with any paint on it, and the buffer's own alpha already
          // scales the highlight — so a half-painted rim gets half the sheen,
          // which is what it should get.
          if (Lw >= 0 && Lw > specHi) {
            let t = (Lw - specHi) / (1 - specHi); // 0..1 above the threshold
            t = Math.pow(t, specPow);             // sharpen to the brightest spots
            v = (255 * sheen * t) | 0;
            if (v > 255) v = 255;
          }
          specRgba[q]     = v;
          specRgba[q + 1] = v;
          specRgba[q + 2] = v;
          specRgba[q + 3] = a; // masked to the wall; Plus adds v only where bright
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
      let specData = null;
      let specImg = null;
      if (specRgba !== null) {
        specData = Skia.Data.fromBytes(specRgba);
        specImg = Skia.Image.MakeImage(imgInfo, specData, maskW * 4);
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
        if (prev.specImg != null && prev.specImg.dispose) prev.specImg.dispose();
        if (prev.specData != null && prev.specData.dispose) prev.specData.dispose();
      }

      maskCache.value = {
        img,
        data,
        lumImg,
        lumData,
        specImg,
        specData,
        key: cacheKey,
        t: tStart,
        lrefEma,
        settled: still,
        // Where the rotation counter stood when this mask was built — the
        // baseline `drifted` measures against on later frames.
        gyro: gyroTravel.value,
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
        // surface detail survives because HardLight is ratio-based in both of
        // its branches.
        if (lumImg != null) {
          frame.drawImageRect(lumImg, src, dst, useBlur ? lumPaint : lumPaintNoBlur);
        }
        frame.drawImageRect(img, src, dst, useBlur ? recolorPaint : recolorPaintNoBlur);
        // PASS 3 (gloss only): additive white specular over the painted wall.
        if (specImg != null) {
          frame.drawImageRect(specImg, src, dst, useBlur ? specPaint : specPaintNoBlur);
        }
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
            // the wall region and the pivot every pixel is flattened around,
            // Lpaint = the paint's own luminance, Ltgt = after the safety clamp,
            // flat = how much of each pixel's own deviation survives. There is
            // no single `grey` to log any more — it is per pixel.
            `Lref=${LrefDbg.toFixed(3)} Lpaint=${Lpaint.toFixed(3)} ` +
            `Ltgt=${Ltarget.toFixed(3)} flat=${LUM_FLATTEN} ` +
            `wallPx=${lumN} still=${still ? 1 : 0} drift=${drifted ? 1 : 0}`,
        );
      }
    },
    [model, showPaint, minConf, rgb, useBlur, doComposite, lumStrength, inferMs,
     cacheKey, maskCache, isStill, gyroTravel, gyroRate, maskW, maskH, maskKind, fullFrameCrop, rotDeg,
     sheen, specHi, specPow],
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

        {/* The preview's whole commercial point. The customer has just seen
            this colour on their own wall, in their own light — the strongest
            moment in the app to offer to mix it. Carries the hex forward to
            the product picker. */}
        <TouchableOpacity
          style={styles.orderBtn}
          onPress={() => router.push({ pathname: '/color/order', params: { hex: color } })}
          activeOpacity={0.85}
        >
          <View style={[styles.orderSwatch, { backgroundColor: color }]} />
          <Text style={styles.orderBtnText}>Order this colour</Text>
        </TouchableOpacity>

        {/* Not sure what colour? Read the room and suggest wall colours that go
            with the furniture already in it. See COLOR_SUGGESTIONS.md. */}
        <TouchableOpacity
          style={styles.suggestLink}
          onPress={() => router.push('/color/suggest')}
          activeOpacity={0.85}
        >
          <Text style={styles.suggestLinkText}>💡 Suggest colours from my room</Text>
        </TouchableOpacity>

        {/* Press-and-hold rather than a toggle: comparing is momentary, and a
            toggle leaves the user able to strand themselves in the unpainted
            state wondering why the feature stopped working. */}
        <TouchableOpacity
          style={[styles.compare, !showPaint && styles.compareHeld]}
          activeOpacity={1}
          onPressIn={() => setShowPaint(false)}
          onPressOut={() => setShowPaint(true)}
        >
          <Text style={styles.compareText}>
            {showPaint ? 'Hold to see the real wall' : 'Release to bring the paint back'}
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

  compare: { backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  compareHeld: { backgroundColor: 'rgba(255,255,255,0.30)' },
  compareText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  orderBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#b91c1c', borderRadius: 12, paddingVertical: 14, marginBottom: 10,
  },
  orderSwatch: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' },
  orderBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  suggestLink: { alignItems: 'center', paddingVertical: 8, marginBottom: 8 },
  suggestLinkText: { color: '#fff', fontSize: 13.5, fontWeight: '600' },
});
