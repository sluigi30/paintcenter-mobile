import { useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Modal,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';

import { API_URL } from '../constants/api';
import { CANCEL_REASONS } from '../constants/orders';

/**
 * The cancellation reason picker, shared by the Orders list and the order
 * detail screen so both send the same vocabulary.
 *
 * A reason is REQUIRED — the API rejects the request without one, and the
 * reason is repeated back to the customer in their message thread.
 *
 * @param orderId  id of the order to cancel, or null to stay closed
 * @param token    bearer token
 * @param onClose  called when the sheet is dismissed without cancelling
 * @param onDone   called after a successful cancellation, so the caller can refresh
 */
export default function CancelOrderModal({ orderId, token, onClose, onDone }) {
  const [reason, setReason]         = useState(null);
  const [otherText, setOtherText]   = useState('');
  const [cancelling, setCancelling] = useState(false);

  const chosenReason = reason === 'other' ? otherText.trim() : reason;

  const close = () => {
    setReason(null);
    setOtherText('');
    onClose();
  };

  const submit = async () => {
    if (!chosenReason) return;

    setCancelling(true);
    try {
      const res = await fetch(`${API_URL}/orders/${orderId}/cancel`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Accept':        'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: chosenReason }),
      });
      const data = await res.json();

      if (res.ok) {
        close();
        Alert.alert(
          'Order Cancelled',
          'Your order has been cancelled and the items returned to stock.'
        );
        onDone?.();
      } else {
        Alert.alert('Could Not Cancel', data.message || 'Please try again.');
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Modal
      visible={orderId !== null && orderId !== undefined}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Cancel Order</Text>
          <Text style={styles.subtitle}>
            Let us know why so we can improve. Your items go back into stock.
          </Text>

          {CANCEL_REASONS.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.reasonRow, reason === r && styles.reasonRowActive]}
              onPress={() => setReason(r)}
            >
              <View style={[styles.radio, reason === r && styles.radioActive]}>
                {reason === r && <View style={styles.radioDot} />}
              </View>
              <Text style={[styles.reasonRowText, reason === r && styles.reasonRowTextActive]}>
                {r}
              </Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={[styles.reasonRow, reason === 'other' && styles.reasonRowActive]}
            onPress={() => setReason('other')}
          >
            <View style={[styles.radio, reason === 'other' && styles.radioActive]}>
              {reason === 'other' && <View style={styles.radioDot} />}
            </View>
            <Text style={[styles.reasonRowText, reason === 'other' && styles.reasonRowTextActive]}>
              Other
            </Text>
          </TouchableOpacity>

          {reason === 'other' && (
            <TextInput
              style={styles.otherInput}
              placeholder="Tell us what happened..."
              placeholderTextColor="#999"
              value={otherText}
              onChangeText={setOtherText}
              maxLength={500}
              multiline
              autoFocus
            />
          )}

          <TouchableOpacity
            style={[styles.confirmBtn, !chosenReason && styles.confirmBtnOff]}
            onPress={submit}
            disabled={!chosenReason || cancelling}
          >
            {cancelling
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.confirmBtnText}>Cancel This Order</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.keepBtn} onPress={close}>
            <Text style={styles.keepBtnText}>Keep My Order</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  card:           { backgroundColor: '#fff', borderRadius: 20, padding: 22 },
  title:          { fontSize: 19, fontWeight: '700', color: '#1a1a1a' },
  subtitle:       { fontSize: 12.5, color: '#888', marginTop: 4, marginBottom: 14, lineHeight: 18 },
  reasonRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 10, marginBottom: 6, backgroundColor: '#f7f7f7', borderWidth: 1.5, borderColor: '#f7f7f7' },
  reasonRowActive:     { backgroundColor: '#fef2f2', borderColor: '#b91c1c' },
  reasonRowText:       { fontSize: 13.5, color: '#555', flex: 1 },
  reasonRowTextActive: { color: '#b91c1c', fontWeight: '600' },
  radio:          { width: 19, height: 19, borderRadius: 10, borderWidth: 2, borderColor: '#ccc', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  radioActive:    { borderColor: '#b91c1c' },
  radioDot:       { width: 9, height: 9, borderRadius: 5, backgroundColor: '#b91c1c' },
  otherInput:     { backgroundColor: '#f7f7f7', borderRadius: 10, padding: 12, fontSize: 14, color: '#1a1a1a', minHeight: 72, textAlignVertical: 'top', marginTop: 4, marginBottom: 4 },
  confirmBtn:     { backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 10 },
  confirmBtnOff:  { backgroundColor: '#d4a5a5' },
  confirmBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  keepBtn:        { paddingVertical: 13, alignItems: 'center' },
  keepBtnText:    { color: '#888', fontSize: 14, fontWeight: '600' },
});
