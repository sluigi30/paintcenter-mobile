import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Modal
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
  ViroARSceneNavigator,
  ViroARScene,
  ViroARPlane,
  ViroBox,
  ViroMaterials,
  ViroAmbientLight,
} from '@reactvision/react-viro';

const PAINT_COLORS = [
  { name: 'Pure White',  hex: '#FFFFFF' },
  { name: 'Cream',       hex: '#FFFDD0' },
  { name: 'Sky Blue',    hex: '#87CEEB' },
  { name: 'Mint Green',  hex: '#98FF98' },
  { name: 'Peach',       hex: '#FFCBA4' },
  { name: 'Lavender',    hex: '#E6E6FA' },
  { name: 'Beige',       hex: '#F5F5DC' },
  { name: 'Light Gray',  hex: '#D3D3D3' },
  { name: 'Warm Yellow', hex: '#FFE066' },
  { name: 'Terracotta',  hex: '#C1634E' },
  { name: 'Navy Blue',   hex: '#1B3A6B' },
  { name: 'Sage Green',  hex: '#B2C9AD' },
];

// Register materials at module level (once per app session)
ViroMaterials.createMaterials({
  plane_unselected: {
    diffuseColor: '#AADDFF',
    lightingModel: 'Constant',
  },
});
PAINT_COLORS.forEach(({ hex }) => {
  ViroMaterials.createMaterials({
    [`paint_${hex.replace('#', '')}`]: {
      diffuseColor: hex,
      lightingModel: 'Lambert',
    },
  });
});

// AR scene component — rendered inside ViroARSceneNavigator
// filledPlanes and callbacks live here to avoid stale-closure issues with viroAppProps
const ARWallScene = ({ sceneNavigator }) => {
  const { selectedColor, opacity, onFillCountChanged, onTrackingUpdated } =
    sceneNavigator.viroAppProps;

  const [anchors, setAnchors] = useState({});
  const [filledPlanes, setFilledPlanes] = useState({});

  // Keep viroAppProps values fresh inside callbacks
  const colorRef = useRef(selectedColor);
  const opacityRef = useRef(opacity);
  useEffect(() => { colorRef.current = selectedColor; }, [selectedColor]);
  useEffect(() => { opacityRef.current = opacity; }, [opacity]);

  const handleWallTapped = useCallback((anchorId) => {
    setFilledPlanes(prev => {
      const next = {
        ...prev,
        [anchorId]: { color: colorRef.current, opacity: opacityRef.current },
      };
      onFillCountChanged?.(Object.keys(next).length);
      return next;
    });
  }, [onFillCountChanged]);

  return (
    <ViroARScene
      anchorDetectionTypes={['PlanesVertical']}
      onTrackingUpdated={onTrackingUpdated}
      onAnchorFound={(a) => {
        if (a?.type === 'plane') {
          setAnchors(prev => ({ ...prev, [a.anchorId]: a }));
        }
      }}
      onAnchorUpdated={(a) => {
        if (a?.type === 'plane') {
          setAnchors(prev =>
            prev[a.anchorId] ? { ...prev, [a.anchorId]: a } : prev
          );
        }
      }}
      onAnchorRemoved={(a) => {
        if (!a) return;
        setAnchors(prev => {
          const next = { ...prev };
          delete next[a.anchorId];
          return next;
        });
      }}
    >
      <ViroAmbientLight color="#ffffff" intensity={400} />

      {Object.values(anchors).map((anchor) => {
        const fill = filledPlanes[anchor.anchorId];
        const matKey = fill
          ? `paint_${fill.color.replace('#', '')}`
          : 'plane_unselected';
        const fillOpacity = fill ? fill.opacity : 0.3;
        const w = anchor.width  || 1.5;
        const h = anchor.height || 1.5;
        const cx = anchor.center?.[0] ?? 0;
        const cy = anchor.center?.[1] ?? 0;
        const cz = anchor.center?.[2] ?? 0;

        return (
          <ViroARPlane key={anchor.anchorId} anchorId={anchor.anchorId}>
            <ViroBox
              // In ViroARPlane local space: XZ = wall surface, Y = outward normal
              width={w}
              height={0.005}
              length={h}
              position={[cx, cy, cz]}
              materials={[matKey]}
              opacity={fillOpacity}
              onClick={() => handleWallTapped(anchor.anchorId)}
            />
          </ViroARPlane>
        );
      })}
    </ViroARScene>
  );
};

export default function ARPreview() {
  const { hex } = useLocalSearchParams();
  const [selectedColor, setSelectedColor] = useState(hex || '#FFFFFF');
  const [opacity, setOpacity]             = useState(0.7);
  const [fillCount, setFillCount]         = useState(0);
  const [trackingState, setTrackingState] = useState(null);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const trackingMsg =
    trackingState === 1
      ? '⚠️ Limited tracking — move camera slowly'
      : '👆 Point at a wall — tap to paint it';

  return (
    <View style={styles.container}>
      <ViroARSceneNavigator
        autofocus
        initialScene={{ scene: ARWallScene }}
        viroAppProps={{
          selectedColor,
          opacity,
          onFillCountChanged: setFillCount,
          onTrackingUpdated: setTrackingState,
        }}
        style={StyleSheet.absoluteFill}
      />

      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>AR Paint Preview</Text>
        <View style={[styles.colorDot, { backgroundColor: selectedColor }]} />
      </View>

      {/* Status hint */}
      <View style={styles.statusBox}>
        <Text style={styles.statusText}>{trackingMsg}</Text>
        {fillCount > 0 && (
          <Text style={styles.fillCountText}>
            {fillCount} wall{fillCount !== 1 ? 's' : ''} painted
          </Text>
        )}
      </View>

      {/* Opacity presets */}
      <View style={styles.opacityContainer}>
        <Text style={styles.opacityLabel}>Opacity: {Math.round(opacity * 100)}%</Text>
        <View style={styles.opacityTrack}>
          {[0.3, 0.5, 0.7, 0.85, 1.0].map((val) => (
            <TouchableOpacity
              key={val}
              style={[styles.opacityStep, opacity === val && styles.opacityStepActive]}
              onPress={() => setOpacity(val)}
            >
              <Text style={styles.opacityStepText}>{Math.round(val * 100)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Bottom controls */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.colorBtn} onPress={() => setShowColorPicker(true)}>
          <Text style={styles.colorBtnText}>🎨 Change Color</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.estimatorBtn}
          onPress={() => router.push('/ar/estimator')}
        >
          <Text style={styles.estimatorText}>📐 Measure</Text>
        </TouchableOpacity>
      </View>

      {/* Color picker modal */}
      <Modal visible={showColorPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.colorPanel}>
            <Text style={styles.colorPanelTitle}>Select Paint Color</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {PAINT_COLORS.map((color) => (
                <TouchableOpacity
                  key={color.hex}
                  style={styles.colorItem}
                  onPress={() => { setSelectedColor(color.hex); setShowColorPicker(false); }}
                >
                  <View style={[
                    styles.colorCircle,
                    { backgroundColor: color.hex },
                    selectedColor === color.hex && styles.colorCircleSelected,
                  ]} />
                  <Text style={styles.colorName}>{color.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setShowColorPicker(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#000' },

  topBar:     { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 50, paddingHorizontal: 20, paddingBottom: 16, zIndex: 10 },
  backBtn:    { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  backText:   { color: '#fff', fontWeight: '600' },
  topTitle:   { color: '#fff', fontSize: 18, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  colorDot:   { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: '#fff' },

  statusBox:      { position: 'absolute', top: 120, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, padding: 10, zIndex: 10 },
  statusText:     { color: '#fff', fontSize: 13, textAlign: 'center' },
  fillCountText:  { color: '#f97316', fontSize: 12, textAlign: 'center', marginTop: 4, fontWeight: '600' },

  opacityContainer: { position: 'absolute', top: 200, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 16, padding: 12, zIndex: 10 },
  opacityLabel:     { color: '#fff', fontSize: 13, marginBottom: 8, textAlign: 'center' },
  opacityTrack:     { flexDirection: 'row', justifyContent: 'space-between' },
  opacityStep:      { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  opacityStepActive:{ backgroundColor: '#f97316' },
  opacityStepText:  { color: '#fff', fontSize: 11, fontWeight: '600' },

  bottomBar:      { position: 'absolute', bottom: 48, left: 20, right: 20, flexDirection: 'row', gap: 12, zIndex: 10 },
  colorBtn:       { flex: 1, backgroundColor: '#f97316', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  colorBtnText:   { color: '#fff', fontWeight: '600', fontSize: 15 },
  estimatorBtn:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  estimatorText:  { color: '#fff', fontWeight: '600', fontSize: 15 },

  modalOverlay:   { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  colorPanel:     { backgroundColor: '#1a1a1a', padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  colorPanelTitle:{ color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 16 },
  colorItem:      { alignItems: 'center', marginRight: 16 },
  colorCircle:    { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', marginBottom: 6 },
  colorCircleSelected: { borderColor: '#f97316', borderWidth: 3 },
  colorName:      { color: '#fff', fontSize: 10, textAlign: 'center', maxWidth: 60 },
  closeBtn:       { marginTop: 16, backgroundColor: '#f97316', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  closeBtnText:   { color: '#fff', fontWeight: '600', fontSize: 15 },
});
