import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { API_URL, STORAGE_URL } from '../../constants/api';

// "I want THIS colour — who can mix it?"
//
// The bridge between having a colour and having a product. Two ways in:
//
//   1. The AR wall preview, where the customer has just seen the colour on
//      their own wall in their own light. This is the strongest entry point
//      the app has, and the reason the preview is more than a toy.
//   2. An empty search. A custom-colour product has no color_name for the
//      product search to match, so "sage green" finds nothing — and that
//      dead end is exactly where the offer to mix one belongs.
//
// Entered without a hex it still works as a plain "what can you mix?" list.

export default function OrderColorScreen() {
  const { hex } = useLocalSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/products?tintable=1&per_page=50`, {
      headers: { Accept: 'application/json' },
    })
      .then(res => res.json())
      .then(data => setProducts(data?.data ?? []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, []);

  const open = (product) => router.push({
    pathname: `/product/${product.id}`,
    params: hex ? { hex } : {},
  });

  return (
    <View style={styles.container}>
      {/* The root Stack sets headerShown:false for every screen, so navigation
          chrome is the screen's own job here — as it is on the product page. */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.headerBack}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mix this colour</Text>
      </View>

      {/* On grey, never full-bleed — a colour judged against a white or
          coloured surround reads as a different colour. */}
      {hex ? (
        <View style={styles.hero}>
          <View style={[styles.heroSwatch, { backgroundColor: hex }]} />
          <View>
            <Text style={styles.heroLabel}>Your colour</Text>
            <Text style={styles.heroHex}>{String(hex).toUpperCase()}</Text>
          </View>
        </View>
      ) : null}

      <Text style={styles.lead}>
        {hex
          ? 'Choose which paint to mix it in. Prices include mixing.'
          : 'These paints can be mixed to any colour you choose.'}
      </Text>

      {/* No colour in hand yet — offer to read one from the room. */}
      {!hex ? (
        <TouchableOpacity
          style={styles.suggestCta}
          onPress={() => router.push('/color/suggest')}
          activeOpacity={0.85}
        >
          <Text style={styles.suggestCtaText}>💡 Not sure? Suggest colours from my room</Text>
        </TouchableOpacity>
      ) : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 32 }} color="#b91c1c" />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No custom-mix paints are available right now. Please check back,
              or message us and we'll help.
            </Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => open(item)} activeOpacity={0.75}>
              <View style={[styles.thumb, { backgroundColor: hex || '#e5e5e5' }]}>
                {item.image && !hex ? (
                  <Image
                    source={{ uri: `${STORAGE_URL}/${item.image}` }}
                    style={styles.thumb}
                    resizeMode="cover"
                  />
                ) : null}
              </View>

              <View style={styles.cardInfo}>
                <Text style={styles.cardBrand}>{item.brand?.brand_name}</Text>
                <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.cardMeta}>
                  {item.size_volume || '—'}
                </Text>
              </View>

              <Text style={styles.cardPrice}>
                from ₱{parseFloat(item.price ?? 0).toLocaleString()}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#f5f5f5' },

  header:      { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 52, paddingBottom: 14, backgroundColor: '#fff' },
  headerBack:  { fontSize: 24, color: '#1a1a1a', fontWeight: '600' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },

  hero:        { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#8a8a8a', padding: 16 },
  heroSwatch:  { width: 64, height: 64, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.18)' },
  heroLabel:   { color: '#fff', fontSize: 12, fontWeight: '600', opacity: 0.85 },
  heroHex:     { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 1, marginTop: 2 },

  lead:        { fontSize: 13, color: '#666', lineHeight: 19, padding: 16, paddingBottom: 4 },
  suggestCta:  { marginHorizontal: 16, marginTop: 8, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#b91c1c', paddingVertical: 13, alignItems: 'center' },
  suggestCtaText: { color: '#b91c1c', fontSize: 14, fontWeight: '700' },
  list:        { padding: 16, paddingTop: 8, gap: 10 },
  empty:       { fontSize: 13, color: '#999', lineHeight: 20, textAlign: 'center', paddingHorizontal: 24, paddingVertical: 32 },

  card:        { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 12, padding: 12 },
  thumb:       { width: 54, height: 54, borderRadius: 8 },
  cardInfo:    { flex: 1 },
  cardBrand:   { fontSize: 11, color: '#b91c1c', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  cardName:    { fontSize: 14, fontWeight: '600', color: '#1a1a1a', marginTop: 2, lineHeight: 19 },
  cardMeta:    { fontSize: 12, color: '#999', marginTop: 2 },
  cardPrice:   { fontSize: 13, fontWeight: '700', color: '#1a1a1a' },
});
