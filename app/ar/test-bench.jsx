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
pColor.setImageFilter(Skia.ImageFilter.MakeBlur(3, 3, TileMode.Clamp, null));
const pMul = Skia.Paint();
pMul.setBlendMode(BlendMode.Multiply);
pMul.setImageFilter(Skia.ImageFilter.MakeBlur(3, 3, TileMode.Clamp, null));
const pScr = Skia.Paint();
pScr.setBlendMode(BlendMode.Screen);
pScr.setImageFilter(Skia.ImageFilter.MakeBlur(3, 3, TileMode.Clamp, null));
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
            maskA[p] = 255;
            wallPx++;
            const mx = p % M;
            const my = (p / M) | 0;
            const ri = ((((my * step) | 0) * MODEL_W) + ((mx * step) | 0)) * 4;
            lumSum += LR * rgba[ri] + LG * rgba[ri + 1] + LB * rgba[ri + 2];
          }
        }
        const coverage = (100 * wallPx) / NM;

        // Luminance correction, same maths as the live filter.
        const Lpaint = (LR * paint.r + LG * paint.g + LB * paint.b) / 255;
        const Ltarget = Math.max(LUM_MIN, Math.min(LUM_MAX, Lpaint));
        let grey = -1;
        let useScreen = false;
        if (wallPx > 0) {
          const Lref = lumSum / wallPx / 255;
          let g;
          if (Ltarget <= Lref) {
            g = Lref > 0.004 ? Ltarget / Lref : 1;
          } else {
            const d = 1 - Lref;
            g = d > 0.004 ? 1 - (1 - Ltarget) / d : 0;
            useScreen = true;
          }
          grey = Math.max(0, Math.min(255, Math.round(g * 255)));
        }

        const maskInfo = { ...IMG_INFO, width: M, height: M };
        const colBuf = new Uint8Array(NM * 4);
        const lumBuf = new Uint8Array(NM * 4);
        for (let p = 0; p < NM; p++) {
          const q = p * 4;
          colBuf[q] = paint.r; colBuf[q + 1] = paint.g; colBuf[q + 2] = paint.b;
          colBuf[q + 3] = maskA[p];
          lumBuf[q] = grey; lumBuf[q + 1] = grey; lumBuf[q + 2] = grey;
          lumBuf[q + 3] = maskA[p];
        }
        const colImg = Skia.Image.MakeImage(
          maskInfo, Skia.Data.fromBytes(colBuf), M * 4);
        const lumImg = grey >= 0
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
        if (lumImg != null) cv.drawImageRect(lumImg, srcMask, dst, useScreen ? pScr : pMul);
        cv.drawImageRect(colImg, srcMask, dst, pColor);
        const painted = surf.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, 80);

        out.push({
          file: entry.file,
          note: entry.note,
          coverage,
          grey,
          useScreen,
          painted: `data:image/jpeg;base64,${painted}`,
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
          mean coverage {avg.toFixed(1)}%  ·  {MODELS[modelKey].label}  ·  rot {rot}°  ·  {aspect}
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
                  source={{ uri: r.painted }}
                  style={styles.preview}
                  resizeMode="contain"
                />
                <Text style={styles.meta}>
                  grey {r.grey} · {r.useScreen ? 'screen (lighten)' : 'multiply (darken)'}
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
