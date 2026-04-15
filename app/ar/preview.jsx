import { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, Dimensions
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, router } from 'expo-router';

const { width, height } = Dimensions.get('window');

const SAMPLE_COLORS = [
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
  const [opacity, setOpacity]           = useState(0.5);
  const [showColors, setShowColors]     = useState(false);

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, []);

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

  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} facing="back">
        {/* Color overlay on wall */}
        <View
          style={[
            styles.overlay,
            {
              backgroundColor: selectedColor,
              opacity: opacity,
            }
          ]}
        />

        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.topTitle}>Paint Preview</Text>
          <View style={[styles.colorDot, { backgroundColor: selectedColor }]} />
        </View>

        {/* Opacity slider area */}
        <View style={styles.opacityContainer}>
          <Text style={styles.opacityLabel}>Opacity: {Math.round(opacity * 100)}%</Text>
          <View style={styles.opacityTrack}>
            {[0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((val) => (
              <TouchableOpacity
                key={val}
                style={[
                  styles.opacityStep,
                  opacity === val && styles.opacityStepActive
                ]}
                onPress={() => setOpacity(val)}
              >
                <Text style={styles.opacityStepText}>{Math.round(val * 100)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Bottom controls */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.colorPickerBtn}
            onPress={() => setShowColors(!showColors)}
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

        {/* Color picker panel */}
        {showColors && (
          <View style={styles.colorPanel}>
            <Text style={styles.colorPanelTitle}>Select Paint Color</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {SAMPLE_COLORS.map((color) => (
                <TouchableOpacity
                  key={color.hex}
                  style={styles.colorItem}
                  onPress={() => {
                    setSelectedColor(color.hex);
                    setShowColors(false);
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
    </View>
  );
}

const styles = StyleSheet.create({
  container:           { flex: 1 },
  camera:              { flex: 1 },
  center:              { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  permText:            { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 20 },
  permBtn:             { backgroundColor: '#f97316', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 },
  permBtnText:         { color: '#fff', fontWeight: '600' },
  overlay:             { ...StyleSheet.absoluteFillObject },
  topBar:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16 },
  backBtn:             { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  backText:            { color: '#fff', fontWeight: '600' },
  topTitle:            { color: '#fff', fontSize: 18, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  colorDot:            { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: '#fff' },
  opacityContainer:    { position: 'absolute', top: 130, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 16, padding: 12 },
  opacityLabel:        { color: '#fff', fontSize: 13, marginBottom: 8, textAlign: 'center' },
  opacityTrack:        { flexDirection: 'row', justifyContent: 'space-between' },
  opacityStep:         { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  opacityStepActive:   { backgroundColor: '#f97316' },
  opacityStepText:     { color: '#fff', fontSize: 11, fontWeight: '600' },
  bottomBar:           { position: 'absolute', bottom: 40, left: 20, right: 20, flexDirection: 'row', gap: 12 },
  colorPickerBtn:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  colorPickerText:     { color: '#fff', fontWeight: '600', fontSize: 15 },
  estimatorBtn:        { flex: 1, backgroundColor: '#f97316', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  estimatorText:       { color: '#fff', fontWeight: '600', fontSize: 15 },
  colorPanel:          { position: 'absolute', bottom: 110, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.85)', padding: 16 },
  colorPanelTitle:     { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 12 },
  colorItem:           { alignItems: 'center', marginRight: 16 },
  colorCircle:         { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', marginBottom: 6 },
  colorCircleSelected: { borderColor: '#f97316', borderWidth: 3 },
  colorName:           { color: '#fff', fontSize: 10, textAlign: 'center', maxWidth: 60 },
});