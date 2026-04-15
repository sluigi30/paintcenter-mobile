import { useState, useEffect } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';

const API_URL = 'http://192.168.1.69:8000/api';

export default function ProductDetail() {
  const { id } = useLocalSearchParams();
  const [product, setProduct]     = useState(null);
  const [loading, setLoading]     = useState(true);
  const [quantity, setQuantity]   = useState(1);
  const [adding, setAdding]       = useState(false);
  const [selectedSize, setSelectedSize] = useState(null);
  const { token } = useAuthStore();

  // Parse size_volume into array of options
  // Handles both "1L, 4L, 16L" and single "4L"
  const sizeOptions = product?.size_volume
    ? product.size_volume.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const hasSizeChoice = sizeOptions.length > 1;

  useEffect(() => {
    fetch(`${API_URL}/products/${id}`, {
      headers: { 'Accept': 'application/json' },
    })
      .then(res => res.json())
      .then(data => {
        setProduct(data);
        // Auto-select if only one size
        const sizes = data.size_volume
          ? data.size_volume.split(',').map(s => s.trim()).filter(Boolean)
          : [];
        if (sizes.length === 1) setSelectedSize(sizes[0]);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleAddToCart = async () => {
    if (hasSizeChoice && !selectedSize) {
      Alert.alert('Select a Size', 'Please choose a size before adding to cart.');
      return;
    }

    setAdding(true);
    try {
      const res = await fetch(`${API_URL}/cart/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          product_id:    product.id,
          quantity,
          selected_size: selectedSize,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        Alert.alert(
          'Added to Cart!',
          `${quantity}x ${product.description}${selectedSize ? ` (${selectedSize})` : ''} added.`,
          [
            { text: 'Continue Shopping', style: 'cancel' },
            { text: 'View Cart', onPress: () => router.push('/(tabs)/cart') },
          ]
        );
      } else {
        Alert.alert('Error', data.message || 'Failed to add to cart.');
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#f97316" /></View>;
  }

  if (!product) {
    return <View style={styles.center}><Text>Product not found.</Text></View>;
  }

  const canAdd = !hasSizeChoice || selectedSize !== null;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

      {/* Product Image or Color Swatch */}
      {product.image ? (
        <Image
          source={{ uri: `${API_URL.replace('/api', '')}/storage/${product.image}` }}
          style={styles.image}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.image, { backgroundColor: product.hex_code || '#ccc' }]} />
      )}

      <View style={styles.content}>

        {/* Brand + Color Dot */}
        <View style={styles.row}>
          <Text style={styles.brand}>{product.brand?.brand_name}</Text>
          <View style={[styles.colorDot, { backgroundColor: product.hex_code || '#ccc' }]} />
        </View>

        {/* Name + Category */}
        <Text style={styles.desc}>{product.description}</Text>
        <Text style={styles.category}>{product.category?.category_name}</Text>

        {/* Price + Stock */}
        <View style={styles.priceRow}>
          <Text style={styles.price}>₱{parseFloat(product.price).toLocaleString()}</Text>
          <Text style={[styles.stock, { color: product.stock < 10 ? '#ef4444' : '#22c55e' }]}>
            {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
          </Text>
        </View>

        {/* ── SIZE SELECTOR ─────────────────────────────── */}
        {hasSizeChoice && (
          <View style={styles.sizeSection}>
            <View style={styles.sizeLabelRow}>
              <Text style={styles.sizeLabel}>Select Size</Text>
              {!selectedSize && (
                <Text style={styles.sizeRequired}>* Required</Text>
              )}
            </View>
            <View style={styles.sizeChips}>
              {sizeOptions.map(size => {
                const active = selectedSize === size;
                return (
                  <TouchableOpacity
                    key={size}
                    style={[styles.sizeChip, active && styles.sizeChipActive]}
                    onPress={() => setSelectedSize(size)}
                  >
                    <Text style={[styles.sizeChipText, active && styles.sizeChipTextActive]}>
                      {size}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Single size display (not selectable) */}
        {!hasSizeChoice && sizeOptions.length === 1 && (
          <View style={styles.singleSize}>
            <Text style={styles.sizeLabelInline}>Size: </Text>
            <View style={styles.sizeChipActive}>
              <Text style={styles.sizeChipTextActive}>{sizeOptions[0]}</Text>
            </View>
          </View>
        )}

        {/* ── QUANTITY SELECTOR ─────────────────────────── */}
        <View style={styles.qtySection}>
          <Text style={styles.sizeLabel}>Quantity</Text>
          <View style={styles.qtyRow}>
            <TouchableOpacity
              style={styles.qtyBtn}
              onPress={() => setQuantity(q => Math.max(1, q - 1))}
            >
              <Text style={styles.qtyBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.qty}>{quantity}</Text>
            <TouchableOpacity
              style={styles.qtyBtn}
              onPress={() => setQuantity(q => Math.min(product.stock, q + 1))}
            >
              <Text style={styles.qtyBtnText}>+</Text>
            </TouchableOpacity>
            <Text style={styles.qtyTotal}>
              = ₱{(parseFloat(product.price) * quantity).toLocaleString()}
            </Text>
          </View>
        </View>

        {/* ── ADD TO CART ───────────────────────────────── */}
        <TouchableOpacity
          style={[styles.addBtn, !canAdd && styles.addBtnDisabled]}
          onPress={handleAddToCart}
          disabled={adding || !canAdd || product.stock === 0}
        >
          {adding ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.addBtnText}>
              {product.stock === 0
                ? 'Out of Stock'
                : hasSizeChoice && !selectedSize
                  ? 'Select a Size First'
                  : 'Add to Cart'}
            </Text>
          )}
        </TouchableOpacity>

        {/* AR Preview */}
        <TouchableOpacity
          style={styles.arBtn}
          onPress={() => router.push({ pathname: '/ar/preview', params: { hex: product.hex_code } })}
        >
          <Text style={styles.arBtnText}>🎨 Preview on Wall (AR)</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>

      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#fff' },
  center:             { flex: 1, justifyContent: 'center', alignItems: 'center' },
  image:              { width: '100%', height: 280 },
  content:            { padding: 20 },
  row:                { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  brand:              { fontSize: 13, color: '#f97316', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  colorDot:           { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: '#e0e0e0' },
  desc:               { fontSize: 19, fontWeight: '700', color: '#1a1a1a', marginBottom: 4, lineHeight: 26 },
  category:           { fontSize: 13, color: '#999', marginBottom: 16 },

  priceRow:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  price:              { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  stock:              { fontSize: 13, fontWeight: '600' },

  // Size selector
  sizeSection:        { marginBottom: 24 },
  sizeLabelRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sizeLabel:          { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  sizeRequired:       { fontSize: 12, color: '#ef4444', fontWeight: '500' },
  sizeChips:          { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sizeChip:           {
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1.5,
    borderColor: '#e0e0e0', backgroundColor: '#f9f9f9',
  },
  sizeChipActive:     {
    borderColor: '#f97316', backgroundColor: '#fff7ed',
  },
  sizeChipText:       { fontSize: 14, fontWeight: '600', color: '#666' },
  sizeChipTextActive: { color: '#f97316' },

  singleSize:         { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  sizeLabelInline:    { fontSize: 14, color: '#666' },

  // Quantity
  qtySection:         { marginBottom: 24 },
  qtyRow:             { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 12 },
  qtyBtn:             { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' },
  qtyBtnText:         { fontSize: 20, color: '#1a1a1a', fontWeight: '500' },
  qty:                { fontSize: 20, fontWeight: '700', color: '#1a1a1a', minWidth: 30, textAlign: 'center' },
  qtyTotal:           { fontSize: 15, color: '#666', fontWeight: '500', marginLeft: 4 },

  // Buttons
  addBtn:             { backgroundColor: '#f97316', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  addBtnDisabled:     { backgroundColor: '#d1d5db' },
  addBtnText:         { color: '#fff', fontSize: 17, fontWeight: '700' },
  arBtn:              { borderWidth: 1.5, borderColor: '#f97316', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  arBtnText:          { color: '#f97316', fontSize: 15, fontWeight: '600' },
  backBtn:            { alignItems: 'center', paddingVertical: 12 },
  backBtnText:        { color: '#999', fontSize: 14 },
});