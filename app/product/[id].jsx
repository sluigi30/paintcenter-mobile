import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, FlatList, Dimensions
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';
import ColorPicker from '../../components/ColorPicker';
import { rememberColor } from '../../constants/recentColors';

import { API_URL } from '../../constants/api';
const SCREEN_WIDTH = Dimensions.get('window').width;

// The API returns variants unordered, so the size chips arrive as "16L, 1L, 4L".
// Tolerable with two sizes; not with a custom-colour product carrying three
// sizes across three bases. (The estimator parses sizes for its own arithmetic;
// this one only has to sort.)
const litres = (size) => {
  const m = String(size ?? '').match(/([\d.]+)\s*(ml|l|gal)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  switch ((m[2] ?? 'l').toLowerCase()) {
    case 'ml':  return n / 1000;
    case 'gal': return n * 3.785;
    default:    return n;
  }
};

export default function ProductDetail() {
  const { id, hex: hexParam } = useLocalSearchParams();
  const [product, setProduct]     = useState(null);
  const [loading, setLoading]     = useState(true);
  const [quantity, setQuantity]   = useState(1);
  const [adding, setAdding]       = useState(false);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [activeImage, setActiveImage] = useState(0);
  const { token } = useAuthStore();

  // The custom-colour sibling of a ready-mixed product, if this brand has one.
  const [customSibling, setCustomSibling] = useState(null);

  // ── Custom colour ──
  // hexParam arrives when the customer came from the AR wall preview having
  // already seen this colour on their own wall.
  const [customHex, setCustomHex] = useState(hexParam ?? null);
  const [colorName, setColorName] = useState('');
  const [resolved, setResolved]   = useState(null);   // GET /colors/resolve
  const [acknowledged, setAcknowledged] = useState(false);

  const gallery = product?.images ?? [];
  const isCustom = !!product?.is_custom_color;

  // Each size is a variant with its OWN price and stock.
  // A colour can only go into the base that can carry it, so for a custom
  // product the size list is filtered to the base the colour resolved to.
  // '' means the paint line makes no base distinction and any can will do.
  // The customer sees sizes; the word "base" never appears.
  // Memoised deliberately. Rebuilt inline it is a new array on every render,
  // which makes the effect below — which calls setSelectedVariant — run on
  // every render too. That is the shape React reports as "Maximum update
  // depth exceeded", and it only needs to change when the colour's base or
  // the product does.
  const sizeOptions = useMemo(() => {
    const list = product?.active_variants ?? [];
    const usable = isCustom
      ? list.filter(v => !v.base_code || v.base_code === resolved?.base_code)
      : list;
    return usable.slice().sort((a, b) => litres(a.size_volume) - litres(b.size_volume));
  }, [product, isCustom, resolved?.base_code]);

  const hasSizeChoice = sizeOptions.length > 1;
  const colourReady = !isCustom || (!!customHex && resolved?.in_gamut === true);

  // Changing the colour can change the base, which retires the size that was
  // selected. Leaving it selected would post a variant the server rejects.
  useEffect(() => {
    if (selectedVariant && !sizeOptions.some(v => v.id === selectedVariant.id)) {
      setSelectedVariant(null);
    } else if (!selectedVariant && sizeOptions.length === 1) {
      setSelectedVariant(sizeOptions[0]);
    }
  }, [sizeOptions, selectedVariant]);

  useEffect(() => {
    fetch(`${API_URL}/products/${id}`, {
      headers: { 'Accept': 'application/json' },
    })
      .then(res => res.json())
      // Auto-selecting a lone size is handled against sizeOptions, not the raw
      // list — on a custom product the raw list spans several bases.
      .then(setProduct)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  // Someone looking at a fixed colour they don't quite want has no way to
  // discover that this brand will mix any colour — the custom product is a
  // separate row in the catalogue and shares no search terms with this one.
  useEffect(() => {
    if (!product || product.is_custom_color || !product.brand?.id) return;

    let alive = true;
    fetch(`${API_URL}/products?tintable=1&brand_id=${product.brand.id}&per_page=1`, {
      headers: { Accept: 'application/json' },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive) setCustomSibling(data?.data?.[0] ?? null); })
      .catch(() => {});   // the link is a bonus; its absence breaks nothing
    return () => { alive = false; };
  }, [product]);

  const pickVariant = (variant) => {
    if (variant.stock === 0) return;
    setSelectedVariant(variant);
    setQuantity(q => Math.min(q, variant.stock));
  };

  const handleAddToCart = async () => {
    if (isCustom && !colourReady) {
      Alert.alert('Choose a Colour', 'Pick a colour we can mix before adding to cart.');
      return;
    }

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
          // Sent only for a custom product — the API rejects a colour on a
          // ready-mixed line rather than silently dropping it.
          ...(isCustom && {
            custom_hex: customHex,
            custom_color_name: colorName.trim() || null,
          }),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        // Recorded on the way out, not while picking: only a colour actually
        // bought earns a place in Recent.
        if (isCustom) rememberColor(customHex);

        Alert.alert(
          'Added to Cart!',
          `${quantity}x ${product.description} (${selectedVariant.size_volume})`
            + (isCustom ? ` in ${colorName.trim() || customHex}` : '') + ' added.',
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

  // What a can of this size actually costs. Mixing is charged on top of the
  // base price, and is never folded in silently — an unexplained gap between
  // the shelf price and the charged price is the complaint to avoid.
  const tintFee   = (v) => (isCustom ? parseFloat(v.tint_fee ?? 0) : 0);
  const unitPrice = (v) => parseFloat(v.price) + tintFee(v);
  const peso      = (n) => `₱${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  // Price + stock reflect the chosen size; before choosing, show the range
  const shownPrice = selectedVariant
    ? peso(unitPrice(selectedVariant))
    : sizeOptions.length
      ? `from ${peso(Math.min(...sizeOptions.map(unitPrice)))}`
      : '—';

  // product.stock is the total across EVERY variant, which on a custom-colour
  // product spans bases this colour cannot go into — quoting it would promise
  // cans that are not buyable in this colour. Count only what can hold it.
  const shownStock = selectedVariant
    ? selectedVariant.stock
    : isCustom
      ? sizeOptions.reduce((sum, v) => sum + (v.stock ?? 0), 0)
      : product.stock;

  const canAdd =
    colourReady &&
    selectedVariant !== null &&
    selectedVariant.stock > 0 &&
    (!isCustom || acknowledged);

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
        <View style={[styles.image, {
          backgroundColor: (isCustom ? customHex : product.hex_code) || '#ccc',
        }]} />
      )}

      <View style={styles.content}>

        {/* Brand + Color Dot */}
        <View style={styles.row}>
          <Text style={styles.brand}>{product.brand?.brand_name}</Text>
          <View style={[styles.colorDot, {
            backgroundColor: (isCustom ? customHex : product.hex_code) || '#ccc',
          }]} />
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

        {/* The mixing charge, stated rather than folded into the price. */}
        {isCustom && selectedVariant && tintFee(selectedVariant) > 0 && (
          <Text style={styles.feeNote}>
            {peso(parseFloat(selectedVariant.price))} + {peso(tintFee(selectedVariant))} colour
            mixing, per can
          </Text>
        )}

        {/* ── COLOUR PICKER — only for paint mixed to order ── */}
        {isCustom && (
          <View style={styles.colorSection}>
            <Text style={styles.sizeLabel}>Choose your colour</Text>
            <Text style={styles.colorHelp}>
              Mixed for you in store. Any colour on the sliders below, or type a
              code you already have.
            </Text>

            <ColorPicker
              value={customHex}
              onChange={setCustomHex}
              onResolved={setResolved}
            />

            <Text style={[styles.sizeLabel, { marginTop: 4 }]}>Name it (optional)</Text>
            <TextInput
              style={styles.nameInput}
              value={colorName}
              onChangeText={setColorName}
              placeholder="e.g. Ella's Room"
              placeholderTextColor="#aaa"
              maxLength={60}
            />
          </View>
        )}

        {/* ── SIZE SELECTOR — each size has its own price + stock ── */}
        <View style={styles.sizeSection}>
          <View style={styles.sizeLabelRow}>
            <Text style={styles.sizeLabel}>{hasSizeChoice ? 'Select Size' : 'Size'}</Text>
            {hasSizeChoice && !selectedVariant && (
              <Text style={styles.sizeRequired}>* Required</Text>
            )}
          </View>
          <View style={styles.sizeChips}>
            {isCustom && !colourReady ? (
              <Text style={styles.sizeHint}>
                Pick a colour above to see the sizes it comes in.
              </Text>
            ) : sizeOptions.length === 0 ? (
              <Text style={styles.sizeHint}>
                This colour isn't available in any size right now.
              </Text>
            ) : sizeOptions.map(variant => {
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
                    {soldOut ? 'Sold out' : peso(unitPrice(variant))}
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
                = {peso(unitPrice(selectedVariant) * quantity)}
              </Text>
            )}
          </View>
        </View>

        {/* Made to order, and unsellable to anyone else once mixed. Stated
            HERE — at the moment of commitment — rather than as fine print at
            checkout or as a Cancel button that has quietly disappeared. */}
        {isCustom && (
          <TouchableOpacity
            style={styles.ack}
            onPress={() => setAcknowledged(a => !a)}
            activeOpacity={0.7}
          >
            <View style={[styles.ackBox, acknowledged && styles.ackBoxOn]}>
              {acknowledged && <Text style={styles.ackTick}>✓</Text>}
            </View>
            <Text style={styles.ackText}>
              I understand this paint is mixed to order and cannot be returned,
              refunded or cancelled once mixing has started.
            </Text>
          </TouchableOpacity>
        )}

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
              {isCustom && !colourReady
                ? 'Choose a Colour First'
                : !selectedVariant
                  ? 'Select a Size First'
                  : selectedVariant.stock === 0
                    ? 'Out of Stock'
                    : isCustom && !acknowledged
                      ? 'Tick the Box Above'
                      : 'Add to Cart'}
            </Text>
          )}
        </TouchableOpacity>

        {/* A LINK, not a toggle on this product: a finished red can cannot be
            tinted, so this navigates to a different SKU with its own price and
            stock. A toggle would swap those silently under the customer. */}
        {customSibling && (
          <TouchableOpacity
            style={styles.mixLink}
            onPress={() => router.push(`/product/${customSibling.id}`)}
            activeOpacity={0.8}
          >
            <Text style={styles.mixLinkText}>
              Want a different colour?{' '}
              <Text style={styles.mixLinkStrong}>We'll mix it →</Text>
            </Text>
          </TouchableOpacity>
        )}

        {/* Paint preview — CV wall segmentation. Excludes furniture, windows and
            wall art per-pixel, and needs no ARCore, so it runs on any camera phone. */}
        <TouchableOpacity
          style={styles.arBtn}
          onPress={() => router.push({
            pathname: '/ar/live-filter',
            params: { hex: (isCustom ? customHex : product.hex_code) ?? '' },
          })}
        >
          <Text style={styles.arBtnText}>🎨 Preview on Wall</Text>
        </TouchableOpacity>

        {/* Paint calculator — walls in, cans of THIS paint out, at today's
            prices. Opened with the product id rather than the whole product so
            the calculator re-reads stock and price before it quotes a total.
            The ARCore wall measurement lives inside it, offered per wall: it is
            an input to the sum, not a gate in front of it, and it needs an
            ARCore-certified device while the sum itself needs nothing. */}
        <TouchableOpacity
          style={styles.arBtnAlt}
          onPress={() => router.push({
            pathname: '/ar/estimator',
            params: {
              productId: product.id,
              hex: (isCustom ? customHex : product.hex_code) ?? '',
            },
          })}
        >
          <Text style={styles.arBtnAltText}>🧮 How Much Paint Do I Need?</Text>
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
  sizeHint:           { fontSize: 13, color: '#999', lineHeight: 19, paddingVertical: 4 },

  // Custom colour
  feeNote:            { fontSize: 12, color: '#666', marginTop: -16, marginBottom: 20 },
  colorSection:       { marginBottom: 24 },
  colorHelp:          { fontSize: 13, color: '#999', lineHeight: 19, marginTop: 4, marginBottom: 14 },
  nameInput:          {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 15,
    color: '#1a1a1a', backgroundColor: '#f9f9f9', marginTop: 8,
  },
  ack:                { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 16 },
  ackBox:             { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#b91c1c', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  ackBoxOn:           { backgroundColor: '#b91c1c' },
  ackTick:            { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 16 },
  ackText:            { flex: 1, fontSize: 12.5, color: '#666', lineHeight: 18 },
  mixLink:            { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, marginBottom: 12 },
  mixLinkText:        { fontSize: 14, color: '#9a3412', textAlign: 'center' },
  mixLinkStrong:      { fontWeight: '700' },

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
  arBtnAlt:           { borderWidth: 1, borderColor: '#9ca3af', borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginBottom: 12 },
  arBtnAltText:       { color: '#4b5563', fontSize: 14, fontWeight: '600' },
  backBtn:            { alignItems: 'center', paddingVertical: 12 },
  backBtnText:        { color: '#999', fontSize: 14 },
});
