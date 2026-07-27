/**
 * AR WALL PAINT PREVIEW — real ARCore/ARKit world tracking via ViroReact.
 *
 * Requires a development build with native modules (`npx expo run:android`) and
 * a physical, AR-certified device (Android: ARCore-certified; iOS: ARKit).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CENTRAL PROBLEM, AND HOW THIS SCREEN SOLVES IT
 * ─────────────────────────────────────────────────────────────────────────────
 * ARCore reports only the surface regions it has actually observed features on.
 * One real wall therefore arrives as SEVERAL disconnected fragments (measured on
 * device: 7 vertical planes for two walls), and painting one fragment paints a
 * small quadrilateral floating mid-wall — nothing like a painted wall.
 *
 * So we do not paint fragments. We group every vertical plane into COPLANAR
 * CLUSTERS — one cluster per real wall — bound each cluster's full extent, and
 * extend it down to the detected floor and up to a standard wall height (ARCore
 * rarely observes features near the skirting or ceiling). One cluster becomes
 * one wall-sized quad, and it grows as the user keeps scanning.
 *
 * Wall choice is automatic: the LARGEST cluster wins. A real wall is metres
 * across while a TV or cabinet face is centimetres, so this picks the wall and
 * rejects furniture without needing semantic classification (which ARCore does
 * not provide — its `classification` field is derived from plane orientation, so
 * a vertical cabinet face also reports "Wall").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO WAYS TO GET A WALL
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. 'auto'  — the clustering above. Needs a wall with SOME visible texture;
 *     ARCore fits planes to visual feature points.
 *  2. 'guide' — for a large, flat, evenly-lit wall that yields no vertical plane
 *     at all (a blank wall has no features to fit): tap the two corners where
 *     the wall meets the FLOOR, which ARCore does detect reliably, and the wall
 *     is derived from them. See `wallFromBasePoints`.
 *
 * Known limitation: a merged wall is a rectangle, so a doorway or window inside
 * the merged span gets painted over. Fixing that properly needs per-pixel depth
 * clipping (ARCore Depth API via Viro's shader modifiers) or segmentation.
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Dimensions, Modal, Linking, ActivityIndicator, PixelRatio,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import {
  ViroARScene,
  ViroARSceneNavigator,
  ViroMaterials,
  ViroAmbientLight,
  ViroQuad,
  ViroSphere,
  isARSupportedOnDevice,
} from '@reactvision/react-viro';

const { width, height } = Dimensions.get('window');

const PAINT_COLORS = [
  { name: 'Pure White',    hex: '#FFFFFF' },
  { name: 'Cream',         hex: '#FFFDD0' },
  { name: 'Sky Blue',      hex: '#87CEEB' },
  { name: 'Mint Green',    hex: '#98FF98' },
  { name: 'Peach',         hex: '#FFCBA4' },
  { name: 'Lavender',      hex: '#E6E6FA' },
  { name: 'Beige',         hex: '#F5F5DC' },
  { name: 'Light Gray',    hex: '#D3D3D3' },
];

/** Material for the little spheres marking tapped wall-base corners. */
const MARKER_MATERIAL = 'base_marker';

/** Standard interior wall heights (metres). */
const WALL_HEIGHTS = [2.4, 2.7, 3.0];

// Viro reports tracking state/reason as numeric enums (ViroConstants.ts).
const TRACKING_STATE = { 1: 'UNAVAILABLE', 2: 'LIMITED', 3: 'NORMAL' };
const TRACKING_REASON = { 1: 'none', 2: 'excessive motion', 3: 'insufficient features' };

/**
 * Two paint finishes, because they fail in opposite directions:
 *
 *  - 'realistic' uses blendMode 'Multiply', so the wall's own luminance
 *    survives — shadows, texture and corner shading stay visible and it reads
 *    like real paint. But Multiply can only ever DARKEN, so a light colour over
 *    a dark wall shows almost nothing.
 *  - 'solid' is flat opaque coverage. Loses texture, but it's the only way to
 *    preview a light colour over a dark wall.
 */
const FINISHES = [
  { key: 'realistic', label: 'Realistic', blendMode: 'Multiply' },
  { key: 'solid',     label: 'Solid',     blendMode: 'None' },
];

/** Stable, collision-free material name per (colour, finish) pair. */
const paintMaterialName = (hex, finishKey) =>
  `paint_${String(hex).replace('#', '').toLowerCase()}_${finishKey}`;

/**
 * Register a material per finish for the given colour.
 *
 * Named per-colour rather than mutating one shared material: Viro caches
 * materials natively by name, and re-registering an existing name does not
 * reliably refresh nodes already using it.
 *
 * lightingModel 'Constant' means the fill ignores scene lights — paint should
 * read flat, and it keeps the result independent of however ARCore happens to
 * estimate room lighting.
 */
const registerPaintMaterials = (hex) => {
  const materials = {};
  FINISHES.forEach(({ key, blendMode }) => {
    materials[paintMaterialName(hex, key)] = {
      diffuseColor: hex,
      lightingModel: 'Constant',
      blendMode,
      cullMode: 'None',           // a wall quad can be viewed from either side
      writesToDepthBuffer: false, // it's a coat of paint, not an object
      // Occlusion works by depth-TESTING our quad against ARCore's depth map, so
      // the paint must read the depth buffer or nearer real objects (cabinets,
      // furniture, people) will draw underneath it instead of in front.
      readsFromDepthBuffer: true,
    };
  });
  try {
    ViroMaterials.createMaterials(materials);
  } catch (e) {
    // Already registered for this colour — harmless.
  }
};

try {
  ViroMaterials.createMaterials({
    [MARKER_MATERIAL]: {
      diffuseColor: '#f97316',
      lightingModel: 'Constant',
    },
  });
} catch (e) {
  // Already registered.
}

// --- Small vector helpers (world space, metres) -------------------------------
const DEG = Math.PI / 180;
const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vCross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vNorm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l < 1e-6 ? null : vScale(a, 1 / l);
};

/**
 * Rotate a vector by Viro's Euler angles (degrees), matching the native
 * convention R = Rx·Ry·Rz used by VROMatrix4f. (ViroARPlaneSelector's source
 * documents the inverse of this same matrix for world→plane-local conversion,
 * which is what this was checked against.)
 */
const rotateEuler = ([x, y, z], [rx, ry, rz]) => {
  const c1 = Math.cos(rx * DEG), s1 = Math.sin(rx * DEG);
  const c2 = Math.cos(ry * DEG), s2 = Math.sin(ry * DEG);
  const c3 = Math.cos(rz * DEG), s3 = Math.sin(rz * DEG);
  return [
    (c2 * c3) * x + (-c2 * s3) * y + (s2) * z,
    (c1 * s3 + s1 * s2 * c3) * x + (c1 * c3 - s1 * s2 * s3) * y + (-s1 * c2) * z,
    (s1 * s3 - c1 * s2 * c3) * x + (s1 * c3 + c1 * s2 * s3) * y + (c1 * c2) * z,
  ];
};

/** A plane's local +Y is its surface normal; convert to world space. */
const planeNormal = (plane) =>
  plane?.rotation ? vNorm(rotateEuler([0, 1, 0], plane.rotation)) : null;

/** Plane-local vertex (the surface lies in local XZ) to world space. */
const vertexToWorld = (plane, local) =>
  vAdd(rotateEuler(local, plane.rotation), plane.position);

const isVertical = (plane) => String(plane?.alignment ?? '').includes('Vertical');
const isFloorish = (plane) => String(plane?.alignment ?? '').includes('HorizontalUpward');

// Coplanarity thresholds — deliberately loose, ARCore fragments are noisy.
const NORMAL_AGREEMENT = 0.94; // ≈20° between normals
const COPLANAR_SLOP = 0.25;    // 25 cm off the plane still counts as the same wall

/**
 * Plausibility gate: is this cluster big enough to actually BE a wall?
 *
 * Learned on device. ARCore reports vertical planes for cabinet doors, TV faces
 * and appliance fronts just as readily as for walls — its `classification` can't
 * tell them apart (it's derived from orientation). Without a size gate we paint
 * a 0.66 m cabinet door and then stretch it to full wall height, producing a
 * tall orange column floating in the room.
 *
 * A cabinet door or appliance front is ~0.4–0.6 m wide; a paintable wall is
 * metres. Requiring some observed HEIGHT too rejects thin horizontal slivers
 * (counter edges, shelf fronts) that happen to span a wide span.
 */
const MIN_WALL_WIDTH = 1.2;     // metres of observed horizontal extent
const MIN_WALL_OBSERVED_H = 0.5; // metres of observed vertical extent

/**
 * Build a vertical wall quad from two points along its base.
 *
 * Geometry: ViroQuad lies in its local XY plane with width along local +X. We
 * only ever rotate about Y (world up), so local +Y stays world up and the result
 * is exactly vertical. Rotating by θ about Y maps (1,0,0) to (cosθ, 0, −sinθ),
 * so aligning local +X with the base direction (dx, 0, dz) gives
 * θ = atan2(−dz, dx).
 */
const wallFromBasePoints = (p1, p2, wallHeight) => {
  if (!p1 || !p2) return null;
  const dx = p2[0] - p1[0];
  const dz = p2[2] - p1[2];
  const wallWidth = Math.hypot(dx, dz);
  // Two points nearly on top of each other give a degenerate sliver.
  if (wallWidth < 0.15) return null;

  const baseY = Math.min(p1[1], p2[1]);
  return {
    width: wallWidth,
    height: wallHeight,
    // A quad is centred on its origin, so lift it by half its height.
    center: [(p1[0] + p2[0]) / 2, baseY + wallHeight / 2, (p1[2] + p2[2]) / 2],
    yawDeg: (Math.atan2(-dz, dx) * 180) / Math.PI,
  };
};

/**
 * Group vertical planes into coplanar clusters — one cluster per real wall.
 *
 * Two fragments belong together when their normals agree (abs() because a wall
 * seen from the far side reports a flipped normal) AND one's origin lies close
 * to the other's plane. Parallel walls on opposite sides of a room share a
 * normal but are metres apart, which the distance test separates.
 */
const clusterVerticalPlanes = (planes) => {
  const clusters = [];
  for (const plane of planes) {
    if (!isVertical(plane) || !plane?.position) continue;
    const n = planeNormal(plane);
    if (!n) continue;

    const existing = clusters.find(
      (c) =>
        Math.abs(vDot(c.normal, n)) >= NORMAL_AGREEMENT &&
        Math.abs(vDot(vSub(plane.position, c.origin), c.normal)) <= COPLANAR_SLOP
    );
    if (existing) existing.planes.push(plane);
    else clusters.push({ normal: n, origin: plane.position, planes: [plane] });
  }
  return clusters;
};

/**
 * Collapse one coplanar cluster into a single wall-sized quad.
 *
 * Basis: n = wall normal, v = world up, u = n × up (horizontal, lying in the
 * wall). A wall's normal is horizontal so u is well defined; for a horizontal
 * surface the cross product degenerates, which is how floors get rejected.
 *
 * `area` is the OBSERVED extent, computed before the floor/height extension —
 * otherwise extending every candidate by the same height would flatten the size
 * difference that lets us tell a wall from a cabinet door.
 */
const wallFromCluster = (cluster, floorY, wallHeight) => {
  const n = cluster.normal;
  const u = vNorm(vCross(n, [0, 1, 0]));
  if (!u) return null;
  const v = [0, 1, 0];
  const O = cluster.origin;

  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const plane of cluster.planes) {
    // Fall back to the anchor origin when ARCore hasn't produced a polygon yet.
    const locals = plane.vertices?.length >= 3 ? plane.vertices : [[0, 0, 0]];
    for (const local of locals) {
      const d = vSub(vertexToWorld(plane, local), O);
      if (Math.abs(vDot(d, n)) > COPLANAR_SLOP) continue;
      const du = vDot(d, u);
      const dv = vDot(d, v);
      if (du < uMin) uMin = du;
      if (du > uMax) uMax = du;
      if (dv < vMin) vMin = dv;
      if (dv > vMax) vMax = dv;
    }
  }
  if (!Number.isFinite(uMin)) return null;

  const observedW = uMax - uMin;
  const observedH = vMax - vMin;
  // Reject anything that isn't wall-shaped BEFORE extending it, otherwise a
  // cabinet door becomes an orange column.
  if (observedW < MIN_WALL_WIDTH || observedH < MIN_WALL_OBSERVED_H) return null;

  // ARCore almost never sees features at the skirting or up by the ceiling, so
  // start at the real floor when we know it and rise EXACTLY the chosen height.
  // (Taking max(observed, floor+height) instead let a bad floor estimate produce
  // a 3.05 m wall when 2.4 m was selected.)
  const baseV = Number.isFinite(floorY) ? floorY - O[1] : vMin;
  const baseLeft = vAdd(O, vAdd(vScale(u, uMin), vScale(v, baseV)));
  const baseRight = vAdd(O, vAdd(vScale(u, uMax), vScale(v, baseV)));
  const wall = wallFromBasePoints(baseLeft, baseRight, wallHeight);
  if (!wall) return null;

  return {
    ...wall,
    fragments: cluster.planes.length,
    area: observedW * observedH,
  };
};

/**
 * Pick the most trustworthy hit from an AR hit test. Real tracked planes beat
 * ARCore's estimated plane, which beats a bare feature point — but a feature
 * point is still worth accepting, since on a sparse floor it may be all we get.
 */
const HIT_PREFERENCE = [
  'ExistingPlaneUsingExtent',
  'ExistingPlane',
  'EstimatedHorizontalPlane',
  'DepthPoint',
  'FeaturePoint',
];

const pickBestHit = (results) => {
  if (!Array.isArray(results) || results.length === 0) return null;
  for (const type of HIT_PREFERENCE) {
    const match = results.find((r) => r?.type === type && r?.transform?.position);
    if (match) return match;
  }
  return results.find((r) => r?.transform?.position) ?? null;
};

function ARWallScene(props) {
  const nav = props.arSceneNavigator ?? props.sceneNavigator;
  // Read live values through viroAppProps. A scene is constructed ONCE from
  // `initialScene`, so anything captured in that closure freezes at mount —
  // this is the only channel that sees later colour/finish changes.
  const app = nav?.viroAppProps ?? {};
  const { paintMaterial, onAnchorData, onAnchorGone, onTrackingChange, basePoints, wall } = app;
  const sceneRef = app.sceneRef;

  const handleTrackingUpdated = useCallback((state, reason) => {
    // Viro reports these as NUMBERS, not strings.
    onTrackingChange?.({ state, reason });
  }, [onTrackingChange]);

  const handleAnchorFound = useCallback((anchor) => {
    // Single-line JSON on purpose: console.log of an object pretty-prints over
    // several logcat lines and only the FIRST carries the '[AR]' tag, so any
    // grep/Select-String filter silently drops the rest of the payload.
    console.log(
      '[AR] anchor found ' +
        JSON.stringify({
          type: anchor?.type,
          align: anchor?.alignment,
          cls: anchor?.classification,
          w: anchor?.width,
          h: anchor?.height,
          verts: anchor?.vertices?.length ?? 0,
        })
    );
    onAnchorData?.(anchor);
  }, [onAnchorData]);

  // ARCore refines a plane's polygon continuously as more of it is observed,
  // which is exactly how a merged wall grows — so updates matter as much as
  // finds and both feed the same store.
  const handleAnchorUpdated = useCallback((anchor) => {
    onAnchorData?.(anchor);
  }, [onAnchorData]);

  const handleAnchorRemoved = useCallback((anchor) => {
    // ViroARScene can fire this with undefined.
    if (anchor?.anchorId) onAnchorGone?.(anchor.anchorId);
  }, [onAnchorGone]);

  return (
    <ViroARScene
      ref={sceneRef}
      // Detect BOTH orientations even though we only paint walls: ARCore
      // establishes gravity, scale and a tracking baseline from the floor, and
      // vertical-plane fitting is measurably worse with horizontal off. We also
      // need the floor's height to extend walls down to the skirting.
      anchorDetectionTypes={['PlanesHorizontal', 'PlanesVertical']}
      onAnchorFound={handleAnchorFound}
      onAnchorUpdated={handleAnchorUpdated}
      onAnchorRemoved={handleAnchorRemoved}
      onTrackingUpdated={handleTrackingUpdated}
      onInitialized={() => console.log('[AR] scene initialized')}
    >
      {/* Constant-lit materials ignore lights, but anything added later using
          Phong/Lambert would render pure black without this. */}
      <ViroAmbientLight color="#ffffff" intensity={250} />

      {/* Manual mode: markers for each tapped wall-base corner. */}
      {(basePoints ?? []).map((p, i) => (
        <ViroSphere
          key={`base-${i}-${p.join(',')}`}
          position={p}
          radius={0.025}
          materials={[MARKER_MATERIAL]}
        />
      ))}

      {wall && (
        <ViroQuad
          position={wall.center}
          rotation={[0, wall.yawDeg, 0]}
          width={wall.width}
          height={wall.height}
          materials={[paintMaterial]}
        />
      )}
    </ViroARScene>
  );
}

export default function ARPreviewViro() {
  const { hex } = useLocalSearchParams();
  const [permission, requestPermission] = useCameraPermissions();

  // 'checking' -> 'supported' | 'unsupported'
  const [arSupport, setArSupport] = useState({ state: 'checking', reason: null });
  const [selectedColor, setSelectedColor] = useState(hex || '#FFFFFF');
  const [finish, setFinish] = useState('realistic');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [tracking, setTracking] = useState(null);
  const [wallHeight, setWallHeight] = useState(2.4);
  const sceneRef = useRef(null);

  // 'auto'  = cluster ARCore's vertical planes into walls, paint the largest
  // 'guide' = derive the wall from two taps along its base on the floor
  const [mode, setMode] = useState('auto');
  const [basePoints, setBasePoints] = useState([]);
  const [guideError, setGuideError] = useState(null);

  // Which of the detected walls to paint, by size rank. Cycled by "Next wall".
  const [wallIndex, setWallIndex] = useState(0);

  /**
   * Depth-based occlusion: ARCore builds a per-pixel depth map, and anything
   * real that is NEARER than the wall quad hides it. That is what stops paint
   * covering cabinets, furniture and people standing in front of the wall — a
   * flat quad has no holes, so occlusion is the only way to carve them out.
   *
   * Kept as a toggle rather than always-on: it needs ARCore Depth API support,
   * and this device's logs show its ML depth provider failing
   * (feature_track_ml_depth_provider.cc), so it may be unreliable here.
   * `depthDebug` paints the camera feed by distance (magenta = NO depth data)
   * which tells us in one glance whether depth works at all on this phone.
   */
  const [occlusion, setOcclusion] = useState(true);
  const [depthDebug, setDepthDebug] = useState(false);

  // Live plane store. Kept in a ref because ARCore fires anchor updates many
  // times a second and re-rendering on each would thrash; `revision` below is
  // the throttled signal that recomputation is due.
  const planesRef = useRef(new Map());
  const floorYRef = useRef(null);
  const [revision, setRevision] = useState(0);
  const lastRecomputeRef = useRef(0);
  const [anchorCount, setAnchorCount] = useState(0);
  const seenAnchors = useRef(new Set());

  /**
   * The real certification gate. ARCore *services* being installed does not mean
   * the device is certified — this wraps ArCoreApk.checkAvailability(), which is
   * authoritative. Checking up front turns "the AR screen crashed" into an
   * explainable message plus a working fallback.
   */
  useEffect(() => {
    let cancelled = false;
    isARSupportedOnDevice()
      .then((result) => {
        if (cancelled) return;
        console.log('[AR] isARSupportedOnDevice ->', result);
        setArSupport(
          result?.isARSupported
            ? { state: 'supported', reason: null }
            : { state: 'unsupported', reason: result?.notSupportedReason ?? null }
        );
      })
      .catch((err) => {
        if (cancelled) return;
        console.log('[AR] isARSupportedOnDevice failed', err);
        setArSupport({ state: 'unsupported', reason: String(err?.message ?? err) });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    registerPaintMaterials(selectedColor);
  }, [selectedColor]);

  const handleAnchorData = useCallback((anchor) => {
    if (!anchor?.anchorId) return;

    if (!seenAnchors.current.has(anchor.anchorId)) {
      seenAnchors.current.add(anchor.anchorId);
      setAnchorCount((c) => c + 1);
    }

    if (anchor.type !== 'plane') return;
    planesRef.current.set(anchor.anchorId, anchor);

    // Lowest upward-facing plane is our best guess at the floor, and walls get
    // extended down to it.
    if (isFloorish(anchor) && Number.isFinite(anchor.position?.[1])) {
      const y = anchor.position[1];
      floorYRef.current = floorYRef.current == null ? y : Math.min(floorYRef.current, y);
    }

    const now = Date.now();
    if (now - lastRecomputeRef.current > 400) {
      lastRecomputeRef.current = now;
      setRevision((r) => r + 1);
    }
  }, []);

  const handleAnchorGone = useCallback((anchorId) => {
    if (planesRef.current.delete(anchorId)) setRevision((r) => r + 1);
  }, []);

  // Walls, largest observed area first. `revision` is the intentional trigger —
  // the plane data itself lives in a ref.
  const { walls, clusterCount } = useMemo(() => {
    const clusters = clusterVerticalPlanes([...planesRef.current.values()]);
    return {
      clusterCount: clusters.length,
      walls: clusters
        .map((c) => wallFromCluster(c, floorYRef.current, wallHeight))
        .filter(Boolean)
        .sort((a, b) => b.area - a.area),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, wallHeight]);

  const guideWall = useMemo(
    () =>
      basePoints.length === 2
        ? wallFromBasePoints(basePoints[0], basePoints[1], wallHeight)
        : null,
    [basePoints, wallHeight]
  );

  const autoWall = walls.length ? walls[wallIndex % walls.length] : null;
  const wall = mode === 'guide' ? guideWall : autoWall;

  const verticalPlaneCount = useMemo(
    () => [...planesRef.current.values()].filter(isVertical).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision]
  );

  const handleReset = useCallback(() => {
    setBasePoints([]);
    setGuideError(null);
    setWallIndex(0);
  }, []);

  /**
   * Manual-mode tap: hit-test the screen point against real AR geometry and
   * record it as a wall-base corner.
   */
  const handleGuideTap = useCallback(async (evt) => {
    const scene = sceneRef.current;
    if (!scene?.performARHitTestWithPoint) {
      setGuideError('AR scene not ready yet');
      return;
    }

    const { locationX, locationY } = evt.nativeEvent;
    // RN touch coordinates are in dp; the native hit test works in the AR view's
    // own pixel space, so scale by the device pixel ratio.
    const scale = PixelRatio.get();
    const px = Math.round(locationX * scale);
    const py = Math.round(locationY * scale);

    try {
      const results = await scene.performARHitTestWithPoint(px, py);
      console.log(
        '[AR] hit test ' +
          JSON.stringify({
            dp: [Math.round(locationX), Math.round(locationY)],
            px: [px, py],
            count: Array.isArray(results) ? results.length : 0,
            types: (results ?? []).map((r) => r?.type),
          })
      );

      const hit = pickBestHit(results);
      if (!hit) {
        setGuideError('Nothing detected there — aim at the floor by the wall');
        return;
      }

      setGuideError(null);
      const position = hit.transform.position;
      setBasePoints((prev) => (prev.length >= 2 ? [position] : [...prev, position]));
    } catch (err) {
      console.log('[AR] hit test failed', err);
      setGuideError('Hit test failed — see logs');
    }
  }, []);

  const goToEstimator = useCallback(() => {
    // Hand the measured extents to the estimator so the user doesn't retype
    // dimensions the phone already knows.
    router.push({
      pathname: '/ar/estimator',
      params: wall
        ? {
            width: wall.width.toFixed(2),
            height: wall.height.toFixed(2),
            hex: selectedColor,
          }
        : { hex: selectedColor },
    });
  }, [wall, selectedColor]);

  // ---- Gate 1: AR capability -------------------------------------------------
  if (arSupport.state === 'checking') {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#f97316" />
          <Text style={styles.checkingText}>Checking AR support…</Text>
        </View>
      </View>
    );
  }

  if (arSupport.state === 'unsupported') {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.logo}>📵</Text>
          <Text style={styles.title}>AR not available</Text>
          <Text style={styles.subtitle}>
            This device isn’t AR-certified, so real wall tracking can’t run.
            You can still preview colours with the camera filter.
          </Text>
          {arSupport.reason ? (
            <Text style={styles.reasonText}>{arSupport.reason}</Text>
          ) : null}
          <TouchableOpacity
            style={styles.startBtn}
            onPress={() =>
              router.replace({ pathname: '/ar/live-filter', params: { hex: selectedColor } })
            }
          >
            <Text style={styles.startBtnText}>Use Camera Filter</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backBtnSimple} onPress={() => router.back()}>
            <Text style={styles.backBtnSimpleText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ---- Gate 2: camera permission --------------------------------------------
  if (!permission || !permission.granted) {
    const askForCamera = async () => {
      const result = await requestPermission();
      if (!result.granted && !result.canAskAgain) {
        // Permanently denied — only Settings can undo it.
        Linking.openSettings();
      }
    };

    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.logo}>🎨</Text>
          <Text style={styles.title}>AR Paint Preview</Text>
          <Text style={styles.subtitle}>
            Real wall detection with ARKit/ARCore. Camera access is required.
          </Text>
          <TouchableOpacity style={styles.startBtn} onPress={askForCamera}>
            <Text style={styles.startBtnText}>Start AR Experience</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backBtnSimple} onPress={() => router.back()}>
            <Text style={styles.backBtnSimpleText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ViroARSceneNavigator
        initialScene={{ scene: ARWallScene }}
        // Real objects nearer than the wall hide the paint. See the note above.
        occlusionMode={occlusion ? 'depthBased' : 'disabled'}
        depthDebugEnabled={depthDebug}
        // Live channel into the scene — see the note in ARWallScene.
        viroAppProps={{
          paintMaterial: paintMaterialName(selectedColor, finish),
          onAnchorData: handleAnchorData,
          onAnchorGone: handleAnchorGone,
          onTrackingChange: setTracking,
          basePoints,
          wall,
          // The scene attaches its ViroARScene instance here so the RN-side touch
          // handler can run hit tests.
          sceneRef,
        }}
        style={styles.arScene}
      />

      {/* Manual mode swallows taps so they become hit tests. Rendered before the
          control panels so those stay tappable on top of it. */}
      {mode === 'guide' && (
        <View
          style={styles.touchCatcher}
          onStartShouldSetResponder={() => true}
          onResponderRelease={handleGuideTap}
        />
      )}

      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>AR Paint Preview</Text>
        <View style={[styles.colorDot, { backgroundColor: selectedColor }]} />
      </View>

      {/* Instructions / status */}
      <View style={styles.instructionsContainer}>
        <Text style={styles.instructionsText}>
          {guideError
            ? `⚠️ ${guideError}`
            : mode === 'guide'
              ? guideWall
                ? `Wall set · ${guideWall.width.toFixed(2)}m × ${wallHeight.toFixed(1)}m`
                : basePoints.length === 0
                  ? '① Tap where the wall meets the floor — left edge'
                  : '② Now tap the right edge, along the same wall base'
              : autoWall
                ? `Painted · ${autoWall.width.toFixed(2)}m × ${autoWall.height.toFixed(2)}m` +
                  ` (${autoWall.fragments} patch${autoWall.fragments === 1 ? '' : 'es'} merged)`
                : clusterCount > 0
                  ? `🔍 Found ${clusterCount} surface${clusterCount === 1 ? '' : 's'}, none wall-sized yet — keep sweeping, or set it manually`
                  : tracking?.reason === 3
                    ? '🕐 No texture here for ARCore to detect — try the manual option below'
                    : '📱 Sweep the phone sideways across the wall'}
        </Text>
        <Text style={styles.debugText}>
          anchors {anchorCount} · vertical {verticalPlaneCount} · surfaces {clusterCount} · walls {walls.length}
          {tracking?.state ? ` · ${TRACKING_STATE[tracking.state] ?? tracking.state}` : ''}
          {tracking?.reason > 1 ? ` (${TRACKING_REASON[tracking.reason]})` : ''}
        </Text>
      </View>

      {/* Finish + wall controls */}
      <View style={styles.finishContainer}>
        <Text style={styles.finishLabel}>Finish</Text>
        <View style={styles.finishRow}>
          {FINISHES.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.finishBtn, finish === f.key && styles.finishBtnActive]}
              onPress={() => setFinish(f.key)}
            >
              <Text style={styles.finishBtnText}>{f.label}</Text>
            </TouchableOpacity>
          ))}
          {mode === 'auto' && walls.length > 1 && (
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={() => setWallIndex((i) => (i + 1) % walls.length)}
            >
              <Text style={styles.finishBtnText}>
                ⇄ Next wall ({(wallIndex % walls.length) + 1}/{walls.length})
              </Text>
            </TouchableOpacity>
          )}
          {mode === 'guide' && basePoints.length > 0 && (
            <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
              <Text style={styles.finishBtnText}>↺ Start over</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.finishLabel}>Wall height</Text>
        <View style={styles.finishRow}>
          {WALL_HEIGHTS.map((h) => (
            <TouchableOpacity
              key={h}
              style={[styles.finishBtn, wallHeight === h && styles.finishBtnActive]}
              onPress={() => setWallHeight(h)}
            >
              <Text style={styles.finishBtnText}>{h.toFixed(1)}m</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.finishLabel}>Exclude objects in front</Text>
        <View style={styles.finishRow}>
          <TouchableOpacity
            style={[styles.finishBtn, occlusion && styles.finishBtnActive]}
            onPress={() => setOcclusion((o) => !o)}
          >
            <Text style={styles.finishBtnText}>{occlusion ? 'Occlusion ON' : 'Occlusion OFF'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.finishBtn, depthDebug && styles.finishBtnActive]}
            onPress={() => setDepthDebug((d) => !d)}
          >
            <Text style={styles.finishBtnText}>Depth view</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.modeBtn}
          onPress={() => {
            setMode((m) => (m === 'auto' ? 'guide' : 'auto'));
            handleReset();
          }}
        >
          <Text style={styles.modeBtnText}>
            {mode === 'auto'
              ? '✋ Wall not detected? Set it manually'
              : '🔍 Back to automatic detection'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Controls */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.colorPickerBtn}
          onPress={() => setShowColorPicker(!showColorPicker)}
        >
          <Text style={styles.colorPickerText}>🎨 Change Color</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.estimatorBtn} onPress={goToEstimator}>
          <Text style={styles.estimatorText}>
            {wall ? '📐 How much paint?' : '📐 Measure Wall'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Color Picker Modal */}
      <Modal visible={showColorPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Paint Color</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {PAINT_COLORS.map((color) => (
                <TouchableOpacity
                  key={color.hex}
                  style={styles.colorItem}
                  onPress={() => {
                    setSelectedColor(color.hex);
                    setShowColorPicker(false);
                  }}
                >
                  <View style={[styles.colorCircle, { backgroundColor: color.hex }]} />
                  <Text style={styles.colorName}>{color.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.closeModalBtn}
              onPress={() => setShowColorPicker(false)}
            >
              <Text style={styles.closeModalText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  // Explicit pixel size — Fabric's interop layer does not reliably apply
  // flex:1 to Viro's legacy AR view, leaving it 0x0 (black). Force full-screen.
  arScene: { position: 'absolute', left: 0, top: 0, width, height },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#1a1a1a' },
  logo: { fontSize: 72, marginBottom: 20 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 12, textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#999', textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  checkingText: { color: '#999', fontSize: 15, marginTop: 16 },
  reasonText: { color: '#666', fontSize: 12, textAlign: 'center', marginBottom: 24, fontStyle: 'italic' },
  startBtn: { backgroundColor: '#f97316', borderRadius: 14, paddingHorizontal: 32, paddingVertical: 16, marginBottom: 16 },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  backBtnSimple: { paddingVertical: 12, paddingHorizontal: 20 },
  backBtnSimpleText: { color: '#999', fontSize: 14 },
  topBar: { position: 'absolute', top: 60, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16 },
  backBtn: { backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  backText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  topTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  colorDot: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: '#fff' },
  instructionsContainer: { position: 'absolute', top: 130, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: 10 },
  instructionsText: { color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: '500' },
  debugText: { color: '#9ca3af', fontSize: 10, textAlign: 'center', marginTop: 6, fontVariant: ['tabular-nums'] },
  finishContainer: { position: 'absolute', bottom: 120, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 16, padding: 12 },
  finishLabel: { color: '#fff', fontSize: 13, marginBottom: 8, marginTop: 4, textAlign: 'center', fontWeight: '600' },
  finishRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  finishBtn: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  finishBtnActive: { backgroundColor: '#f97316' },
  finishBtnText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  resetBtn: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  modeBtn: { marginTop: 10, alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 },
  modeBtnText: { color: '#fbbf24', fontSize: 12, fontWeight: '600' },
  touchCatcher: { position: 'absolute', left: 0, top: 0, width, height },
  bottomBar: { position: 'absolute', bottom: 40, left: 20, right: 20, flexDirection: 'row', gap: 12 },
  colorPickerBtn: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  colorPickerText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  estimatorBtn: { flex: 1, backgroundColor: '#f97316', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  estimatorText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#1a1a1a', borderRadius: 20, padding: 24, width: width * 0.9 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 20, textAlign: 'center' },
  colorItem: { alignItems: 'center', marginRight: 16 },
  colorCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', marginBottom: 8 },
  colorName: { color: '#fff', fontSize: 10, textAlign: 'center', maxWidth: 70 },
  closeModalBtn: { marginTop: 20, backgroundColor: '#f97316', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  closeModalText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
