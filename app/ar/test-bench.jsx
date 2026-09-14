// ─────────────────────────────────────────────────────────────────────────
// WALL SEGMENTATION TEST BENCH  (development tool — not a user-facing screen)
//
// Runs every image in assets/testset/ through the same model + mask logic the
// live filter uses, and reports measured wall coverage plus a painted preview.
//
// The point is REPEATABILITY. Judging mask changes by pointing the camera at
// whatever wall is nearby has already misled us: the same model produced clean
// coverage on a rough plastered white wall and patchy splatter on a smooth one.
// Fixed inputs make a change attributable.
//
// Coverage alone is NOT quality — a mask that paints the door as well as the
// wall scores higher, not better. Always read the number next to the preview.
//
// !! The mask rules below intentionally MIRROR app/ar/live-filter.jsx. That file
// !! is the source of truth. Change one, change the other. (They are separate
// !! because the live version runs inside a worklet; unifying them means moving
// !! the logic into a shared 'worklet' module, which is a refactor worth doing
// !! once the bench has proved its keep.)
// !!
// !! THIS HAS ALREADY BITTEN. The bench was deleted 2026-08-03, the live filter
// !! then gained per-pixel luminance, HardLight, the alpha ramp and the
// !! adjacency gate, and the restored copy measured a pipeline that no longer
// !! shipped. Re-synced 2026-09-14. If you are about to compare two MODELS,
// !! diff this file against live-filter.jsx first — a stale bench gives
// !! confident, wrong numbers, which is worse than no bench.
//
// WHAT THE NUMBERS MEAN
//   coverage  % of the frame in the CONFIDENT core (wall >= minConf). This is
//             the model-comparison number: it measures what the model is sure
//             of, and is unaffected by how the rim is rendered.
//   rim       % added by the graded ramp on top of the core.
//   Lref      measured mean luminance of the core — the pivot the flattening
//             pulls every wall pixel toward.
//
// Coverage is NOT quality. A model that paints the door as well as the wall
// scores HIGHER. Always read the number next to the preview image.
// ─────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Asset } from 'expo-asset';
import { loadTensorflowModel } from 'react-native-fast-tflite';
import {
  Skia, AlphaType, ColorType, BlendMode, TileMode, ImageFormat,
} from '@shopify/react-native-skia';
import { TEST_IMAGES } from '../../assets/testset/manifest';

const MODEL_W = 224;
const MODEL_H = 224;
const NUM_CLASSES = 3;
const LR = 0.3, LG = 0.59, LB = 0.11;
const LUM_MIN = 0.1;
const LUM_MAX = 0.85;
const ROTATIONS = [0, 90, 180, 270];

// !! MIRRORED from app/ar/live-filter.jsx — keep the values identical or the
// !! bench measures a pipeline that does not ship. See the header warning.
const LUM_FLATTEN = 0.35;        // how much of the wall's own variation survives
const ALPHA_MARGIN_MIN = 80;     // below this margin, no paint at all
const ALPHA_MARGIN_FULL = 140;   // at this margin, as opaque as the ramp goes
const ALPHA_RAMP_POW = 2;        // curve on the ramp; 1 = linear (too generous)
const ALPHA_NEAR_RADIUS = 2;     // ramp only within this many px of confident wall
const EDGE_BLUR_PX = 1.5;        // was 3 before the ramp generated its own softness

// Same two models the live filter can load. seg3 returns three per-pixel class
// SCORES at 224x224; ade20k returns a single per-pixel CLASS INDEX at 56x56 with
// argmax baked in (so `conf` does nothing for it).
//
// ade20k lost badly on overall coverage in live testing, but it has an explicit
// `door` class where seg3 only knows "not wall" — and the door photos are where
// seg3 fails worst (34-45% coverage, paint bleeding onto the door). Worth one
// run to see whether it wins specifically there.
const MODELS = {
  seg3: { label: '3-class 224²', mask: 224, kind: 'scores3' },
  ade20k: { label: 'ADE20K 56²', mask: 56, kind: 'classes' },
};
const ADE_WALL_IDX = 1; // measured, see AR_PAINT_PREVIEW.md
const PREVIEW_W = 300; // px of the rendered preview; aspect follows the source

// Same composite stack as the live filter.
const pColor = Skia.Paint();
pColor.setBlendMode(BlendMode.Color);
pColor.setImageFilter(Skia.ImageFilter.MakeBlur(EDGE_BLUR_PX, EDGE_BLUR_PX, TileMode.Clamp, null));
// ONE blend mode now, not a Multiply/Screen pair: the grey is per-pixel, and
// flattening needs to darken some pixels and lighten others in the same frame.
// HardLight multiplies below 0.5 and screens above it. See AR_PAINT_PREVIEW.md.
const pLum = Skia.Paint();
pLum.setBlendMode(BlendMode.HardLight);
pLum.setImageFilter(Skia.ImageFilter.MakeBlur(EDGE_BLUR_PX, EDGE_BLUR_PX, TileMode.Clamp, null));
const pPlain = Skia.Paint();

const IMG_INFO = {
  width: MODEL_W,
  height: MODEL_H,
  alphaType: AlphaType.Unpremul,
  colorType: ColorType.RGBA_8888,
};

/** Decode a bundled asset to MODEL_W x MODEL_H RGBA bytes.
 *
 *  `aspect` exists because the test photos are PORTRAIT (720x1280) while the
 *  camera buffer is LANDSCAPE (1280x720), so squashing each to a square distorts
 *  them in exactly OPPOSITE directions:
 *
 *      live  1280x720 -> 224^2 : x*0.175, y*0.311  -> content tall and thin
 *      full   720x1280 -> 224^2 : x*0.311, y*0.175  -> content short and wide
 *
 *  That confound made the first rotation comparison unreadable: bench rot 90/270
 *  swap the axes, reproducing live's distortion, and those were exactly the
 *  rotations that scored best — so the result may have been measuring aspect,
 *  not orientation.
 *
 *  'live' centre-crops each photo to 16:9 landscape FIRST, then squashes, which
 *  reproduces the shipping geometry. It sees less of the photo, but it tests what
 *  actually runs. */
function decodeToModelSize(fullImg, aspect) {
  const iw = fullImg.width();
  const ih = fullImg.height();
  let sx = 0, sy = 0, sw = iw, sh = ih;
  if (aspect === 'live') {
    const target = 1280 / 720;
    if (iw / ih > target) {
      sw = Math.round(ih * target);
      sx = Math.round((iw - sw) / 2);
    } else {
      sh = Math.round(iw / target);
      sy = Math.round((ih - sh) / 2);
    }
  }
  const surf = Skia.Surface.MakeOffscreen(MODEL_W, MODEL_H);
  if (surf == null) return null;
  surf.getCanvas().drawImageRect(
    fullImg,
    Skia.XYWHRect(sx, sy, sw, sh),
    Skia.XYWHRect(0, 0, MODEL_W, MODEL_H),
    pPlain,
  );
  const snap = surf.makeImageSnapshot();
  return { px: snap.readPixels(0, 0, IMG_INFO), sx, sy, sw, sh };
}

/** Frame-space pixel -> model-space index, undoing `rot`. Mirrors the live
 *  filter's inverse rotation; all four are bijections. */
// ── MISSED-WALL METRIC ───────────────────────────────────────────────────
// THE number. Both earlier attempts were wrong, and it is worth recording why.
//
// `coverage` rewards painting MORE. Measured: 02.jpg ("white wall") scored 92.5%
// while visibly punched with white blobs; 11.jpg scored 32.1% and was CORRECT —
// the rest of that frame is a window and clothes. Coverage called the broken
// image good and the good image bad.
//
// `holes` (unpainted AND enclosed by paint) failed in BOTH directions. 02.jpg
// scored 0.07%, below the 0.19% mean, because its dropouts touch the frame edge
// so the flood fill reached them. And the WORST image at 1.52% was 16.jpg —
// "drawer against wall, perfumes on top" — where the enclosed regions are
// perfume bottles, correctly excluded. It flagged the right answer as a defect.
//
// The correct definition is about colour, not geometry:
//
//     A dropout IS wall. Same surface, same paint, same light — so it is the
//     SAME COLOUR as the wall around it. A window, a drawer, a perfume bottle,
//     a pile of clothes is not.
//
// So: for every unpainted pixel, compare its colour to the mean colour of the
// CONFIDENT core. Close enough, and it is wall the model missed. This does not
// care whether the blob touches an edge or how big it is, which is exactly what
// went wrong twice.
//
// BLOWN PIXELS ARE EXCLUDED. A near-white window read as "wall colour" and
// scored 9.63% in a synthetic test — it would have dominated 10-12.jpg, which
// are all "sofa in front of window". The justification is not a fudge: a
// saturated pixel has NO colour information left, so it cannot honestly be
// matched against the wall. Skipping it is the correct answer, not a tuned one.
//
// REMAINING FALSE POSITIVE: a genuinely wall-coloured object that is not blown —
// a matte white curtain or door frame against a white wall — still counts.
// Nothing separates those on colour alone. Read the preview alongside the
// number; this is a comparison tool between models, not an absolute score.
const MISS_TOL = 48;  // RGB euclidean distance. The one knob. Raise to catch
                      // dropouts in shaded corners, lower if pale objects creep in.
const BLOWN = 250;    // any channel at or above this = saturated, no colour left
function missedWallPct(maskA, core, rgba, M, step) {
  const N = M * M;
  let cr = 0, cg = 0, cb = 0, cn = 0;
  for (let p = 0; p < N; p++) {
    if (core[p] !== 1) continue;
    const ri = ((((((p / M) | 0) * step) | 0) * MODEL_W) + (((p % M) * step) | 0)) * 4;
    cr += rgba[ri]; cg += rgba[ri + 1]; cb += rgba[ri + 2]; cn++;
  }
  if (cn === 0) return 0;
  cr /= cn; cg /= cn; cb /= cn;
  const tol2 = MISS_TOL * MISS_TOL;
  let missed = 0;
  for (let p = 0; p < N; p++) {
    if (maskA[p] !== 0) continue;
    const ri = ((((((p / M) | 0) * step) | 0) * MODEL_W) + (((p % M) * step) | 0)) * 4;
    const pr = rgba[ri], pg = rgba[ri + 1], pb = rgba[ri + 2];
    if (pr >= BLOWN || pg >= BLOWN || pb >= BLOWN) continue; // no colour to compare
    const dr = pr - cr, dg = pg - cg, db = pb - cb;
    if (dr * dr + dg * dg + db * db < tol2) missed++;
  }
  return (100 * missed) / N;
}

// ── HOLE METRIC (kept, demoted) ──────────────────────────────────────────
// Superseded by missedWallPct above — see why there. Still computed because it
// is nearly free and it does answer a different, narrower question: how much
// unpainted area is fully enclosed. Do not tune against it.
function holeFraction(maskA, W, H) {
  const N = W * H;
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N); // every pixel is pushed at most once
  let sp = 0;
  const push = (i) => {
    if (maskA[i] === 0 && seen[i] === 0) { seen[i] = 1; stack[sp++] = i; }
  };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % W;
    const y = (i / W) | 0;
    if (x > 0)     push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0)     push(i - W);
    if (y < H - 1) push(i + W);
  }
  let holes = 0;
  for (let i = 0; i < N; i++) if (maskA[i] === 0 && seen[i] === 0) holes++;
  return (100 * holes) / N;
}

function modelIndex(p, rot, M) {
  if (rot === 0) return p;
  const fx = p % M;
  const fy = (p / M) | 0;
  if (rot === 90) return fx * M + (M - 1 - fy);
  if (rot === 180) return (M - 1 - fy) * M + (M - 1 - fx);
  return (M - 1 - fx) * M + fy;
}

/** Rotate the model's INPUT so the scene is upright from its point of view.
 *  Inverse of modelIndex, applied to the RGB buffer before inference. */
function rotateRgb(rgb, rot) {
  if (rot === 0) return rgb;
  const N = MODEL_W * MODEL_H;
  const out = new Uint8Array(N * 3);
  for (let p = 0; p < N; p++) {
    const mi = modelIndex(p, rot, MODEL_W);
    out[mi * 3] = rgb[p * 3];
    out[mi * 3 + 1] = rgb[p * 3 + 1];
    out[mi * 3 + 2] = rgb[p * 3 + 2];
  }
  return out;
}

export default function TestBench() {
  const [model, setModel] = useState(null);
  const [state, setState] = useState('loading');
  const [rot, setRot] = useState(0);
  const [minConf, setMinConf] = useState(195);
  // 'full'  = squash the whole portrait photo (distorts opposite to live)
  // 'live'  = centre-crop to 16:9 first, reproducing the shipping geometry
  const [aspect, setAspect] = useState('live');
  const [modelKey, setModelKey] = useState('seg3');
  // 'painted' to judge the mask, 'source' to judge `expect` against what the
  // model actually saw.
  const [view, setView] = useState('painted');
  const [activeCfg, setActiveCfg] = useState(MODELS.seg3);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const paint = useMemo(() => ({ r: 169, g: 116, b: 79 }), []); // the brown swatch

  useEffect(() => {
    let alive = true;
    setModel(null);
    setState('loading');
    (async () => {
      try {
        // require() needs a literal path, so both are spelled out.
        const a = Asset.fromModule(
          modelKey === 'ade20k'
            ? require('../../assets/models/wall_ade20k.tflite')
            : require('../../assets/models/wall_seg.tflite'),
        );
        await a.downloadAsync();
        const m = await loadTensorflowModel({ url: a.localUri ?? a.uri }, 'default');
        if (!alive) return;
        // Set together so the mask geometry always describes the loaded model.
        setActiveCfg(MODELS[modelKey]);
        setModel(m);
        setState('ready');
      } catch (e) {
        console.error('[bench] model load failed', e);
        if (alive) setState('error');
      }
    })();
    return () => { alive = false; };
  }, [modelKey]);

  const runAll = useCallback(async () => {
    if (model == null || busy) return;
    setBusy(true);
    setProgress(0);
    const out = [];

    for (let i = 0; i < TEST_IMAGES.length; i++) {
      const entry = TEST_IMAGES[i];
      try {
        const asset = Asset.fromModule(entry.src);
        await asset.downloadAsync();
        const data = await Skia.Data.fromURI(asset.localUri ?? asset.uri);
        const fullImg = Skia.Image.MakeImageFromEncoded(data);
        if (fullImg == null) throw new Error('decode failed');

        const dec = decodeToModelSize(fullImg, aspect);
        if (dec == null || dec.px == null) throw new Error('offscreen surface unavailable');
        const rgba = dec.px;

        const N = MODEL_W * MODEL_H;
        const rgb = new Uint8Array(N * 3);
        for (let p = 0; p < N; p++) {
          rgb[p * 3] = rgba[p * 4];
          rgb[p * 3 + 1] = rgba[p * 4 + 1];
          rgb[p * 3 + 2] = rgba[p * 4 + 2];
        }

        const res = model.runSync([rotateRgb(rgb, rot)])[0];

        // Mask + mean wall luminance, read back through the inverse rotation.
        // The mask may be coarser than the 224x224 input (56x56 for ADE20K), so
        // mask pixel -> input pixel is scaled when sampling luminance.
        const M = activeCfg.mask;
        const NM = M * M;
        const isClasses = activeCfg.kind === 'classes';
        const step = MODEL_W / M;
        const maskA = new Uint8Array(NM);
        let wallPx = 0;
        // PASS 1 — the confident core, in MODEL space. This is also the number
        // the bench reports: `coverage` counts only what the model is SURE of,
        // which is what stays comparable when swapping models. The graded rim
        // below is a rendering detail and would otherwise inflate the score.
        const core = new Uint8Array(NM);
        let lumSum = 0;
        for (let p = 0; p < NM; p++) {
          const mi = modelIndex(p, rot, M);
          let isWall;
          if (isClasses) {
            isWall = res[mi] === ADE_WALL_IDX;
          } else {
            const o = mi * NUM_CLASSES;
            isWall =
              res[o + 1] > res[o] && res[o + 1] >= res[o + 2] && res[o + 1] >= minConf;
          }
          if (isWall) {
            core[p] = 1;
            wallPx++;
            const mx = p % M;
            const my = (p / M) | 0;
            const ri = ((((my * step) | 0) * MODEL_W) + ((mx * step) | 0)) * 4;
            lumSum += LR * rgba[ri] + LG * rgba[ri + 1] + LB * rgba[ri + 2];
          }
        }
        const coverage = (100 * wallPx) / NM;

        // PASS 2 — alpha: 255 for the core, a gated ramp below it. Mirrors the
        // live filter: the ramp fills the halo that a hard threshold left as
        // bare wall, and the adjacency gate stops it washing over object
        // interiors that happen to sit at the same confidence.
        let rampPx = 0;
        for (let p = 0; p < NM; p++) {
          if (core[p] === 1) { maskA[p] = 255; continue; }
          if (isClasses) continue;            // no score to ramp on
          const mi = modelIndex(p, rot, M);
          const o = mi * NUM_CLASSES;
          const bg = res[o], wall = res[o + 1], ceil = res[o + 2];
          if (!(wall > bg && wall >= ceil)) continue;
          const rival = bg > ceil ? bg : ceil;
          const margin = wall - rival;
          if (margin <= ALPHA_MARGIN_MIN) continue;
          const cx = p % M, cy = (p / M) | 0;
          const y0 = Math.max(0, cy - ALPHA_NEAR_RADIUS);
          const y1 = Math.min(M - 1, cy + ALPHA_NEAR_RADIUS);
          const x0 = Math.max(0, cx - ALPHA_NEAR_RADIUS);
          const x1 = Math.min(M - 1, cx + ALPHA_NEAR_RADIUS);
          let near = false;
          for (let yy = y0; yy <= y1 && !near; yy++) {
            const row = yy * M;
            for (let xx = x0; xx <= x1; xx++) {
              if (core[row + xx] === 1) { near = true; break; }
            }
          }
          if (!near) continue;
          let t = (margin - ALPHA_MARGIN_MIN) / (ALPHA_MARGIN_FULL - ALPHA_MARGIN_MIN);
          if (t > 1) t = 1;
          let a = (255 * Math.pow(t, ALPHA_RAMP_POW)) | 0;
          if (a > 254) a = 254;
          maskA[p] = a;
          if (a > 0) rampPx++;
        }

        const holePct = holeFraction(maskA, M, M);
        const missedPct = missedWallPct(maskA, core, rgba, M, step);

        // Luminance correction, same maths as the live filter: per-pixel, pulled
        // toward the paint and flattened toward the mean by LUM_FLATTEN.
        const Lpaint = (LR * paint.r + LG * paint.g + LB * paint.b) / 255;
        const Ltarget = Math.max(LUM_MIN, Math.min(LUM_MAX, Lpaint));
        const Lref = wallPx > 0 ? lumSum / wallPx / 255 : -1;

        const maskInfo = { ...IMG_INFO, width: M, height: M };
        const colBuf = new Uint8Array(NM * 4);
        const lumBuf = new Uint8Array(NM * 4);
        for (let p = 0; p < NM; p++) {
          const q = p * 4;
          colBuf[q] = paint.r; colBuf[q + 1] = paint.g; colBuf[q + 2] = paint.b;
          colBuf[q + 3] = maskA[p];
          // 128 is HardLight's identity — off-wall pixels stay untouched.
          let sv = 128;
          if (maskA[p] !== 0 && Lref >= 0) {
            const mi = modelIndex(p, rot, M);
            const smx = mi % M, smy = (mi / M) | 0;
            const ri = ((((smy * step) | 0) * MODEL_W) + ((smx * step) | 0)) * 4;
            const Lw = (LR * rgba[ri] + LG * rgba[ri + 1] + LB * rgba[ri + 2]) / 255;
            const Lwant = Ltarget + LUM_FLATTEN * (Lw - Lref);
            let g;
            if (Lwant <= Lw) g = Lw > 0.004 ? Lwant / (2 * Lw) : 0.5;
            else             g = Lw < 0.996 ? 1 - (1 - Lwant) / (2 * (1 - Lw)) : 0.5;
            sv = Math.max(0, Math.min(255, Math.round(g * 255)));
          }
          lumBuf[q] = sv; lumBuf[q + 1] = sv; lumBuf[q + 2] = sv;
          lumBuf[q + 3] = maskA[p];
        }
        const colImg = Skia.Image.MakeImage(
          maskInfo, Skia.Data.fromBytes(colBuf), M * 4);
        const lumImg = Lref >= 0
          ? Skia.Image.MakeImage(maskInfo, Skia.Data.fromBytes(lumBuf), M * 4)
          : null;

        // Composite at preview size, same pass order as live: luminance, then colour.
        // Draw only the region the model actually saw, so the mask lines up.
        const ph = Math.max(1, Math.round((PREVIEW_W * dec.sh) / dec.sw));
        const surf = Skia.Surface.MakeOffscreen(PREVIEW_W, ph);
        const cv = surf.getCanvas();
        const srcFull = Skia.XYWHRect(dec.sx, dec.sy, dec.sw, dec.sh);
        const dst = Skia.XYWHRect(0, 0, PREVIEW_W, ph);
        const srcMask = Skia.XYWHRect(0, 0, M, M);
        cv.drawImageRect(fullImg, srcFull, dst, pPlain);
        // Snapshot BEFORE the mask passes: this is exactly what the model was
        // fed, and it is the only correct reference for judging `expect`.
        // 'live' geometry centre-crops a 720x1280 portrait photo to a 720x405
        // band — it discards 68% of the picture, and specifically the ceiling
        // and floor, which are the parts that are NOT wall. Judging `expect`
        // from the full photo therefore under-counts wall badly and shows up as
        // a false over-painting bias. That already happened once; this view
        // exists so it cannot happen quietly again.
        const sourceB64 = surf.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, 80);
        if (lumImg != null) cv.drawImageRect(lumImg, srcMask, dst, pLum);
        cv.drawImageRect(colImg, srcMask, dst, pColor);
        const painted = surf.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, 80);

        out.push({
          file: entry.file,
          note: entry.note,
          coverage,
          // Ground truth from the manifest, judged once by eye. null until filled
          // in. `err` is SIGNED on purpose: negative means the model under-painted
          // (missed wall), positive means it over-painted (hit objects). A single
          // absolute number would hide which way it is failing, and those need
          // opposite fixes.
          expect: entry.expect != null ? entry.expect : null,
          err: entry.expect != null ? coverage - entry.expect : null,
          missedPct,
          holePct,
          rampPct: (100 * rampPx) / NM,
          Lref,
          painted: `data:image/jpeg;base64,${painted}`,
          source: `data:image/jpeg;base64,${sourceB64}`,
        });
      } catch (e) {
        out.push({ file: entry.file, note: entry.note, error: String(e) });
      }
      setProgress(i + 1);
      // Yield so the progress counter actually paints between images.
      await new Promise((r) => setTimeout(r, 0));
    }

    setResults(out);
    setBusy(false);
  }, [model, busy, rot, minConf, paint, aspect, activeCfg]);

  const avg = useMemo(() => {
    const ok = results.filter((r) => r.coverage != null);
    if (!ok.length) return null;
    return ok.reduce((s, r) => s + r.coverage, 0) / ok.length;
  }, [results]);

  // The number to actually drive decisions off: lower is better, and unlike
  // coverage it does not reward a model that paints everything.
  const avgHoles = useMemo(() => {
    const ok = results.filter((r) => r.holePct != null);
    if (!ok.length) return null;
    return ok.reduce((s, r) => s + r.holePct, 0) / ok.length;
  }, [results]);

  // Unpainted pixels that look like the wall. Kept, but it flags wall-coloured
  // OBJECTS as defects (16.jpg scored 27% on a pale drawer), so it is a hint and
  // not a score. See TESTSET.md for why all three automatic metrics failed.
  const avgMissed = useMemo(() => {
    const ok = results.filter((r) => r.missedPct != null);
    if (!ok.length) return null;
    return ok.reduce((s, r) => s + r.missedPct, 0) / ok.length;
  }, [results]);

  // THE score. Mean absolute error against the hand-judged ground truth — the
  // only number here that knows what is actually in the pictures. Lower is
  // better; it is the number a replacement model has to beat.
  const mae = useMemo(() => {
    const ok = results.filter((r) => r.err != null);
    if (!ok.length) return null;
    return {
      mae: ok.reduce((s, r) => s + Math.abs(r.err), 0) / ok.length,
      bias: ok.reduce((s, r) => s + r.err, 0) / ok.length,
      n: ok.length,
    };
  }, [results]);

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Test Bench</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.row}>
        {Object.keys(MODELS).map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.btn, modelKey === k && styles.btnOn]}
            onPress={() => setModelKey(k)}
          >
            <Text style={styles.btnText}>{MODELS[k].label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.row}>
        {ROTATIONS.map((d) => (
          <TouchableOpacity
            key={d}
            style={[styles.btn, rot === d && styles.btnOn]}
            onPress={() => setRot(d)}
          >
            <Text style={styles.btnText}>rot {d}°</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.row}>
        {[
          { k: 'live', label: 'live 16:9 geom' },
          { k: 'full', label: 'whole photo' },
        ].map((a) => (
          <TouchableOpacity
            key={a.k}
            style={[styles.btn, aspect === a.k && styles.btnOn]}
            onPress={() => setAspect(a.k)}
          >
            <Text style={styles.btnText}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.row}>
        {[0, 128, 195, 230].map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.btn, minConf === c && styles.btnOn]}
            onPress={() => setMinConf(c)}
          >
            <Text style={styles.btnText}>conf {c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.row}>
        {[
          { k: 'painted', label: 'painted result' },
          { k: 'source', label: 'source (what the model saw)' },
        ].map((v) => (
          <TouchableOpacity
            key={v.k}
            style={[styles.btn, view === v.k && styles.btnOn]}
            onPress={() => setView(v.k)}
          >
            <Text style={styles.btnText}>{v.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.run, (busy || state !== 'ready') && styles.runOff]}
        onPress={runAll}
        disabled={busy || state !== 'ready'}
      >
        <Text style={styles.runText}>
          {state === 'loading' ? 'Loading model…'
            : state === 'error' ? 'Model failed to load'
            : busy ? `Running ${progress}/${TEST_IMAGES.length}…`
            : `Run ${TEST_IMAGES.length} @ ${MODELS[modelKey].label} rot ${rot}° ${aspect}`}
        </Text>
      </TouchableOpacity>

      {avg != null && !busy && (
        <Text style={styles.avg}>
          {mae != null
            ? `MAE ${mae.mae.toFixed(1)}%  ·  bias ${mae.bias > 0 ? '+' : ''}${mae.bias.toFixed(1)}%  (${mae.n}/${TEST_IMAGES.length} judged)`
            : `no expect: values yet — fill them in manifest.js`}
          coverage {avg.toFixed(1)}%  ·  missed {avgMissed != null ? avgMissed.toFixed(2) : '—'}%  ·  {MODELS[modelKey].label}  ·  rot {rot}°  ·  {aspect}
        </Text>
      )}

      {busy && <ActivityIndicator style={{ marginTop: 8 }} color="#dc102e" />}

      <ScrollView contentContainerStyle={styles.list}>
        {results.map((r) => (
          <View key={r.file} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.file}>{r.file}</Text>
              {r.coverage != null && (
                <Text style={styles.cov}>{r.coverage.toFixed(1)}%</Text>
              )}
            </View>
            <Text style={styles.note}>{r.note}</Text>
            {r.error ? (
              <Text style={styles.err}>{r.error}</Text>
            ) : (
              <>
                <Image
                  source={{ uri: view === 'source' && r.source ? r.source : r.painted }}
                  style={styles.preview}
                  resizeMode="contain"
                />
                <Text style={styles.meta}>
                  {r.err != null
                    ? `expect ${r.expect}% → err ${r.err > 0 ? '+' : ''}${r.err.toFixed(1)}%  ·  `
                    : 'expect —  ·  '}
                  missed {r.missedPct.toFixed(2)}% · Lref {r.Lref >= 0 ? r.Lref.toFixed(3) : '—'} · rim {r.rampPct.toFixed(1)}%
                </Text>
              </>
            )}
          </View>
        ))}
        {results.length > 0 && (
          <Text style={styles.footer}>
            Coverage is not quality — a mask that paints the door too scores higher,
            not better. Read it next to the preview.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111827', paddingTop: 48 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  back: { color: '#fff', fontSize: 16, width: 60 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', paddingHorizontal: 12, gap: 8, marginBottom: 8 },
  btn: { flex: 1, backgroundColor: '#1f2937', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  btnOn: { backgroundColor: '#16a34a' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  run: { marginHorizontal: 12, backgroundColor: '#dc102e', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  runOff: { backgroundColor: '#4b5563' },
  runText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  avg: { color: '#fbbf24', textAlign: 'center', marginTop: 10, fontWeight: '700' },
  list: { padding: 12, paddingBottom: 48 },
  card: { backgroundColor: '#1f2937', borderRadius: 12, padding: 12, marginBottom: 12 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  file: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cov: { color: '#34d399', fontWeight: '700', fontSize: 15 },
  note: { color: '#9ca3af', fontSize: 12, marginBottom: 8 },
  preview: { width: '100%', height: 320, borderRadius: 8, backgroundColor: '#000' },
  meta: { color: '#6b7280', fontSize: 11, marginTop: 6 },
  err: { color: '#f87171', fontSize: 12 },
  footer: { color: '#6b7280', fontSize: 12, textAlign: 'center', marginTop: 8, paddingHorizontal: 12 },
});
