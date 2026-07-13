import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, TextInput, ActivityIndicator, Alert
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../stores/authStore';

const API_URL = 'http://192.168.1.69:8000/api';

const PAYMENT_METHODS = [
  { id: 'cod',   label: 'Cash on Delivery', icon: '💵' },
  { id: 'gcash', label: 'GCash',            icon: '📱' },
  { id: 'card',  label: 'Credit/Debit Card', icon: '💳' },
  { id: 'cash',  label: 'Cash (Pickup)',     icon: '🏪' },
];

export default function Checkout() {
  const { token, user }             = useAuthStore();
  const [orderType, setOrderType]   = useState('delivery');
  const [payment, setPayment]       = useState('cod');
  const [address, setAddress]       = useState(user?.address || '');
  const [placing, setPlacing]       = useState(false);

  const placeOrder = async () => {
    if (orderType === 'delivery' && !address.trim()) {
      Alert.alert('Address Required', 'Please enter your delivery address.');
      return;
    }

    setPlacing(true);
    try {
      const res = await fetch(`${API_URL}/orders`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Accept':        'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          order_type:       orderType,
          payment_method:   payment,
          shipping_address: orderType === 'delivery' ? address : null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        router.replace({
          pathname: '/order-success',
          params: { orderId: data.order.id, total: data.order.total_amount },
        });
      } else {
        Alert.alert('Error', data.message || 'Failed to place order.');
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setPlacing(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Checkout</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* Order Type */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Order Type</Text>
          <View style={styles.optionRow}>
            <TouchableOpacity
              style={[styles.optionBtn, orderType === 'delivery' && styles.optionBtnActive]}
              onPress={() => setOrderType('delivery')}
            >
              <Text style={styles.optionIcon}>🚚</Text>
              <Text style={[styles.optionLabel, orderType === 'delivery' && styles.optionLabelActive]}>
                Delivery
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.optionBtn, orderType === 'pickup' && styles.optionBtnActive]}
              onPress={() => setOrderType('pickup')}
            >
              <Text style={styles.optionIcon}>🏪</Text>
              <Text style={[styles.optionLabel, orderType === 'pickup' && styles.optionLabelActive]}>
                Pick Up
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Delivery Address */}
        {orderType === 'delivery' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Delivery Address</Text>
            <TextInput
              style={styles.addressInput}
              placeholder="Enter your full address..."
              placeholderTextColor="#999"
              value={address}
              onChangeText={setAddress}
              multiline
              numberOfLines={3}
            />
          </View>
        )}

        {orderType === 'pickup' && (
          <View style={styles.section}>
            <View style={styles.pickupInfo}>
              <Text style={styles.pickupIcon}>📍</Text>
              <View>
                <Text style={styles.pickupTitle}>NCM Paint Center</Text>
                <Text style={styles.pickupAddr}>Balanga, Bataan</Text>
                <Text style={styles.pickupHours}>Mon–Sat: 8AM – 6PM</Text>
              </View>
            </View>
          </View>
        )}

        {/* Payment Method */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Method</Text>
          {PAYMENT_METHODS.map((method) => (
            <TouchableOpacity
              key={method.id}
              style={[styles.paymentRow, payment === method.id && styles.paymentRowActive]}
              onPress={() => setPayment(method.id)}
            >
              <Text style={styles.paymentIcon}>{method.icon}</Text>
              <Text style={[styles.paymentLabel, payment === method.id && styles.paymentLabelActive]}>
                {method.label}
              </Text>
              <View style={[styles.radio, payment === method.id && styles.radioActive]}>
                {payment === method.id && <View style={styles.radioDot} />}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.placeBtn}
          onPress={placeOrder}
          disabled={placing}
        >
          {placing
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.placeBtnText}>Place Order</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#f5f5f5' },
  header:             { backgroundColor: '#b91c1c', paddingTop: 60, paddingBottom: 16, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back:               { color: '#fff', fontSize: 15 },
  title:              { fontSize: 18, fontWeight: '700', color: '#fff' },
  content:            { padding: 16 },
  section:            { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  sectionTitle:       { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 14 },
  optionRow:          { flexDirection: 'row', gap: 12 },
  optionBtn:          { flex: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center', backgroundColor: '#f5f5f5', borderWidth: 2, borderColor: '#f5f5f5' },
  optionBtnActive:    { backgroundColor: '#fef2f2', borderColor: '#b91c1c' },
  optionIcon:         { fontSize: 28, marginBottom: 6 },
  optionLabel:        { fontSize: 14, fontWeight: '600', color: '#666' },
  optionLabelActive:  { color: '#b91c1c' },
  addressInput:       { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 14, fontSize: 15, color: '#1a1a1a', minHeight: 80, textAlignVertical: 'top' },
  pickupInfo:         { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pickupIcon:         { fontSize: 36 },
  pickupTitle:        { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  pickupAddr:         { fontSize: 13, color: '#666', marginTop: 2 },
  pickupHours:        { fontSize: 12, color: '#b91c1c', marginTop: 2 },
  paymentRow:         { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, marginBottom: 8, backgroundColor: '#f5f5f5', borderWidth: 2, borderColor: '#f5f5f5' },
  paymentRowActive:   { backgroundColor: '#fef2f2', borderColor: '#b91c1c' },
  paymentIcon:        { fontSize: 24, marginRight: 12 },
  paymentLabel:       { flex: 1, fontSize: 15, color: '#666', fontWeight: '500' },
  paymentLabelActive: { color: '#b91c1c', fontWeight: '700' },
  radio:              { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ccc', justifyContent: 'center', alignItems: 'center' },
  radioActive:        { borderColor: '#b91c1c' },
  radioDot:           { width: 10, height: 10, borderRadius: 5, backgroundColor: '#b91c1c' },
  footer:             { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: '#e0e0e0' },
  placeBtn:           { backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  placeBtnText:       { color: '#fff', fontSize: 16, fontWeight: '700' },
});