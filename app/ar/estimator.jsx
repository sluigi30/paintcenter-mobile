import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, KeyboardAvoidingView, Platform
} from 'react-native';
import { router } from 'expo-router';

export default function WallEstimator() {
  const [width, setWidth]   = useState('');
  const [height, setHeight] = useState('');
  const [doors, setDoors]   = useState('0');
  const [windows, setWindows] = useState('0');
  const [coats, setCoats]   = useState('2');
  const [result, setResult] = useState(null);

  const calculate = () => {
    const w = parseFloat(width);
    const h = parseFloat(height);
    const d = parseInt(doors) || 0;
    const win = parseInt(windows) || 0;
    const c = parseInt(coats) || 2;

    if (!w || !h) return;

    const wallArea    = w * h;
    const doorArea    = d * 2.1;      // standard door 0.9m x 2.1m
    const windowArea  = win * 1.2;    // standard window 1.0m x 1.2m
    const paintArea   = (wallArea - doorArea - windowArea) * c;
    const litersNeeded = paintArea / 10; // 1L covers ~10m²
    const cansNeeded1L  = Math.ceil(litersNeeded);
    const cansNeeded4L  = Math.ceil(litersNeeded / 4);

    setResult({
      wallArea:    wallArea.toFixed(2),
      paintArea:   paintArea.toFixed(2),
      liters:      litersNeeded.toFixed(2),
      cans1L:      cansNeeded1L,
      cans4L:      cansNeeded4L,
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Wall Paint Estimator</Text>
        <Text style={styles.subtitle}>Calculate how much paint you need</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Wall Dimensions</Text>

          <Text style={styles.label}>Wall Width (meters)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 5.5"
            keyboardType="decimal-pad"
            value={width}
            onChangeText={setWidth}
          />

          <Text style={styles.label}>Wall Height (meters)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 3.0"
            keyboardType="decimal-pad"
            value={height}
            onChangeText={setHeight}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Deductions</Text>

          <Text style={styles.label}>Number of Doors</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            keyboardType="number-pad"
            value={doors}
            onChangeText={setDoors}
          />

          <Text style={styles.label}>Number of Windows</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            keyboardType="number-pad"
            value={windows}
            onChangeText={setWindows}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Coats</Text>
          <View style={styles.coatsRow}>
            {['1', '2', '3'].map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.coatBtn, coats === c && styles.coatBtnActive]}
                onPress={() => setCoats(c)}
              >
                <Text style={[styles.coatText, coats === c && styles.coatTextActive]}>
                  {c} Coat{c !== '1' ? 's' : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.calcBtn} onPress={calculate}>
          <Text style={styles.calcBtnText}>📐 Calculate</Text>
        </TouchableOpacity>

        {result && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Results</Text>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Wall Area</Text>
              <Text style={styles.resultValue}>{result.wallArea} m²</Text>
            </View>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Paintable Area</Text>
              <Text style={styles.resultValue}>{result.paintArea} m²</Text>
            </View>

            <View style={styles.divider} />

            <Text style={styles.resultHighlight}>You need approximately:</Text>
            <Text style={styles.liters}>{result.liters} liters</Text>

            <View style={styles.cansRow}>
              <View style={styles.canCard}>
                <Text style={styles.canCount}>{result.cans1L}</Text>
                <Text style={styles.canLabel}>1L cans</Text>
              </View>
              <Text style={styles.orText}>or</Text>
              <View style={styles.canCard}>
                <Text style={styles.canCount}>{result.cans4L}</Text>
                <Text style={styles.canLabel}>4L cans</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.shopBtn}
              onPress={() => router.push('/(tabs)')}
            >
              <Text style={styles.shopBtnText}>🛒 Shop Paint Now</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: '#f5f5f5' },
  header:            { backgroundColor: '#b91c1c', paddingTop: 60, paddingBottom: 24, paddingHorizontal: 20 },
  backBtn:           { marginBottom: 12 },
  backText:          { color: 'rgba(255,255,255,0.85)', fontSize: 15 },
  title:             { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle:          { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  content:           { padding: 16, paddingBottom: 40 },
  card:              { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  sectionTitle:      { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 14 },
  label:             { fontSize: 13, color: '#666', marginBottom: 6 },
  input:             { backgroundColor: '#f5f5f5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 14, color: '#1a1a1a' },
  coatsRow:          { flexDirection: 'row', gap: 10 },
  coatBtn:           { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: '#f5f5f5' },
  coatBtnActive:     { backgroundColor: '#b91c1c' },
  coatText:          { fontWeight: '600', color: '#666' },
  coatTextActive:    { color: '#fff' },
  calcBtn:           { backgroundColor: '#1a1a1a', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 16 },
  calcBtnText:       { color: '#fff', fontSize: 16, fontWeight: '700' },
  resultCard:        { backgroundColor: '#fff', borderRadius: 16, padding: 20, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 3 },
  resultTitle:       { fontSize: 18, fontWeight: '700', color: '#1a1a1a', marginBottom: 16 },
  resultRow:         { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  resultLabel:       { fontSize: 14, color: '#666' },
  resultValue:       { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  divider:           { height: 1, backgroundColor: '#f0f0f0', marginVertical: 14 },
  resultHighlight:   { fontSize: 14, color: '#666', marginBottom: 6 },
  liters:            { fontSize: 36, fontWeight: '700', color: '#b91c1c', marginBottom: 16 },
  cansRow:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 20 },
  canCard:           { backgroundColor: '#fef2f2', borderRadius: 12, padding: 16, alignItems: 'center', flex: 1 },
  canCount:          { fontSize: 32, fontWeight: '700', color: '#b91c1c' },
  canLabel:          { fontSize: 13, color: '#666', marginTop: 4 },
  orText:            { fontSize: 16, color: '#999', fontWeight: '500' },
  shopBtn:           { backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  shopBtnText:       { color: '#fff', fontSize: 16, fontWeight: '700' },
});