import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Dimensions, Modal, PanResponder, Alert
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, router } from 'expo-router';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';

const { width, height } = Dimensions.get('window');

// Color palette matching paint products
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

export default function ARPreview() {
  const { hex }                         = useLocalSearchParams();
  const [permission, requestPermission] = useCameraPermissions();
  const [selectedColor, setSelectedColor] = useState(hex || '#FFFFFF');
  const [opacity, setOpacity]           = useState(0.6);
  const [showColorPicker, setShowColorPicker] = useState(false);
  
  // Wall overlay regions (user can add multiple)
  const [wallRegions, setWallRegions] = useState([]);
  const [isAddingRegion, setIsAddingRegion] = useState(false);
  const [currentRegion, setCurrentRegion] = useState(null);
  const [gestureState, setGestureState] = useState({ startX: 0, startY: 0, x: 0, y: 0 });

  // Request permission on mount
  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  // Pan responder for drawing wall regions
  const panGesture = Gesture.Pan()
    .onBegin((event) => {
      if (isAddingRegion) {
        setGestureState({
          startX: event.x,
          startY: event.y,
          x: event.x,
          y: event.y,
        });
        setCurrentRegion({
          x: event.x,
          y: event.y,
          width: 0,
          height: 0,
        });
      }
    })
    .onUpdate((event) => {
      if (isAddingRegion && currentRegion) {
        const newX = Math.min(gestureState.startX, event.x);
        const newY = Math.min(gestureState.startY, event.y);
        const newWidth = Math.abs(event.x - gestureState.startX);
        const newHeight = Math.abs(event.y - gestureState.startY);
        
        setCurrentRegion({
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight,
        });
      }
    })
    .onEnd(() => {
      if (isAddingRegion && currentRegion && currentRegion.width > 50 && currentRegion.height > 50) {
        // Save the region
        setWallRegions((prev) => [
          ...prev,
          {
            ...currentRegion,
            color: selectedColor,
            opacity: opacity,
            id: Date.now().toString(),
          },
        ]);
        setIsAddingRegion(false);
        setCurrentRegion(null);
        Alert.alert('Wall Region Added', 'You can now add more regions or change colors.');
      } else if (isAddingRegion) {
        setIsAddingRegion(false);
        setCurrentRegion(null);
      }
    });

  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>Camera permission is required for AR preview.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleAddRegion = () => {
    setIsAddingRegion(!isAddingRegion);
    if (isAddingRegion) {
      setCurrentRegion(null);
    }
  };

  const handleClearRegions = () => {
    Alert.alert(
      'Clear All Regions',
      'Remove all painted wall regions?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => setWallRegions([]),
        },
      ]
    );
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      <CameraView style={styles.camera} facing="back">
        {/* Render saved wall regions */}
        {wallRegions.map((region) => (
          <View
            key={region.id}
            style={[
              styles.wallRegion,
              {
                left: region.x,
                top: region.y,
                width: region.width,
                height: region.height,
                backgroundColor: region.color,
                opacity: region.opacity,
              },
            ]}
          />
        ))}

        {/* Render current drawing region */}
        {isAddingRegion && currentRegion && (
          <View
            style={[
              styles.wallRegion,
              styles.currentRegion,
              {
                left: currentRegion.x,
                top: currentRegion.y,
                width: currentRegion.width,
                height: currentRegion.height,
                backgroundColor: selectedColor,
                opacity: opacity * 0.5,
              },
            ]}
          />
        )}

        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.topTitle}>Paint Preview</Text>
          <View style={[styles.colorDot, { backgroundColor: selectedColor }]} />
        </View>

        {/* Instructions */}
        {isAddingRegion && (
          <View style={styles.instructionsContainer}>
            <Text style={styles.instructionsText}>
              👆 Drag on the wall to select an area to paint
            </Text>
          </View>
        )}

        {!isAddingRegion && (
          <View style={styles.instructionsContainer}>
            <Text style={styles.instructionsText}>
              📱 Tap "Add Wall Region" to draw on walls
            </Text>
          </View>
        )}

        {/* Opacity slider */}
        <View style={styles.opacityContainer}>
          <Text style={styles.opacityLabel}>Opacity: {Math.round(opacity * 100)}%</Text>
          <View style={styles.opacityTrack}>
            {[0.3, 0.5, 0.6, 0.7, 0.85].map((val) => (
              <TouchableOpacity
                key={val}
                style={[
                  styles.opacityStep,
                  opacity === val && styles.opacityStepActive
                ]}
                onPress={() => {
                  setOpacity(val);
                  // Update existing regions
                  setWallRegions((prev) =>
                    prev.map((r) => ({ ...r, opacity: val }))
                  );
                }}
              >
                <Text style={styles.opacityStepText}>{Math.round(val * 100)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Bottom controls */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.addRegionBtn, isAddingRegion && styles.addRegionBtnActive]}
            onPress={handleAddRegion}
          >
            <Text style={styles.addRegionBtnText}>
              {isAddingRegion ? '✕ Cancel' : '+ Add Wall Region'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.colorPickerBtn}
            onPress={() => setShowColorPicker(!showColorPicker)}
          >
            <Text style={styles.colorPickerText}>🎨 Color</Text>
          </TouchableOpacity>
        </View>

        {/* Secondary controls */}
        {wallRegions.length > 0 && (
          <View style={styles.secondaryBar}>
            <TouchableOpacity style={styles.clearBtn} onPress={handleClearRegions}>
              <Text style={styles.clearBtnText}>🗑 Clear All</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.estimatorBtn}
              onPress={() => router.push('/ar/estimator')}
            >
              <Text style={styles.estimatorText}>📐 Estimator</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Color picker panel */}
        {showColorPicker && (
          <View style={styles.colorPanel}>
            <Text style={styles.colorPanelTitle}>Select Paint Color</Text>
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
                  <View
                    style={[
                      styles.colorCircle,
                      { backgroundColor: color.hex },
                      selectedColor === color.hex && styles.colorCircleSelected,
                    ]}
                  />
                  <Text style={styles.colorName}>{color.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </CameraView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container:           { flex: 1 },
  camera:              { flex: 1 },
  center:              { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  permText:            { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 20 },
  permBtn:             { backgroundColor: '#b91c1c', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 },
  permBtnText:         { color: '#fff', fontWeight: '600' },
  
  // Wall regions
  wallRegion:          { position: 'absolute', borderWidth: 1, borderColor: 'rgba(0,0,0,0.2)' },
  currentRegion:       { borderColor: '#b91c1c', borderWidth: 2, borderStyle: 'dashed' },

  // Top bar
  topBar:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16 },
  backBtn:             { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  backText:            { color: '#fff', fontWeight: '600' },
  topTitle:            { color: '#fff', fontSize: 18, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  colorDot:            { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: '#fff' },

  // Instructions
  instructionsContainer:    { position: 'absolute', top: 130, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: 10 },
  instructionsText:         { color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: '500' },

  // Opacity
  opacityContainer:    { position: 'absolute', top: 180, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 16, padding: 12 },
  opacityLabel:        { color: '#fff', fontSize: 13, marginBottom: 8, textAlign: 'center' },
  opacityTrack:        { flexDirection: 'row', justifyContent: 'space-between' },
  opacityStep:         { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  opacityStepActive:   { backgroundColor: '#b91c1c' },
  opacityStepText:     { color: '#fff', fontSize: 11, fontWeight: '600' },

  // Bottom bar
  bottomBar:           { position: 'absolute', bottom: 100, left: 20, right: 20, flexDirection: 'row', gap: 12 },
  addRegionBtn:        { flex: 1, backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  addRegionBtnActive:  { backgroundColor: '#ef4444' },
  addRegionBtnText:    { color: '#fff', fontWeight: '600', fontSize: 15 },
  colorPickerBtn:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  colorPickerText:     { color: '#fff', fontWeight: '600', fontSize: 15 },

  // Secondary bar
  secondaryBar:        { position: 'absolute', bottom: 40, left: 20, right: 20, flexDirection: 'row', gap: 12 },
  clearBtn:            { flex: 1, backgroundColor: 'rgba(239,68,68,0.8)', borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  clearBtnText:        { color: '#fff', fontWeight: '600', fontSize: 14 },
  estimatorBtn:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  estimatorText:       { color: '#fff', fontWeight: '600', fontSize: 14 },

  // Color panel
  colorPanel:          { position: 'absolute', bottom: 160, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.85)', padding: 16 },
  colorPanelTitle:     { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 12 },
  colorItem:           { alignItems: 'center', marginRight: 16 },
  colorCircle:         { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', marginBottom: 6 },
  colorCircleSelected: { borderColor: '#b91c1c', borderWidth: 3 },
  colorName:           { color: '#fff', fontSize: 10, textAlign: 'center', maxWidth: 60 },
});
