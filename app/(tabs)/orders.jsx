import { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';

import { API_URL, STORAGE_URL } from '../../constants/api';
import CancelOrderModal from '../../components/CancelOrderModal';
import {
  statusMeta, canCancel, placedAt, relativeDay, formatTimeOnly, ORDER_POLL_MS,
} from '../../constants/orders';

const THUMB_LIMIT = 3;

export default function Orders() {
  const [orders, setOrders]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { token }                 = useAuthStore();

  // Which order the cancel sheet is aimed at (null = closed)
  const [cancelTarget, setCancelTarget] = useState(null);

  // Guards for the background poll (see useFocusEffect below)
  const inFlight = useRef(false);
  const snapshot = useRef(null);

  const fetchOrders = async ({ silent = false } = {}) => {
    // A slow response must not let polls stack up. Only silent polls skip —
    // bailing out of a pull-to-refresh would leave its spinner stuck on.
    if (silent && inFlight.current) return;
    inFlight.current = true;

    try {
      const res  = await fetch(`${API_URL}/orders`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];

      // Only re-render when something actually moved, so polling does not
      // rebuild the list under the customer's finger every few seconds.
      const digest = JSON.stringify(list);
      if (digest !== snapshot.current) {
        snapshot.current = digest;
        setOrders(list);
      }
    } catch (e) {
      console.log('Orders error:', e.message);
    } finally {
      inFlight.current = false;
      if (!silent) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  // Re-read on focus AND poll while focused. The store can cancel or advance an
  // order from the admin panel at any moment; without this the customer stares
  // at a stale status until they leave the tab and come back. The interval is
  // torn down on blur, so a backgrounded tab costs nothing.
  useFocusEffect(useCallback(() => {
    fetchOrders();
    const timer = setInterval(() => fetchOrders({ silent: true }), ORDER_POLL_MS);
    return () => clearInterval(timer);
  }, [token]));

  const onRefresh = () => {
    setRefreshing(true);
    fetchOrders();
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#b91c1c" /></View>;
  }

  const renderOrder = ({ item }) => {
    const meta        = statusMeta(item.status);
    const isCancelled = item.status === 'cancelled';
    const items       = item.order_items ?? [];
    const itemCount   = items.reduce((n, i) => n + i.quantity, 0);
    const extra       = items.length - THUMB_LIMIT;

    return (
      <TouchableOpacity
        style={[styles.card, isCancelled && styles.cardCancelled]}
        onPress={() => router.push(`/order/${item.id}`)}
        activeOpacity={0.75}
      >
        {/* The order's identity is when it was placed — never its id */}
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.placedDay, isCancelled && styles.mutedText]}>
              {relativeDay(placedAt(item))}
            </Text>
            <Text style={styles.placedTime}>
              {formatTimeOnly(placedAt(item))}
            </Text>
          </View>

          <View style={[styles.badge, { backgroundColor: meta.tint, borderColor: meta.color }]}>
            <Ionicons name={meta.icon} size={12} color={meta.color} />
            <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>

        {/* A glance at what's inside, so the customer recognises the order */}
        <View style={styles.thumbRow}>
          {items.slice(0, THUMB_LIMIT).map((line) => (
            <View
              key={line.id}
              style={[styles.thumb, { backgroundColor: line.product?.hex_code || '#f0f0f0' }]}
            >
              {line.product?.image ? (
                <Image
                  source={{ uri: `${STORAGE_URL}/${line.product.image}` }}
                  style={styles.thumbImg}
                  resizeMode="cover"
                />
              ) : null}
            </View>
          ))}

          {extra > 0 && (
            <View style={[styles.thumb, styles.thumbMore]}>
              <Text style={styles.thumbMoreText}>+{extra}</Text>
            </View>
          )}

          <View style={styles.summaryText}>
            <Text style={styles.itemLine} numberOfLines={1}>
              {items[0]?.product?.description ?? 'Order'}
            </Text>
            <Text style={styles.metaLine} numberOfLines={1}>
              {item.order_type === 'pickup' ? 'Store Pickup' : 'Delivery'}
              {` · ${itemCount} item${itemCount === 1 ? '' : 's'}`}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.cardFooter}>
          <View>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.total}>
              ₱{parseFloat(item.total_amount).toLocaleString()}
            </Text>
          </View>

          <View style={styles.footerActions}>
            {canCancel(item) && (
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setCancelTarget(item.id)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            )}
            <View style={styles.detailsHint}>
              <Text style={styles.detailsHintText}>Details</Text>
              <Ionicons name="chevron-forward" size={15} color="#b91c1c" />
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Orders</Text>
        {orders.length > 0 && (
          <Text style={styles.headerSub}>
            {orders.length} order{orders.length === 1 ? '' : 's'} · tap any order for details
          </Text>
        )}
      </View>

      <FlatList
        data={orders}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={orders.length === 0 ? styles.emptyList : styles.list}
        renderItem={renderOrder}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#b91c1c" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={64} color="#d4d4d4" />
            <Text style={styles.emptyText}>No orders yet</Text>
            <Text style={styles.emptySub}>Your orders will appear here once you check out.</Text>
            <TouchableOpacity style={styles.shopBtn} onPress={() => router.push('/(tabs)')}>
              <Text style={styles.shopBtnText}>Start Shopping</Text>
            </TouchableOpacity>
          </View>
        }
      />

      <CancelOrderModal
        orderId={cancelTarget}
        token={token}
        onClose={() => setCancelTarget(null)}
        onDone={fetchOrders}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#f5f5f5' },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header:      { backgroundColor: '#b91c1c', paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20 },
  title:       { fontSize: 24, fontWeight: '700', color: '#fff' },
  headerSub:   { fontSize: 12.5, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  list:        { padding: 16 },
  emptyList:   { flexGrow: 1 },

  card:        { backgroundColor: '#fff', borderRadius: 16, marginBottom: 14, padding: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 3 },
  cardHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  placedDay:   { fontSize: 15.5, fontWeight: '700', color: '#1a1a1a' },
  placedTime:  { fontSize: 12.5, color: '#999', marginTop: 1 },
  mutedText:   { color: '#9ca3af' },

  badge:       { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText:   { fontSize: 11, fontWeight: '700' },

  thumbRow:    { flexDirection: 'row', alignItems: 'center' },
  thumb:       { width: 38, height: 38, borderRadius: 9, marginRight: 6, overflow: 'hidden', borderWidth: 1, borderColor: '#eee' },
  thumbImg:    { width: '100%', height: '100%' },
  thumbMore:   { backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  thumbMoreText: { fontSize: 12, fontWeight: '700', color: '#6b7280' },
  summaryText: { flex: 1, marginLeft: 6 },
  itemLine:    { fontSize: 13.5, fontWeight: '600', color: '#1a1a1a' },
  metaLine:    { fontSize: 12, color: '#999', marginTop: 2 },

  divider:     { height: 1, backgroundColor: '#f0f0f0', marginVertical: 12 },
  cardFooter:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  totalLabel:  { fontSize: 10.5, color: '#999', fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  total:       { fontSize: 19, fontWeight: '700', color: '#1a1a1a' },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cancelBtn:   { backgroundColor: '#fee2e2', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  cancelText:  { color: '#ef4444', fontWeight: '600', fontSize: 13 },
  detailsHint: { flexDirection: 'row', alignItems: 'center' },
  detailsHintText: { color: '#b91c1c', fontWeight: '600', fontSize: 13 },

  // Cancelled orders read as history, not live orders
  cardCancelled: { borderLeftWidth: 4, borderLeftColor: '#ef4444', backgroundColor: '#fffafa' },

  empty:       { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyText:   { fontSize: 18, color: '#666', fontWeight: '600', marginTop: 16 },
  emptySub:    { fontSize: 13.5, color: '#999', textAlign: 'center', marginTop: 6, lineHeight: 20 },
  shopBtn:     { backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, marginTop: 22 },
  shopBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
