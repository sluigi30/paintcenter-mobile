import { useState, useEffect } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, FlatList, Dimensions
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';

const API_URL = 'http://192.168.1.69:8000/api';
const SCREEN_WIDTH = Dimensions.get('window').width;

export default function ProductDetail() {
  const { id } = useLocalSearchParams();
  const [product, setProduct]     = useState(null);
  const [loading, setLoading]     = useState(true);
  const [quantity, setQuantity]   = useState(1);
  const [adding, setAdding]       = useState(false);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [activeImage, setActiveImage] = useState(0);
  const { token } = useAuthStore();

  const gallery = product?.images ?? [];

  // Each size is a variant with its OWN price and stock
  const variants = product?.active_variants ?? [];
  const hasSizeChoice = variants.length > 1;

  useEffect(() => {
    fetch(`${API_URL}/products/${id}`, {
      headers: { 'Accept': 'application/json' },
    })
      .then(res => res.json())
      .then(data => {
        setProduct(data);
        const list = data.active_variants ?? [];
        // Auto-select if only one size
        if (list.length === 1) setSelectedVariant(list[0]);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const pickVariant = (variant) => {
    if (variant.stock === 0) return;
    setSelectedVariant(variant);
    setQuantity(q => Math.min(q, variant.stock));
  };

  const handleAddToCart = async () => {
    if (!selectedVariant) {
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
          product_variant_id: selectedVariant.id,
          quantity,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        Alert.alert(
          'Added to Cart!',
          `${quantity}x ${product.description} (${selectedVariant.size_volume}) added.`,
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
    return <View style={styles.center}><ActivityIndicator size="large" color="#b91c1c" /></View>;
  }

  if (!product) {
    return <View style={styles.center}><Text>Product not found.</Text></View>;
  }

  // Price + stock reflect the chosen size; before choosing, show the range
  const shownPrice = selectedVariant
    ? `₱${parseFloat(selectedVariant.price).toLocaleString()}`
    : variants.length
      ? `from ₱${Math.min(...variants.map(v => parseFloat(v.price))).toLocaleString()}`
      : '—';

  const shownStock = selectedVariant ? selectedVariant.stock : product.stock;
  const canAdd = selectedVariant !== null && selectedVariant.stock > 0;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

      {/* Product Image Gallery — swipeable, first image is the cover */}
      {gallery.length > 0 ? (
        <View>
          <FlatList
            data={gallery}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(img, i) => `${i}-${img}`}
            onMomentumScrollEnd={(e) =>
              setActiveImage(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
            renderItem={({ item: img }) => (
              <Image
                source={{ uri: `${API_URL.replace('/api', '')}/storage/${img}` }}
                style={styles.image}
                resizeMode="cover"
              />
            )}
          />
          {gallery.length > 1 && (
            <>
              <View style={styles.dots}>
                {gallery.map((_, i) => (
                  <View key={i} style={[styles.dot, i === activeImage && styles.dotActive]} />
                ))}
              </View>
              <View style={styles.imageCounter}>
                <Text style={styles.imageCounterText}>{activeImage + 1}/{gallery.length}</Text>
              </View>
            </>
          )}
        </View>
      ) : (
        <View style={[styles.image, { backgroundColor: product.hex_code || '#ccc' }]} />
      )}

      <View style={styles.content}>

        {/* Brand + Color Dot */}
        <View style={styles.row}>
          <Text style={styles.brand}>{product.brand?.brand_name}</Text>
          <View style={[styles.colorDot, { backgroundColor: product.hex_code || '#ccc' }]} />
        </View>

        {/* Name (with color name, like a normal e-commerce title) + meta line */}
        <Text style={styles.desc}>
          {product.description}{product.color_name ? ` — ${product.color_name}` : ''}
        </Text>
        <Text style={styles.category}>
          {product.category?.category_name}
          {product.color_code ? `  ·  Color Code: ${product.color_code}` : ''}
        </Text>

        {/* Price + Stock (per selected size) */}
        <View style={styles.priceRow}>
          <Text style={styles.price}>{shownPrice}</Text>
          <Text style={[styles.stock, { color: shownStock < 10 ? '#ef4444' : '#22c55e' }]}>
            {shownStock > 0
              ? `${shownStock} in stock${selectedVariant ? ` (${selectedVariant.size_volume})` : ''}`
              : 'Out of stock'}
          </Text>
        </View>

        {/* ── SIZE SELECTOR — each size has its own price + stock ── */}
        <View style={styles.sizeSection}>
          <View style={styles.sizeLabelRow}>
            <Text style={styles.sizeLabel}>{hasSizeChoice ? 'Select Size' : 'Size'}</Text>
            {hasSizeChoice && !selectedVariant && (
              <Text style={styles.sizeRequired}>* Required</Text>
            )}
          </View>
          <View style={styles.sizeChips}>
            {variants.map(variant => {
              const active  = selectedVariant?.id === variant.id;
              const soldOut = variant.stock === 0;
              return (
                <TouchableOpacity
                  key={variant.id}
                  style={[
                    styles.sizeChip,
                    active && styles.sizeChipActive,
                    soldOut && styles.sizeChipDisabled,
                  ]}
                  onPress={() => pickVariant(variant)}
                  disabled={soldOut}
                >
                  <Text style={[
                    styles.sizeChipText,
                    active && styles.sizeChipTextActive,
                    soldOut && styles.sizeChipTextDisabled,
                  ]}>
                    {variant.size_volume}
                  </Text>
                  <Text style={[
                    styles.sizeChipPrice,
                    active && styles.sizeChipTextActive,
                    soldOut && styles.sizeChipTextDisabled,
                  ]}>
                    {soldOut ? 'Sold out' : `₱${parseFloat(variant.price).toLocaleString()}`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

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
              onPress={() => setQuantity(q =>
                Math.min(selectedVariant?.stock ?? 1, q + 1))}
            >
              <Text style={styles.qtyBtnText}>+</Text>
            </TouchableOpacity>
            {selectedVariant && (
              <Text style={styles.qtyTotal}>
                = ₱{(parseFloat(selectedVariant.price) * quantity).toLocaleString()}
              </Text>
            )}
          </View>
        </View>

        {/* ── ADD TO CART ───────────────────────────────── */}
        <TouchableOpacity
          style={[styles.addBtn, !canAdd && styles.addBtnDisabled]}
          onPress={handleAddToCart}
          disabled={adding || !canAdd}
        >
          {adding ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.addBtnText}>
              {!selectedVariant
                ? 'Select a Size First'
                : selectedVariant.stock === 0
                  ? 'Out of Stock'
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
  image:              { width: SCREEN_WIDTH, height: 280 },

  // Gallery dots + counter
  dots:               { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot:                { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive:          { backgroundColor: '#fff', width: 18 },
  imageCounter:       { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  imageCounterText:   { color: '#fff', fontSize: 12, fontWeight: '600' },
  content:            { padding: 20 },
  row:                { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  brand:              { fontSize: 13, color: '#b91c1c', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
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
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1.5,
    borderColor: '#e0e0e0', backgroundColor: '#f9f9f9',
    alignItems: 'center', minWidth: 76,
  },
  sizeChipActive:     {
    borderColor: '#b91c1c', backgroundColor: '#fef2f2',
  },
  sizeChipDisabled:   {
    borderColor: '#eee', backgroundColor: '#f5f5f5', opacity: 0.6,
  },
  sizeChipText:       { fontSize: 14, fontWeight: '700', color: '#666' },
  sizeChipTextActive: { color: '#b91c1c' },
  sizeChipTextDisabled: { color: '#bbb' },
  sizeChipPrice:      { fontSize: 11, fontWeight: '600', color: '#999', marginTop: 2 },

  // Quantity
  qtySection:         { marginBottom: 24 },
  qtyRow:             { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 12 },
  qtyBtn:             { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' },
  qtyBtnText:         { fontSize: 20, color: '#1a1a1a', fontWeight: '500' },
  qty:                { fontSize: 20, fontWeight: '700', color: '#1a1a1a', minWidth: 30, textAlign: 'center' },
  qtyTotal:           { fontSize: 15, color: '#666', fontWeight: '500', marginLeft: 4 },

  // Buttons
  addBtn:             { backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  addBtnDisabled:     { backgroundColor: '#d1d5db' },
  addBtnText:         { color: '#fff', fontSize: 17, fontWeight: '700' },
  arBtn:              { borderWidth: 1.5, borderColor: '#b91c1c', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  arBtnText:          { color: '#b91c1c', fontSize: 15, fontWeight: '600' },
  backBtn:            { alignItems: 'center', paddingVertical: 12 },
  backBtnText:        { color: '#999', fontSize: 14 },
});
