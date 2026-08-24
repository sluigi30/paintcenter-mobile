import { useState, useCallback, useRef } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';

import { API_URL, STORAGE_URL } from '../../constants/api';
import CancelOrderModal from '../../components/CancelOrderModal';
import {
  statusMeta, canCancel, orderTimeline, placedAt, ORDER_POLL_MS,
  formatOrderDate, formatDateOnly, PAYMENT_LABELS, PAYMENT_STATUS_COLORS,
} from '../../constants/orders';

const peso = (value) => `₱${parseFloat(value ?? 0).toLocaleString()}`;

export default function OrderDetail() {
  const { id }  = useLocalSearchParams();
  const { token } = useAuthStore();

  const [order, setOrder]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed]   = useState(false);
  const [reordering, setReordering] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  // Guards for the background poll (see useFocusEffect below)
  const inFlight = useRef(false);
  const snapshot = useRef(null);

  const fetchOrder = async ({ silent = false } = {}) => {
    if (silent && inFlight.current) return;
    inFlight.current = true;

    try {
      const res  = await fetch(`${API_URL}/orders/${id}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (res.ok) {
        // Re-render only on a real change, so the screen does not flicker or
        // fight the customer's scrolling every poll.
        const digest = JSON.stringify(data);
        if (digest !== snapshot.current) {
          snapshot.current = digest;
          setOrder(data);
        }
        setFailed(false);
      } else if (!silent) {
        setFailed(true);
      }
      // A failed silent poll is swallowed on purpose: one bad response must not
      // replace a perfectly good screen with an error state.
    } catch (e) {
      console.log('Order detail error:', e.message);
      if (!silent) setFailed(true);
    } finally {
      inFlight.current = false;
      if (!silent) setLoading(false);
    }
  };

  // Poll while focused so a cancellation or status change made in the admin
  // panel lands here on its own, rather than waiting for the customer to back
  // out and re-open the order.
  useFocusEffect(useCallback(() => {
    fetchOrder();
    const timer = setInterval(() => fetchOrder({ silent: true }), ORDER_POLL_MS);
    return () => clearInterval(timer);
  }, [id, token]));

  /**
   * Buy Again — puts every line of this order back in the cart. Sizes may have
   * been archived or sold out since, so each line is reported on individually
   * rather than failing the whole action.
   */
  const buyAgain = async () => {
    setReordering(true);

    const lines  = order.order_items ?? [];
    const failures = [];
    let added = 0;

    for (const line of lines) {
      try {
        const res = await fetch(`${API_URL}/cart/add`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Accept':        'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            product_variant_id: line.product_variant_id,
            quantity:           line.quantity,
          }),
        });
        const data = await res.json();

        if (res.ok) {
          added += 1;
        } else {
          failures.push(`${line.product?.description ?? 'Item'}: ${data.message ?? 'unavailable'}`);
        }
      } catch (e) {
        failures.push(`${line.product?.description ?? 'Item'}: ${e.message}`);
      }
    }

    setReordering(false);

    if (added === 0) {
      Alert.alert('Nothing Added', failures.join('\n\n') || 'These items are no longer available.');
      return;
    }

    Alert.alert(
      failures.length ? 'Partly Added to Cart' : 'Added to Cart',
      [
        `${added} of ${lines.length} item${lines.length === 1 ? '' : 's'} added.`,
        ...(failures.length ? ['', 'Could not add:', ...failures] : []),
      ].join('\n'),
      [
        { text: 'Keep Browsing', style: 'cancel' },
        { text: 'View Cart', onPress: () => router.push('/(tabs)/cart') },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#b91c1c" />
      </View>
    );
  }

  if (failed || !order) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={56} color="#d4d4d4" />
        <Text style={styles.errorText}>We couldn't load this order.</Text>
        <TouchableOpacity style={styles.errorBtn} onPress={() => router.back()}>
          <Text style={styles.errorBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const meta        = statusMeta(order.status);
  const isCancelled = order.status === 'cancelled';
  const isPickup    = order.order_type === 'pickup';
  const lines       = order.order_items ?? [];
  const timeline    = orderTimeline(order);

  const itemsTotal = lines.reduce((sum, l) => sum + parseFloat(l.subtotal ?? 0), 0);
  const total      = parseFloat(order.total_amount ?? 0);
  // Derived rather than assumed: today the order total is exactly the sum of
  // its lines, so anything left over is a fee and is shown as one.
  const extraFees  = Math.max(0, total - itemsTotal);
  const itemCount  = lines.reduce((n, l) => n + l.quantity, 0);

  // The customer's own cancellation is confirmed back to them; a store-side one
  // is apologised for. Matches Order::cancelledByCustomer() on the API.
  const cancelledByStore = isCancelled && order.cancelled_by !== order.user_id;

  // Buy Again only once an order is finished. Offering it on an in-flight order
  // invites an accidental duplicate of something already on its way.
  const canBuyAgain = ['completed', 'cancelled'].includes(order.status) && lines.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Order Details</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Status hero — the order is named by when it was placed, not by id */}
        <View style={[styles.hero, { backgroundColor: meta.tint, borderColor: meta.color }]}>
          <View style={[styles.heroIcon, { backgroundColor: meta.color }]}>
            <Ionicons name={meta.icon} size={22} color="#fff" />
          </View>
          <Text style={[styles.heroHeadline, { color: meta.color }]}>{meta.headline}</Text>
          <Text style={styles.heroBlurb}>{meta.blurb}</Text>
          <View style={styles.heroMetaRow}>
            <Ionicons name="calendar-outline" size={13} color="#6b7280" />
            <Text style={styles.heroMeta}>Placed {formatOrderDate(placedAt(order))}</Text>
          </View>
        </View>

        {/* Cancellation notice */}
        {isCancelled && (
          <View style={styles.cancelNotice}>
            <Text style={styles.cancelNoticeTitle}>
              {cancelledByStore ? 'Cancelled by the store' : 'You cancelled this order'}
            </Text>
            {order.cancellation_reason ? (
              <>
                <Text style={styles.cancelNoticeLabel}>Reason</Text>
                <Text style={styles.cancelNoticeText}>{order.cancellation_reason}</Text>
              </>
            ) : null}
            {order.cancelled_at ? (
              <Text style={styles.cancelNoticeDate}>
                {formatOrderDate(order.cancelled_at)}
              </Text>
            ) : null}
            <Text style={styles.cancelNoticeFoot}>
              {cancelledByStore
                ? 'Sorry for the inconvenience. Message us and we can help you reorder.'
                : 'The items have been returned to stock.'}
            </Text>
          </View>
        )}

        {/* Progress tracker */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Progress</Text>
          {timeline.map((step, i) => {
            const isLast = i === timeline.length - 1;
            const done   = step.state === 'done';
            const live   = step.state === 'current';
            const killed = step.state === 'cancelled';

            const dotColor = killed ? '#dc2626'
              : done ? '#15803d'
              : live ? meta.color
              : '#d4d4d8';

            return (
              <View key={step.key} style={styles.stepRow}>
                <View style={styles.stepRail}>
                  <View style={[styles.stepDot, { borderColor: dotColor, backgroundColor: (done || live || killed) ? dotColor : '#fff' }]}>
                    {done && <Ionicons name="checkmark" size={11} color="#fff" />}
                    {killed && <Ionicons name="close" size={11} color="#fff" />}
                  </View>
                  {!isLast && (
                    <View style={[styles.stepLine, { backgroundColor: done ? '#15803d' : '#e5e7eb' }]} />
                  )}
                </View>

                <View style={[styles.stepBody, isLast && { paddingBottom: 0 }]}>
                  <Text style={[
                    styles.stepTitle,
                    (done || live || killed) ? { color: '#1a1a1a' } : { color: '#9ca3af' },
                    live && { fontWeight: '700' },
                  ]}>
                    {step.title}
                  </Text>
                  <Text style={styles.stepNote}>{step.note}</Text>
                  {step.at ? (
                    <Text style={styles.stepDate}>{formatOrderDate(step.at)}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>

        {/* Items */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Items ({itemCount} item{itemCount === 1 ? '' : 's'})
          </Text>

          {lines.map((line) => {
            const product = line.product ?? {};
            const hasColor = product.color_code || product.color_name;

            return (
              <TouchableOpacity
                key={line.id}
                style={styles.itemRow}
                activeOpacity={product.id ? 0.7 : 1}
                onPress={() => product.id && router.push(`/product/${product.id}`)}
              >
                <View style={[styles.itemThumb, { backgroundColor: product.hex_code || '#f0f0f0' }]}>
                  {product.image ? (
                    <Image
                      source={{ uri: `${STORAGE_URL}/${product.image}` }}
                      style={styles.itemThumbImg}
                      resizeMode="cover"
                    />
                  ) : null}
                </View>

                <View style={styles.itemInfo}>
                  {product.brand?.brand_name ? (
                    <Text style={styles.itemBrand}>{product.brand.brand_name}</Text>
                  ) : null}
                  <Text style={styles.itemName} numberOfLines={2}>
                    {product.description ?? 'Item'}
                  </Text>
                  {hasColor ? (
                    <Text style={styles.itemColor}>
                      Color: {[product.color_code, product.color_name].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  <Text style={styles.itemMeta}>
                    {/* size_volume is snapshotted on the line, so it still reads
                        correctly even if the variant was later renamed */}
                    {line.size_volume ? `${line.size_volume}  ·  ` : ''}
                    {line.quantity} × {peso(line.unit_price)}
                  </Text>
                </View>

                <Text style={styles.itemSubtotal}>{peso(line.subtotal)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Billing */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Payment Summary</Text>

          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>
              Subtotal ({itemCount} item{itemCount === 1 ? '' : 's'})
            </Text>
            <Text style={styles.sumValue}>{peso(itemsTotal)}</Text>
          </View>

          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>{isPickup ? 'Store Pickup' : 'Delivery'}</Text>
            <Text style={[styles.sumValue, extraFees === 0 && styles.freeValue]}>
              {extraFees > 0 ? peso(extraFees) : 'Free'}
            </Text>
          </View>

          <View style={styles.sumDivider} />

          <View style={styles.sumRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{peso(total)}</Text>
          </View>

          <View style={styles.payBox}>
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>Method</Text>
              <Text style={styles.payValue}>
                {PAYMENT_LABELS[order.payment?.payment_method] ?? order.payment?.payment_method ?? '—'}
              </Text>
            </View>
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>Status</Text>
              <Text style={[
                styles.payValue,
                { color: PAYMENT_STATUS_COLORS[order.payment?.payment_status] ?? '#1a1a1a' },
              ]}>
                {(order.payment?.payment_status ?? '—').replace(/_/g, ' ')}
              </Text>
            </View>
            {order.payment?.payment_date ? (
              <View style={styles.payRow}>
                <Text style={styles.payLabel}>Paid on</Text>
                <Text style={styles.payValue}>{formatDateOnly(order.payment.payment_date)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Fulfilment */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{isPickup ? 'Pickup Details' : 'Delivery Details'}</Text>

          <View style={styles.fulfilRow}>
            <Ionicons
              name={isPickup ? 'storefront-outline' : 'location-outline'}
              size={18}
              color="#b91c1c"
            />
            <View style={styles.fulfilBody}>
              <Text style={styles.fulfilTitle}>
                {isPickup ? 'Collect at NCM Paint Center' : 'Deliver to'}
              </Text>
              <Text style={styles.fulfilText}>
                {isPickup
                  ? 'Bring a valid ID. We hold your order until you collect it.'
                  : (order.shipping_address || 'No address on this order.')}
              </Text>
            </View>
          </View>
        </View>

        {/* Actions */}
        {canCancel(order) && (
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setCancelOpen(true)}>
            <Ionicons name="close-circle-outline" size={17} color="#ef4444" />
            <Text style={styles.cancelBtnText}>Cancel This Order</Text>
          </TouchableOpacity>
        )}

        {canBuyAgain && (
          <TouchableOpacity style={styles.primaryBtn} onPress={buyAgain} disabled={reordering}>
            {reordering
              ? <ActivityIndicator color="#fff" />
              : (
                <>
                  <Ionicons name="refresh-outline" size={17} color="#fff" />
                  <Text style={styles.primaryBtnText}>Buy Again</Text>
                </>
              )
            }
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.ghostBtn}
          onPress={() => router.push('/(tabs)/messages')}
        >
          <Ionicons name="chatbubble-outline" size={16} color="#b91c1c" />
          <Text style={styles.ghostBtnText}>Message Us About This Order</Text>
        </TouchableOpacity>

        <Text style={styles.footNote}>
          We post every update to this order in your messages, so you always have
          a written record.
        </Text>
      </ScrollView>

      <CancelOrderModal
        orderId={cancelOpen ? order.id : null}
        token={token}
        onClose={() => setCancelOpen(false)}
        onDone={fetchOrder}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5', padding: 32 },
  errorText: { fontSize: 15, color: '#666', marginTop: 14, textAlign: 'center' },
  errorBtn:  { backgroundColor: '#b91c1c', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28, marginTop: 18 },
  errorBtnText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },

  header: { backgroundColor: '#b91c1c', paddingTop: 60, paddingBottom: 18, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back:   { color: '#fff', fontSize: 15, fontWeight: '600', width: 60 },
  title:  { color: '#fff', fontSize: 18, fontWeight: '700' },

  content: { padding: 16, paddingBottom: 40 },

  hero:        { borderRadius: 16, borderWidth: 1, padding: 18, alignItems: 'center', marginBottom: 14 },
  heroIcon:    { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  heroHeadline: { fontSize: 18, fontWeight: '700' },
  heroBlurb:   { fontSize: 13, color: '#4b5563', textAlign: 'center', marginTop: 5, lineHeight: 19 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12, backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  heroMeta:    { fontSize: 12.5, color: '#374151', fontWeight: '600' },

  cancelNotice:      { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14, borderLeftWidth: 4, borderLeftColor: '#ef4444' },
  cancelNoticeTitle: { fontSize: 14.5, fontWeight: '700', color: '#991b1b' },
  cancelNoticeLabel: { fontSize: 10.5, fontWeight: '700', color: '#ef4444', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 10 },
  cancelNoticeText:  { fontSize: 13.5, color: '#7f1d1d', marginTop: 3, lineHeight: 19 },
  cancelNoticeDate:  { fontSize: 12, color: '#b91c1c', marginTop: 8 },
  cancelNoticeFoot:  { fontSize: 12.5, color: '#6b7280', marginTop: 10, lineHeight: 18 },

  card:      { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 2 },
  cardTitle: { fontSize: 11, fontWeight: '700', color: '#9ca3af', letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 14 },

  stepRow:   { flexDirection: 'row' },
  stepRail:  { width: 28, alignItems: 'center' },
  stepDot:   { width: 19, height: 19, borderRadius: 10, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  stepLine:  { width: 2, flex: 1, marginVertical: 2 },
  stepBody:  { flex: 1, paddingBottom: 18, paddingLeft: 6, marginTop: -2 },
  stepTitle: { fontSize: 14.5, fontWeight: '600' },
  stepNote:  { fontSize: 12.5, color: '#9ca3af', marginTop: 2, lineHeight: 18 },
  stepDate:  { fontSize: 11.5, color: '#6b7280', marginTop: 4, fontWeight: '600' },

  itemRow:       { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  itemThumb:     { width: 54, height: 54, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#eee' },
  itemThumbImg:  { width: '100%', height: '100%' },
  itemInfo:      { flex: 1, marginLeft: 12 },
  itemBrand:     { fontSize: 10.5, fontWeight: '700', color: '#b91c1c', letterSpacing: 0.4, textTransform: 'uppercase' },
  itemName:      { fontSize: 14, fontWeight: '600', color: '#1a1a1a', marginTop: 1 },
  itemColor:     { fontSize: 12, color: '#6b7280', marginTop: 3 },
  itemMeta:      { fontSize: 12.5, color: '#9ca3af', marginTop: 3 },
  itemSubtotal:  { fontSize: 14, fontWeight: '700', color: '#1a1a1a', marginLeft: 8 },

  sumRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  sumLabel:   { fontSize: 13.5, color: '#6b7280' },
  sumValue:   { fontSize: 13.5, color: '#1a1a1a', fontWeight: '600' },
  freeValue:  { color: '#15803d' },
  sumDivider: { height: 1, backgroundColor: '#f0f0f0', marginVertical: 9 },
  totalLabel: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  totalValue: { fontSize: 20, fontWeight: '700', color: '#b91c1c' },

  payBox:   { backgroundColor: '#fafafa', borderRadius: 12, padding: 12, marginTop: 14 },
  payRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  payLabel: { fontSize: 12.5, color: '#9ca3af' },
  payValue: { fontSize: 12.5, color: '#1a1a1a', fontWeight: '600', textTransform: 'capitalize' },

  fulfilRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  fulfilBody:  { flex: 1 },
  fulfilTitle: { fontSize: 13, fontWeight: '700', color: '#1a1a1a' },
  fulfilText:  { fontSize: 13, color: '#6b7280', marginTop: 3, lineHeight: 19 },

  cancelBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#fee2e2', borderRadius: 14, paddingVertical: 14, marginBottom: 10 },
  cancelBtnText: { color: '#ef4444', fontSize: 14.5, fontWeight: '700' },
  primaryBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 15, marginBottom: 10 },
  primaryBtnText:  { color: '#fff', fontSize: 15, fontWeight: '700' },
  ghostBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, paddingVertical: 14, borderWidth: 1.5, borderColor: '#b91c1c' },
  ghostBtnText:  { color: '#b91c1c', fontSize: 14.5, fontWeight: '700' },

  footNote: { fontSize: 11.5, color: '#9ca3af', textAlign: 'center', marginTop: 18, lineHeight: 17, paddingHorizontal: 20 },
});
