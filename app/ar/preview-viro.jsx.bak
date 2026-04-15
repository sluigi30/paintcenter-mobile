/**
 * FULL AR VERSION WITH VIROREACT
 * 
 * This file requires a development build with native modules.
 * To use this version:
 * 1. npx expo prebuild --clean
 * 2. npx expo run:ios (or android)
 * 3. Rename this file to preview.jsx
 * 4. Rename preview.jsx to preview-camera.jsx (backup)
 * 
 * Requirements:
 * - Physical device (no simulators)
 * - iOS: iPhone 6s+ with ARKit
 * - Android: ARCore-supported device
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Dimensions, Modal
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import {
  ViroARScene,
  ViroARSceneNavigator,
  ViroARPlaneSelector,
  ViroBox,
  ViroMaterials,
  ViroNode,
  ViroFlexView,
  ViroText,
} from '@reactvision/react-viro';

const { width } = Dimensions.get('window');

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

const registerMaterials = () => {
  // Register color materials
  PAINT_COLORS.forEach((color) => {
    try {
      const matKey = color.hex.replace('#', '');
      ViroMaterials.registerMaterials({
        [`${matKey}_fill`]: {
          diffuseColor: color.hex,
          lightingModel: 'Phong',
          shininess: 1.0,
        },
      });
    } catch (e) {
      // Already registered
    }
  });

  // Register helper materials
  try {
    ViroMaterials.registerMaterials({
      reticle_material: {
        diffuseColor: '#f97316',
        lightingModel: 'Constant',
      },
      grid_material: {
        diffuseColor: '#CCCCCC',
        lightingModel: 'Phong',
        shininess: 2.0,
      },
    });
  } catch (e) {
    // Already registered
  }
};

function ARWallScene({ selectedColor, opacity, filledPlanes, onPlaneSelected }) {
  const [planes, setPlanes] = useState([]);
  const [trackingState, setTrackingState] = useState('');

  const onInitialized = useCallback(() => {
    console.log('AR Scene initialized');
  }, []);

  const onTrackingUpdated = useCallback(({ trackingState: state }) => {
    if (state !== trackingState) {
      setTrackingState(state);
    }
  }, [trackingState]);

  const onPlaneFound = useCallback((anchor) => {
    setPlanes((prev) => {
      if (prev.some((p) => p.anchorId === anchor.anchorId)) return prev;
      return [...prev, anchor];
    });
  }, []);

  const handlePlaneSelected = useCallback((anchor) => {
    if (onPlaneSelected) {
      onPlaneSelected(anchor);
    }
  }, [onPlaneSelected]);

  return (
    <ViroARScene
      onTrackingUpdated={onTrackingUpdated}
      onInitialized={onInitialized}
    >
      {/* Reticle */}
      <ViroNode position={[0, 0, -1]}>
        <ViroBox
          position={[0, 0, 0]}
          scale={[0.03, 0.03, 0.01]}
          materials={['reticle_material']}
        />
      </ViroNode>

      {/* Vertical plane selector for walls */}
      <ViroARPlaneSelector
        alignment={'Vertical'}
        minHeight={0.3}
        minWidth={0.3}
        onPlaneSelected={handlePlaneSelected}
        maxPlanes={15}
      />

      {/* Render detected planes with color fills */}
      {planes.map((anchor) => {
        const isFilled = filledPlanes.some((fp) => fp.anchorId === anchor.anchorId);
        const fillColor = isFilled
          ? filledPlanes.find((fp) => fp.anchorId === anchor.anchorId)?.color || selectedColor
          : selectedColor;
        const fillOpacity = isFilled
          ? filledPlanes.find((fp) => fp.anchorId === anchor.anchorId)?.opacity || opacity
          : opacity;
        const matKey = fillColor.replace('#', '');

        return (
          <ViroARPlane
            key={anchor.anchorId}
            anchorId={anchor.anchorId}
            alignment={'Vertical'}
            onAnchorFound={onPlaneFound}
          >
            {/* Color fill */}
            <ViroBox
              position={[0, 0, 0.01]}
              scale={[1, 1, 0.02]}
              materials={[`${matKey}_fill`]}
              opacity={fillOpacity}
            />
            {/* Grid border */}
            <ViroBox
              position={[0, 0, 0.02]}
              scale={[1.02, 1.02, 0.01]}
              materials={['grid_material']}
              opacity={0.3}
            />
          </ViroARPlane>
        );
      })}

      {/* Tracking indicator */}
      {trackingState === 'LIMITED' && (
        <ViroFlexView
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.5)',
            borderRadius: 0.02,
          }}
          position={[0, -0.15, -0.5]}
          width={0.4}
          height={0.05}
        >
          <ViroText
            text="Move camera slowly to detect walls"
            scale={[0.08, 0.08, 0.08]}
            color="#FFFFFF"
          />
        </ViroFlexView>
      )}
    </ViroARScene>
  );
}

export default function ARPreviewViro() {
  const { hex } = useLocalSearchParams();
  const [permission, setPermission] = useState(false);
  const [selectedColor, setSelectedColor] = useState(hex || '#FFFFFF');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [filledPlanes, setFilledPlanes] = useState([]);
  const [opacity, setOpacity] = useState(0.7);
  const arNavigatorRef = useRef(null);

  useEffect(() => {
    registerMaterials();
  }, []);

  const handlePlaneSelected = useCallback((anchor) => {
    setFilledPlanes((prev) => {
      const exists = prev.some((fp) => fp.anchorId === anchor.anchorId);
      if (exists) {
        return prev.map((fp) =>
          fp.anchorId === anchor.anchorId
            ? { ...fp, color: selectedColor, opacity }
            : fp
        );
      }
      return [...prev, { anchorId: anchor.anchorId, color: selectedColor, opacity }];
    });
  }, [selectedColor, opacity]);

  const handleOpacityChange = (newOpacity) => {
    setOpacity(newOpacity);
    setFilledPlanes((prev) =>
      prev.map((fp) => ({ ...fp, opacity: newOpacity }))
    );
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.logo}>🎨</Text>
          <Text style={styles.title}>AR Paint Preview</Text>
          <Text style={styles.subtitle}>
            Real wall detection with ARKit/ARCore
          </Text>
          <TouchableOpacity
            style={styles.startBtn}
            onPress={() => setPermission(true)}
          >
            <Text style={styles.startBtnText}>Start AR Experience</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backBtnSimple}
            onPress={() => router.back()}
          >
            <Text style={styles.backBtnSimpleText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ViroARSceneNavigator
        ref={arNavigatorRef}
        initialScene={{
          scene: () => (
            <ARWallScene
              selectedColor={selectedColor}
              opacity={opacity}
              filledPlanes={filledPlanes}
              onPlaneSelected={handlePlaneSelected}
            />
          ),
        }}
        style={styles.arScene}
      />

      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>AR Paint Preview</Text>
        <View style={[styles.colorDot, { backgroundColor: selectedColor }]} />
      </View>

      {/* Instructions */}
      <View style={styles.instructionsContainer}>
        <Text style={styles.instructionsText}>
          📱 Point at a wall and tap to fill it with color
        </Text>
      </View>

      {/* Opacity Control */}
      <View style={styles.opacityContainer}>
        <Text style={styles.opacityLabel}>
          Paint Opacity: {Math.round(opacity * 100)}%
        </Text>
        <View style={styles.opacityTrack}>
          {[0.3, 0.5, 0.7, 0.85, 1.0].map((val) => (
            <TouchableOpacity
              key={val}
              style={[styles.opacityStep, opacity === val && styles.opacityStepActive]}
              onPress={() => handleOpacityChange(val)}
            >
              <Text style={styles.opacityStepText}>{Math.round(val * 100)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Bottom Controls */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.colorPickerBtn}
          onPress={() => setShowColorPicker(!showColorPicker)}
        >
          <Text style={styles.colorPickerText}>🎨 Change Color</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.estimatorBtn}
          onPress={() => router.push('/ar/estimator')}
        >
          <Text style={styles.estimatorText}>📐 Measure Wall</Text>
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
  arScene: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#1a1a1a' },
  logo: { fontSize: 72, marginBottom: 20 },
  title: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 12, textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#999', textAlign: 'center', marginBottom: 32, lineHeight: 22 },
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
  opacityContainer: { position: 'absolute', bottom: 120, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 16, padding: 12 },
  opacityLabel: { color: '#fff', fontSize: 13, marginBottom: 8, textAlign: 'center', fontWeight: '600' },
  opacityTrack: { flexDirection: 'row', justifyContent: 'space-between' },
  opacityStep: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  opacityStepActive: { backgroundColor: '#f97316' },
  opacityStepText: { color: '#fff', fontSize: 11, fontWeight: '600' },
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
