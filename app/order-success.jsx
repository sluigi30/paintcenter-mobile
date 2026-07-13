import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

export default function OrderSuccess() {
  const { orderId, total } = useLocalSearchParams();

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🎉</Text>
      <Text style={styles.title}>Order Placed!</Text>
      <Text style={styles.subtitle}>Your order has been successfully placed.</Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Order #</Text>
          <Text style={styles.value}>{orderId}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Total</Text>
          <Text style={styles.amount}>₱{parseFloat(total).toLocaleString()}</Text>
        </View>
      </View>

      <Text style={styles.info}>
        We'll notify you when your order status changes. You can track your order in the Orders tab.
      </Text>

      <TouchableOpacity
        style={styles.ordersBtn}
        onPress={() => router.replace('/(tabs)/orders')}
      >
        <Text style={styles.ordersBtnText}>View My Orders</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.shopBtn}
        onPress={() => router.replace('/(tabs)')}
      >
        <Text style={styles.shopBtnText}>Continue Shopping</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', padding: 24 },
  icon:         { fontSize: 80, marginBottom: 16 },
  title:        { fontSize: 28, fontWeight: '700', color: '#1a1a1a', marginBottom: 8 },
  subtitle:     { fontSize: 15, color: '#666', marginBottom: 24, textAlign: 'center' },
  card:         { backgroundColor: '#f5f5f5', borderRadius: 16, padding: 20, width: '100%', marginBottom: 20 },
  row:          { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  label:        { fontSize: 15, color: '#666' },
  value:        { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  amount:       { fontSize: 20, fontWeight: '700', color: '#b91c1c' },
  info:         { fontSize: 13, color: '#999', textAlign: 'center', marginBottom: 32, lineHeight: 20 },
  ordersBtn:    { backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40, marginBottom: 12, width: '100%', alignItems: 'center' },
  ordersBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  shopBtn:      { borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40, width: '100%', alignItems: 'center', borderWidth: 2, borderColor: '#b91c1c' },
  shopBtnText:  { color: '#b91c1c', fontSize: 16, fontWeight: '700' },
});