// ─────────────────────────────────────────────────────────────
// Room palette extraction.
//
// Given the camera's non-wall pixels (furniture, decor, floor — everything the
// segmentation model calls "bg"), return the room's dominant colours. Pure and
// camera-agnostic: the caller does the sampling+masking and hands us plain RGB
// samples, so this runs identically on a live frame or a test-set image.
//
// Median-cut in CIELAB, not k-means: deterministic and non-iterative, so the
// palette does not reorder or fail to converge between runs — the same
// instability AR_PAINT_PREVIEW.md fought in the mask, not worth inviting here.
// ─────────────────────────────────────────────────────────────
import { rgbToLab, labToLch, labToRgb, rgbToHex, deltaE } from './color';

const DEFAULTS = {
  k: 5,              // clusters to cut to
  minShare: 0.03,    // drop clusters below 3% of sampled pixels (noise)
  neutralChroma: 10, // C* below this is "neutral" (grey/beige), not a hue anchor
  mergeDeltaE: 8,    // fold clusters closer than this together (ΔE ~8 ≈ "same colour")
};

// Median cut over-splits a low-variance region into several near-identical
// boxes (a plain beige wall becomes five beiges). Fold clusters within a small
// ΔE into one, share-weighted, so the palette shows DISTINCT colours.
function mergeSimilar(list, minDE) {
  const kept = [];
  for (const c of list) {
    const near = kept.find((k) => deltaE(k.lab, c.lab) < minDE);
    if (near) {
      const w = near.share + c.share;
      near.lab = {
        L: (near.lab.L * near.share + c.lab.L * c.share) / w,
        a: (near.lab.a * near.share + c.lab.a * c.share) / w,
        b: (near.lab.b * near.share + c.lab.b * c.share) / w,
      };
      near.share = w;
    } else {
      kept.push({ lab: { ...c.lab }, share: c.share });
    }
  }
  return kept;
}

function channelRanges(box) {
  let Lmin = Infinity, Lmax = -Infinity;
  let amin = Infinity, amax = -Infinity;
  let bmin = Infinity, bmax = -Infinity;
  for (const p of box) {
    if (p.L < Lmin) Lmin = p.L; if (p.L > Lmax) Lmax = p.L;
    if (p.a < amin) amin = p.a; if (p.a > amax) amax = p.a;
    if (p.b < bmin) bmin = p.b; if (p.b > bmax) bmax = p.b;
  }
  return { L: Lmax - Lmin, a: amax - amin, b: bmax - bmin };
}

function meanLab(box) {
  let L = 0, a = 0, b = 0;
  for (const p of box) { L += p.L; a += p.a; b += p.b; }
  const n = box.length;
  return { L: L / n, a: a / n, b: b / n };
}

// Repeatedly split the box with the widest single channel at its median, along
// that channel — classic median cut, operating in Lab.
function medianCut(points, k) {
  let boxes = [points];
  while (boxes.length < k) {
    let target = -1, widest = -1, axis = 'L';
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const r = channelRanges(boxes[i]);
      const m = Math.max(r.L, r.a, r.b);
      if (m > widest) {
        widest = m;
        target = i;
        axis = r.L >= r.a && r.L >= r.b ? 'L' : r.a >= r.b ? 'a' : 'b';
      }
    }
    if (target < 0) break; // every box is a single point
    const box = boxes[target];
    box.sort((p, q) => p[axis] - q[axis]);
    const mid = box.length >> 1;
    boxes.splice(target, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes;
}

/**
 * @param {Array<{r,g,b}>} samples  Non-wall RGB pixels, already subsampled.
 * @returns {{ palette, anchor, chromatic, neutrals }}
 *   palette    all kept clusters, sorted by share, each {hex,rgb,lab,lch,share,neutral}
 *   anchor     most dominant CHROMATIC cluster (drives harmonies), or null
 *   chromatic  non-neutral clusters, by share
 *   neutrals   near-grey clusters, by share
 */
export function extractRoomPalette(samples, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!samples || samples.length === 0) {
    return { palette: [], anchor: null, chromatic: [], neutrals: [] };
  }

  const labs = samples.map(rgbToLab);
  const boxes = medianCut(labs, o.k).filter((b) => b.length > 0);
  const total = labs.length;

  // Cluster → {lab, share}, fold near-duplicates, THEN derive colour fields from
  // the merged Lab (so a merged swatch's hex reflects the combined mean).
  const merged = mergeSimilar(
    boxes.map((box) => ({ lab: meanLab(box), share: box.length / total })),
    o.mergeDeltaE,
  );

  const palette = merged
    .map((c) => {
      const lch = labToLch(c.lab);
      const rgb = labToRgb(c.lab);
      return {
        hex: rgbToHex(rgb),
        rgb,
        lab: c.lab,
        lch,
        share: c.share,
        neutral: lch.C < o.neutralChroma,
      };
    })
    .filter((c) => c.share >= o.minShare)
    .sort((a, b) => b.share - a.share);

  const chromatic = palette.filter((c) => !c.neutral);
  const neutrals = palette.filter((c) => c.neutral);

  return {
    palette,
    anchor: chromatic.length ? chromatic[0] : null,
    chromatic,
    neutrals,
  };
}
