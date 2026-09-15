import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, TextInput, ActivityIndicator, Alert, Modal
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../stores/authStore';
import { useBadgeStore } from '../stores/badgeStore';

import { API_URL } from '../constants/api';

const PAYMENT_METHODS = [
  { id: 'cod',   label: 'Cash on Delivery',  icon: '💵' },
  { id: 'gcash', label: 'GCash',             icon: '📱' },
  { id: 'card',  label: 'Credit/Debit Card', icon: '💳' },
];

/**
 * Which methods each order type may use. Mirrors Order::PAYMENT_METHODS_BY_TYPE
 * on the server, which rejects the rest — this list only decides what is shown.
 *
 * Cash on Delivery made no sense for a pickup and was offered anyway, and
 * "Cash (Pickup)" is gone entirely: a pickup order that costs nothing to place
 * and nothing to abandon is free to spam, while its stock sits reserved for
 * someone who never comes. Pickups are paid online.
 */
const METHODS_FOR = {
  delivery: ['cod', 'gcash', 'card'],
  pickup:   ['gcash', 'card'],
};

export default function Checkout() {
  const { token, user }             = useAuthStore();
  const params                      = useLocalSearchParams();
  const [orderType, setOrderType]   = useState('delivery');
  const [payment, setPayment]       = useState('cod');
  const paymentMethods = PAYMENT_METHODS.filter((m) => METHODS_FOR[orderType].includes(m.id));
  const [address, setAddress]       = useState(user?.address || '');
  const [placing, setPlacing]       = useState(false);

  // Only the cart lines ticked on the cart screen are ordered. Arriving here
  // without params (deep link) falls back to checking out the whole cart.
  const cartItemIds = params.cartItemIds
    ? String(params.cartItemIds).split(',').map(Number).filter(Boolean)
    : null;

  const [items, setItems]     = useState([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [confirming, setConfirming]     = useState(false);

  // Re-read the cart rather than trusting the params — price and stock may have
  // moved since the cart screen rendered, and the review must show what will
  // actually be charged.
  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch(`${API_URL}/cart`, {
          headers: {
            'Accept':        'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });
        const data = await res.json();
        const all  = data.items || [];
        setItems(cartItemIds ? all.filter((i) => cartItemIds.includes(i.cart_item_id)) : all);
      } catch (e) {
        console.log('Checkout cart error:', e.message);
      } finally {
        setLoadingItems(false);
      }
    })();
  }, []);

  const total       = items.reduce((sum, i) => sum + parseFloat(i.subtotal), 0);
  const paymentName = PAYMENT_METHODS.find((m) => m.id === payment)?.label ?? payment;

  // Switching to pickup while Cash on Delivery is ticked would otherwise leave
  // a selection the server refuses, discovered only at Place Order.
  useEffect(() => {
    if (!METHODS_FOR[orderType].includes(payment)) {
      setPayment(METHODS_FOR[orderType][0]);
    }
  }, [orderType, payment]);

  // Last stop before the order is committed and stock is deducted
  const reviewOrder = () => {
    if (orderType === 'delivery' && !address.trim()) {
      Alert.alert('Address Required', 'Please enter your delivery address.');
      return;
    }
    if (!loadingItems && items.length === 0) {
      Alert.alert('Nothing to Order', 'There are no items selected for checkout.');
      return;
    }
    setConfirming(true);
  };

  const placeOrder = async () => {
    setConfirming(false);
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
          ...(cartItemIds ? { cart_item_ids: cartItemIds } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // A partial checkout leaves the unticked lines behind, so the new count
        // has to come from the server rather than being assumed to be zero.
        useBadgeStore.getState().refresh(token);

        router.replace({
          pathname: '/order-success',
          params: {
            orderId:  data.order.id,
            total:    data.order.total_amount,
            placedAt: data.order.order_date ?? data.order.created_at,
          },
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

        {/* Items being ordered */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Order Summary{items.length > 0 ? ` (${items.length} item${items.length > 1 ? 's' : ''})` : ''}
          </Text>

          {loadingItems ? (
            <ActivityIndicator color="#b91c1c" />
          ) : items.length === 0 ? (
            <Text style={styles.summaryLabel}>No items selected.</Text>
          ) : (
            <>
              {items.map((item) => (
                <View key={item.cart_item_id} style={styles.lineRow}>
                  <View style={[styles.lineSwatch, { backgroundColor: item.hex_code || '#e5e5e5' }]} />
                  <View style={styles.lineInfo}>
                    <Text style={styles.lineName} numberOfLines={2}>{item.name}</Text>
                    {item.is_custom ? (
                      <Text style={styles.lineCustom} numberOfLines={1}>
                        Custom mix · {item.color_label || item.custom_hex}
                      </Text>
                    ) : item.color_label ? (
                      /* The name is the paint LINE now, so the shade has to be
                         stated — this is the last screen before committing. */
                      <Text style={styles.lineShade} numberOfLines={1}>{item.color_label}</Text>
                    ) : null}
                    <Text style={styles.lineMeta}>
                      {item.size_volume ? `${item.size_volume} · ` : ''}
                      {item.quantity} × ₱{parseFloat(item.price).toLocaleString()}
                      {parseFloat(item.tint_fee ?? 0) > 0
                        ? ` (incl. ₱${parseFloat(item.tint_fee).toLocaleString()} mixing)`
                        : ''}
                    </Text>
                  </View>
                  <Text style={styles.lineSubtotal}>
                    ₱{parseFloat(item.subtotal).toLocaleString()}
                  </Text>
                </View>
              ))}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal</Text>
                <Text style={styles.summaryValue}>₱{total.toLocaleString()}</Text>
              </View>

              {/* Repeated here, not only at add-to-cart: this is the last
                  screen before the money moves, and a mixed can cannot be
                  resold to anyone else. */}
              {items.some((i) => i.is_custom) && (
                <View style={styles.customNotice}>
                  <Text style={styles.customNoticeText}>
                    This order includes custom-mixed paint. It is made for you
                    once the order is confirmed, and cannot be returned,
                    refunded or cancelled after mixing starts.
                  </Text>
                </View>
              )}
            </>
          )}
        </View>

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
          {orderType === 'pickup' && (
            <Text style={styles.paymentNote}>
              Pickup orders are paid online, so your paint is reserved and
              waiting when you arrive.
            </Text>
          )}
          {paymentMethods.map((method) => (
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
        <View style={styles.footerTotalRow}>
          <Text style={styles.footerTotalLabel}>Total</Text>
          <Text style={styles.footerTotalValue}>₱{total.toLocaleString()}</Text>
        </View>
        <TouchableOpacity
          style={styles.placeBtn}
          onPress={reviewOrder}
          disabled={placing || loadingItems}
        >
          {placing
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.placeBtnText}>Place Order</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Final confirmation — the order commits and deducts stock after this */}
      <Modal
        visible={confirming}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirming(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirm Your Order</Text>
            <Text style={styles.modalSubtitle}>
              Please review before placing. Stock is reserved once you confirm.
            </Text>

            <View style={styles.modalDivider} />

            <View style={styles.modalRow}>
              <Text style={styles.modalKey}>Items</Text>
              <Text style={styles.modalVal}>
                {items.reduce((n, i) => n + i.quantity, 0)} unit(s) · {items.length} line(s)
              </Text>
            </View>
            <View style={styles.modalRow}>
              <Text style={styles.modalKey}>{orderType === 'delivery' ? 'Deliver to' : 'Pickup at'}</Text>
              <Text style={styles.modalVal} numberOfLines={2}>
                {orderType === 'delivery' ? address.trim() : 'NCM Paint Center, Balanga'}
              </Text>
            </View>
            <View style={styles.modalRow}>
              <Text style={styles.modalKey}>Payment</Text>
              <Text style={styles.modalVal}>{paymentName}</Text>
            </View>

            <View style={styles.modalDivider} />

            <View style={styles.modalRow}>
              <Text style={styles.modalTotalKey}>Total</Text>
              <Text style={styles.modalTotalVal}>₱{total.toLocaleString()}</Text>
            </View>

            <TouchableOpacity style={styles.modalConfirm} onPress={placeOrder}>
              <Text style={styles.modalConfirmText}>Confirm Order</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setConfirming(false)}>
              <Text style={styles.modalCancelText}>Go Back &amp; Review</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  summaryRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#eee' },
  summaryLabel:       { fontSize: 14, color: '#666' },
  summaryValue:       { fontSize: 18, fontWeight: '700', color: '#b91c1c' },
  lineRow:            { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  lineSwatch:         { width: 34, height: 34, borderRadius: 8, marginRight: 10 },
  lineInfo:           { flex: 1 },
  lineName:           { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  lineMeta:           { fontSize: 11.5, color: '#888', marginTop: 2 },
  lineShade:          { fontSize: 12, color: '#666', fontWeight: '600', marginTop: 1 },
  lineCustom:         { fontSize: 11.5, color: '#92400e', fontWeight: '600', marginTop: 2 },
  customNotice:       { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fcd34d', borderRadius: 10, padding: 12, marginTop: 12 },
  customNoticeText:   { fontSize: 12.5, color: '#92400e', lineHeight: 18 },
  lineSubtotal:       { fontSize: 13.5, fontWeight: '700', color: '#1a1a1a', marginLeft: 8 },
  modalBackdrop:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalCard:          { backgroundColor: '#fff', borderRadius: 20, padding: 22 },
  modalTitle:         { fontSize: 19, fontWeight: '700', color: '#1a1a1a' },
  modalSubtitle:      { fontSize: 12.5, color: '#888', marginTop: 4, lineHeight: 18 },
  modalDivider:       { height: 1, backgroundColor: '#eee', marginVertical: 14 },
  modalRow:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 16 },
  modalKey:           { fontSize: 13, color: '#888' },
  modalVal:           { fontSize: 13, color: '#1a1a1a', fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  modalTotalKey:      { fontSize: 15, color: '#1a1a1a', fontWeight: '600' },
  modalTotalVal:      { fontSize: 22, fontWeight: '700', color: '#b91c1c' },
  modalConfirm:       { backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 6 },
  modalConfirmText:   { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  modalCancel:        { paddingVertical: 13, alignItems: 'center' },
  modalCancelText:    { color: '#888', fontSize: 14, fontWeight: '600' },
  footerTotalRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  footerTotalLabel:   { fontSize: 15, color: '#666' },
  footerTotalValue:   { fontSize: 22, fontWeight: '700', color: '#1a1a1a' },
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
  paymentNote:        { fontSize: 12.5, color: '#666', lineHeight: 18, marginBottom: 12, marginTop: -4 },
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