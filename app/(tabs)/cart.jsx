import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, Image, Alert
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';

const API_URL = 'http://192.168.1.69:8000/api';

export default function Cart() {
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const { token }             = useAuthStore();

  const fetchCart = async () => {
    try {
      const res  = await fetch(`${API_URL}/cart`, {
        headers: {
          'Accept':        'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.log('Cart error:', e.message);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => {
    fetchCart();
  }, []));

  // Cart lines are keyed by cart_item_id — the same paint can be in the
  // cart in several sizes, each as its own line
  const updateQty = async (cartItemId, quantity, maxStock) => {
    if (quantity < 1) {
      removeItem(cartItemId);
      return;
    }
    if (maxStock !== undefined && quantity > maxStock) return;
    await fetch(`${API_URL}/cart/${cartItemId}`, {
      method:  'PUT',
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ quantity }),
    });
    fetchCart();
  };

  const removeItem = async (cartItemId) => {
    Alert.alert('Remove Item', 'Remove this item from cart?', [
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await fetch(`${API_URL}/cart/${cartItemId}`, {
            method:  'DELETE',
            headers: {
              'Accept':        'application/json',
              'Authorization': `Bearer ${token}`,
            },
          });
          fetchCart();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#b91c1c" /></View>;
  }

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>🛒</Text>
        <Text style={styles.emptyTitle}>Your cart is empty</Text>
        <Text style={styles.emptySubtitle}>Add some paints to get started!</Text>
        <TouchableOpacity style={styles.shopBtn} onPress={() => router.push('/(tabs)')}>
          <Text style={styles.shopBtnText}>Browse Products</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Cart</Text>
        <Text style={styles.count}>{items.length} item(s)</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.cart_item_id.toString()}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={[styles.thumb, { backgroundColor: item.hex_code || '#f0f0f0' }]}>
              {item.image ? (
                <Image
                  source={{ uri: `${API_URL.replace('/api', '')}/storage/${item.image}` }}
                  style={styles.thumb}
                  resizeMode="cover"
                />
              ) : null}
            </View>

            <View style={styles.info}>
              <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
              <View style={styles.metaRow}>
                {item.size_volume ? (
                  <View style={styles.sizeBadge}>
                    <Text style={styles.sizeBadgeText}>{item.size_volume}</Text>
                  </View>
                ) : null}
                <Text style={styles.price}>₱{parseFloat(item.price).toLocaleString()}</Text>
              </View>

              <View style={styles.qtyRow}>
                <TouchableOpacity
                  style={styles.qtyBtn}
                  onPress={() => updateQty(item.cart_item_id, item.quantity - 1)}
                >
                  <Text style={styles.qtyBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.qty}>{item.quantity}</Text>
                <TouchableOpacity
                  style={styles.qtyBtn}
                  onPress={() => updateQty(item.cart_item_id, item.quantity + 1, item.available_stock)}
                >
                  <Text style={styles.qtyBtnText}>+</Text>
                </TouchableOpacity>
                <Text style={styles.subtotal}>
                  = ₱{parseFloat(item.subtotal).toLocaleString()}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => removeItem(item.cart_item_id)}
            >
              <Text style={styles.removeText}>🗑</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total ({items.length} items)</Text>
          <Text style={styles.totalAmount}>₱{parseFloat(total).toLocaleString()}</Text>
        </View>
        <TouchableOpacity
          style={styles.checkoutBtn}
          onPress={() => router.push('/checkout')}
        >
          <Text style={styles.checkoutBtnText}>Proceed to Checkout →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#f5f5f5' },
  center:         { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:          { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyIcon:      { fontSize: 72, marginBottom: 16 },
  emptyTitle:     { fontSize: 22, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  emptySubtitle:  { fontSize: 15, color: '#999', marginBottom: 24, textAlign: 'center' },
  shopBtn:        { backgroundColor: '#b91c1c', borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14 },
  shopBtnText:    { color: '#fff', fontWeight: '700', fontSize: 15 },
  header:         { backgroundColor: '#b91c1c', paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  title:          { fontSize: 24, fontWeight: '700', color: '#fff' },
  count:          { fontSize: 14, color: 'rgba(255,255,255,0.85)' },
  list:           { padding: 16, paddingBottom: 200 },
  card:           { backgroundColor: '#fff', borderRadius: 16, marginBottom: 12, flexDirection: 'row', padding: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 3 },
  thumb:          { width: 80, height: 80, borderRadius: 10, overflow: 'hidden' },
  info:           { flex: 1, marginLeft: 12 },
  name:           { fontSize: 13, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  metaRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sizeBadge:      { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#b91c1c', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  sizeBadgeText:  { fontSize: 11, fontWeight: '700', color: '#b91c1c' },
  price:          { fontSize: 15, fontWeight: '700', color: '#b91c1c' },
  qtyRow:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn:         { width: 28, height: 28, borderRadius: 14, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' },
  qtyBtnText:     { fontSize: 16, color: '#1a1a1a', fontWeight: '700' },
  qty:            { fontSize: 15, fontWeight: '600', minWidth: 20, textAlign: 'center' },
  subtotal:       { fontSize: 12, color: '#666', marginLeft: 4 },
  removeBtn:      { padding: 8, justifyContent: 'flex-start' },
  removeText:     { fontSize: 18 },
  footer:         { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: '#e0e0e0', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 8 },
  totalRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  totalLabel:     { fontSize: 15, color: '#666' },
  totalAmount:    { fontSize: 24, fontWeight: '700', color: '#1a1a1a' },
  checkoutBtn:    { backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  checkoutBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});