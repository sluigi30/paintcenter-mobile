import { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert
} from 'react-native';
import { useAuthStore } from '../../stores/authStore';

const API_URL = 'http://192.168.1.69:8000/api';

const STATUS_COLORS = {
  pending:          '#b91c1c',
  processing:       '#3b82f6',
  shipped:          '#8b5cf6',
  ready_for_pickup: '#8b5cf6',
  completed:        '#22c55e',
  cancelled:        '#ef4444',
};

export default function Orders() {
  const [orders, setOrders]   = useState([]);
  const [loading, setLoading] = useState(true);
  const { token }             = useAuthStore();

  const fetchOrders = async () => {
    try {
      const res  = await fetch(`${API_URL}/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setOrders(data);
    } catch (e) {
      console.log('Orders error:', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrders(); }, []);

  const cancelOrder = async (orderId) => {
    Alert.alert('Cancel Order', 'Are you sure?', [
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          const res = await fetch(`${API_URL}/orders/${orderId}/cancel`, {
            method:  'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            Alert.alert('Cancelled', 'Your order has been cancelled.');
            fetchOrders();
          }
        },
      },
      { text: 'No', style: 'cancel' },
    ]);
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#b91c1c" /></View>;
  }

  if (orders.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>📦</Text>
        <Text style={styles.emptyText}>No orders yet</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Orders</Text>
      </View>

      <FlatList
        data={orders}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.orderId}>Order #{item.id}</Text>
              <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] || '#999' }]}>
                <Text style={styles.badgeText}>{item.status.replace('_', ' ')}</Text>
              </View>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Type:</Text>
              <Text style={styles.value}>{item.order_type}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Payment:</Text>
              <Text style={styles.value}>{item.payment?.payment_method} — {item.payment?.payment_status}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Items:</Text>
              <Text style={styles.value}>{item.order_items?.length} item(s)</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.cardFooter}>
              <Text style={styles.total}>₱{parseFloat(item.total_amount).toLocaleString()}</Text>
              {['pending', 'processing'].includes(item.status) && (
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => cancelOrder(item.id)}
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#f5f5f5' },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header:      { backgroundColor: '#b91c1c', paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20 },
  title:       { fontSize: 24, fontWeight: '700', color: '#fff' },
  list:        { padding: 16 },
  card:        { backgroundColor: '#fff', borderRadius: 16, marginBottom: 14, padding: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 3 },
  cardHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  orderId:     { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  badge:       { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText:   { color: '#fff', fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  row:         { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  label:       { fontSize: 13, color: '#999' },
  value:       { fontSize: 13, color: '#1a1a1a', fontWeight: '500', textTransform: 'capitalize' },
  divider:     { height: 1, backgroundColor: '#f0f0f0', marginVertical: 12 },
  cardFooter:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  total:       { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  cancelBtn:   { backgroundColor: '#fee2e2', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  cancelText:  { color: '#ef4444', fontWeight: '600', fontSize: 13 },
  emptyIcon:   { fontSize: 64, marginBottom: 16 },
  emptyText:   { fontSize: 18, color: '#666' },
});