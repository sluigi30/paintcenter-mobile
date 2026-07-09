import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, Modal, PanResponder, Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, router } from 'expo-router';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

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

export default function ARPreview() {
  const { hex }                           = useLocalSearchParams();
  const [permission, requestPermission]   = useCameraPermissions();
  const [selectedColor, setSelectedColor] = useState(hex || '#87CEEB');
  const [opacity, setOpacity]             = useState(0.6);
  const [wallRegions, setWallRegions]     = useState([]);
  const [currentRegion, setCurrentRegion] = useState(null);
  const [isAddingRegion, setIsAddingRegion] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const isAddingRef    = useRef(isAddingRegion);
  const startPoint     = useRef({ x: 0, y: 0 });
  const colorRef       = useRef(selectedColor);
  const opacityRef     = useRef(opacity);

  // Keep refs current so PanResponder callbacks (stable closures) read latest values
  useEffect(() => { isAddingRef.current  = isAddingRegion; }, [isAddingRegion]);
  useEffect(() => { colorRef.current     = selectedColor;  }, [selectedColor]);
  useEffect(() => { opacityRef.current   = opacity;        }, [opacity]);

  useEffect(() => {
    if (permission && !permission.granted) requestPermission();
  }, [permission]);

  // PanResponder for drawing wall regions — created once, reads state via refs
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => isAddingRef.current,
      onMoveShouldSetPanResponder:  () => isAddingRef.current,

      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        startPoint.current = { x: locationX, y: locationY };
        setCurrentRegion({ x: locationX, y: locationY, width: 0, height: 0 });
      },

      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const x = Math.min(startPoint.current.x, locationX);
        const y = Math.min(startPoint.current.y, locationY);
        setCurrentRegion({
          x,
          y,
          width:  Math.abs(locationX - startPoint.current.x),
          height: Math.abs(locationY - startPoint.current.y),
        });
      },

      onPanResponderRelease: () => {
        setCurrentRegion(prev => {
          if (prev && prev.width > 40 && prev.height > 40) {
            setWallRegions(regions => [
              ...regions,
              { ...prev, color: colorRef.current, opacity: opacityRef.current, id: Date.now().toString() },
            ]);
          }
          return null;
        });
        setIsAddingRegion(false);
      },
    })
  ).current;

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>Checking camera permission…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>Camera access is required for paint preview.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.permBtn, styles.permBtnSecondary]} onPress={() => router.back()}>
          <Text style={styles.permBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleClear = () =>
    Alert.alert('Clear All', 'Remove all painted regions?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => setWallRegions([]) },
    ]);

  return (
    <View style={styles.container}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" />

      {/* Gesture capture layer — sits above camera, below UI controls */}
      <View style={styles.gestureLayer} {...panResponder.panHandlers}>
        {/* Saved regions */}
        {wallRegions.map(r => (
          <View
            key={r.id}
            style={[styles.region, {
              left: r.x, top: r.y, width: r.width, height: r.height,
              backgroundColor: r.color, opacity: r.opacity,
            }]}
          />
        ))}
        {/* In-progress region */}
        {currentRegion && (
          <View
            style={[styles.region, styles.regionActive, {
              left: currentRegion.x, top: currentRegion.y,
              width: currentRegion.width, height: currentRegion.height,
              backgroundColor: selectedColor, opacity: opacity * 0.6,
            }]}
          />
        )}
      </View>

      {/* Top bar */}
      <View style={styles.topBar} pointerEvents="box-none">
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>Paint Preview</Text>
        <View style={[styles.colorDot, { backgroundColor: selectedColor }]} />
      </View>

      {/* Instruction banner */}
      <View style={styles.instructionBox} pointerEvents="none">
        <Text style={styles.instructionText}>
          {isAddingRegion
            ? '✏️ Drag to draw a wall region'
            : wallRegions.length === 0
              ? '👆 Tap "Add Region" to paint a wall'
              : `${wallRegions.length} region${wallRegions.length > 1 ? 's' : ''} painted`}
        </Text>
      </View>

      {/* Opacity row */}
      <View style={styles.opacityRow} pointerEvents="box-none">
        <Text style={styles.opacityLabel}>Opacity: {Math.round(opacity * 100)}%</Text>
        <View style={styles.opacityTrack}>
          {[0.3, 0.5, 0.65, 0.8, 1.0].map(v => (
            <TouchableOpacity
              key={v}
              style={[styles.opacityStep, opacity === v && styles.opacityStepActive]}
              onPress={() => {
                setOpacity(v);
                setWallRegions(prev => prev.map(r => ({ ...r, opacity: v })));
              }}
            >
              <Text style={styles.opacityStepText}>{Math.round(v * 100)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Bottom controls */}
      <View style={styles.bottomBar} pointerEvents="box-none">
        <TouchableOpacity
          style={[styles.addBtn, isAddingRegion && styles.addBtnActive]}
          onPress={() => setIsAddingRegion(v => !v)}
        >
          <Text style={styles.addBtnText}>
            {isAddingRegion ? '✕ Cancel' : '+ Add Region'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.colorBtn} onPress={() => setShowColorPicker(true)}>
          <Text style={styles.colorBtnText}>🎨</Text>
        </TouchableOpacity>
      </View>

      {wallRegions.length > 0 && (
        <View style={styles.secondaryBar} pointerEvents="box-none">
          <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
            <Text style={styles.clearBtnText}>🗑 Clear All</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.estimatorBtn} onPress={() => router.push('/ar/estimator')}>
            <Text style={styles.estimatorBtnText}>📐 Measure</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Color picker modal */}
      <Modal visible={showColorPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.colorPanel}>
            <Text style={styles.colorPanelTitle}>Select Paint Color</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {PAINT_COLORS.map(c => (
                <TouchableOpacity
                  key={c.hex}
                  style={styles.colorItem}
                  onPress={() => { setSelectedColor(c.hex); setShowColorPicker(false); }}
                >
                  <View style={[
                    styles.colorCircle, { backgroundColor: c.hex },
                    selectedColor === c.hex && styles.colorCircleSelected,
                  ]} />
                  <Text style={styles.colorName}>{c.name}</Text>
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
  container:    { flex: 1, backgroundColor: '#000' },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#111' },
  permText:     { color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 20 },
  permBtn:      { backgroundColor: '#f97316', borderRadius: 12, paddingHorizontal: 28, paddingVertical: 14, marginBottom: 0 },
  permBtnSecondary: { backgroundColor: '#555', marginTop: 12 },
  permBtnText:  { color: '#fff', fontWeight: '600', fontSize: 15 },

  gestureLayer: { ...StyleSheet.absoluteFillObject },
  region:       { position: 'absolute' },
  regionActive: { borderWidth: 2, borderColor: '#f97316', borderStyle: 'dashed' },

  topBar:       { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 50, paddingHorizontal: 20, paddingBottom: 16, zIndex: 20 },
  backBtn:      { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  backText:     { color: '#fff', fontWeight: '600' },
  topTitle:     { color: '#fff', fontSize: 18, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  colorDot:     { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: '#fff' },

  instructionBox: { position: 'absolute', top: 120, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, padding: 10, zIndex: 20 },
  instructionText:{ color: '#fff', fontSize: 13, textAlign: 'center' },

  opacityRow:   { position: 'absolute', top: 178, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, padding: 10, zIndex: 20 },
  opacityLabel: { color: '#fff', fontSize: 12, marginBottom: 6, textAlign: 'center' },
  opacityTrack: { flexDirection: 'row', justifyContent: 'space-between' },
  opacityStep:  { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  opacityStepActive: { backgroundColor: '#f97316' },
  opacityStepText:{ color: '#fff', fontSize: 11, fontWeight: '600' },

  bottomBar:    { position: 'absolute', bottom: 96, left: 20, right: 20, flexDirection: 'row', gap: 10, zIndex: 20 },
  addBtn:       { flex: 3, backgroundColor: '#f97316', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  addBtnActive: { backgroundColor: '#ef4444' },
  addBtnText:   { color: '#fff', fontWeight: '600', fontSize: 15 },
  colorBtn:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  colorBtnText: { color: '#fff', fontSize: 20 },

  secondaryBar: { position: 'absolute', bottom: 36, left: 20, right: 20, flexDirection: 'row', gap: 10, zIndex: 20 },
  clearBtn:     { flex: 1, backgroundColor: 'rgba(239,68,68,0.85)', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  clearBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  estimatorBtn: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  estimatorBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  modalOverlay:    { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  colorPanel:      { backgroundColor: '#1a1a1a', padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  colorPanelTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 16 },
  colorItem:       { alignItems: 'center', marginRight: 16 },
  colorCircle:     { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', marginBottom: 6 },
  colorCircleSelected: { borderColor: '#f97316', borderWidth: 3 },
  colorName:       { color: '#fff', fontSize: 10, textAlign: 'center', maxWidth: 60 },
  closeBtn:        { marginTop: 16, backgroundColor: '#f97316', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  closeBtnText:    { color: '#fff', fontWeight: '600', fontSize: 15 },
});
