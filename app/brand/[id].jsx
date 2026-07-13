import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, RefreshControl, Image
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

const API_URL = 'http://192.168.1.69:8000/api';
const PER_PAGE = 15;

export default function BrandProducts() {
  const { id, name } = useLocalSearchParams();

  const [products, setProducts]       = useState([]);
  const [categories, setCategories]   = useState([]);
  const [selectedCat, setSelectedCat] = useState(null);   // null = All
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage]               = useState(1);
  const [hasMore, setHasMore]         = useState(true);

  const isFetchingMore = useRef(false);

  const totalCount = categories.reduce((sum, c) => sum + (c.products_count || 0), 0);

  const fetchCategories = async () => {
    try {
      const res  = await fetch(`${API_URL}/brands/${id}/categories`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : []);
    } catch (e) {
      console.log('Brand categories fetch error:', e.message);
    }
  };

  const fetchProducts = async (pageNum = 1, catId = selectedCat) => {
    try {
      const catParam = catId ? `&category_id=${catId}` : '';
      const res  = await fetch(`${API_URL}/products?brand_id=${id}${catParam}&page=${pageNum}&per_page=${PER_PAGE}`);
      const data = await res.json();

      if (pageNum === 1) {
        setProducts(data.data || []);
      } else {
        setProducts(prev => [...prev, ...(data.data || [])]);
      }

      setHasMore(data.current_page < data.last_page);
      setPage(data.current_page);
    } catch (e) {
      console.log('Brand products fetch error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      isFetchingMore.current = false;
    }
  };

  useEffect(() => { fetchCategories(); fetchProducts(); }, [id]);

  const pickCategory = (catId) => {
    if (catId === selectedCat) return;
    setSelectedCat(catId);
    setLoading(true);
    setPage(1);
    setHasMore(true);
    fetchProducts(1, catId);
  };

  const onRefresh = () => {
    setRefreshing(true);
    setPage(1);
    setHasMore(true);
    fetchCategories();
    fetchProducts(1);
  };

  const loadMore = useCallback(() => {
    if (isFetchingMore.current || !hasMore || loadingMore) return;
    isFetchingMore.current = true;
    setLoadingMore(true);
    fetchProducts(page + 1);
  }, [hasMore, loadingMore, page, selectedCat]);

  const renderProduct = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/product/${item.id}`)}
    >
      {item.image ? (
        <Image
          source={{ uri: `${API_URL.replace('/api', '')}/storage/${item.image}` }}
          style={styles.thumb}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.thumb, { backgroundColor: item.hex_code || '#ccc' }]} />
      )}
      <View style={styles.info}>
        <Text style={styles.desc} numberOfLines={2}>
          {item.description}{item.color_name ? ` — ${item.color_name}` : ''}
        </Text>
        <Text style={styles.size}>
          {item.size_volume}{item.color_code ? `  ·  ${item.color_code}` : ''}
        </Text>
        <View style={styles.bottom}>
          <Text style={styles.price}>₱{parseFloat(item.price).toLocaleString()}</Text>
          <View style={[styles.dot, { backgroundColor: item.hex_code || '#ccc' }]} />
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color="#b91c1c" />
        <Text style={styles.footerText}>Loading more...</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>← Brands</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{name || 'Products'}</Text>
      </View>

      {/* Category filter chips with per-category counts */}
      {categories.length > 0 && (
        <View style={styles.chipBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <TouchableOpacity
              style={[styles.chip, selectedCat === null && styles.chipActive]}
              onPress={() => pickCategory(null)}
            >
              <Text style={[styles.chipText, selectedCat === null && styles.chipTextActive]}>
                All ({totalCount})
              </Text>
            </TouchableOpacity>
            {categories.map(cat => {
              const active = selectedCat === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => pickCategory(cat.id)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {cat.category_name} ({cat.products_count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#b91c1c" />
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderProduct}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#b91c1c" />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.empty}>No products available for this brand.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#f5f5f5' },
  center:     { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  header:     { backgroundColor: '#b91c1c', paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20 },
  back:       { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginBottom: 6 },
  title:      { fontSize: 24, fontWeight: '700', color: '#fff' },

  // Category chips
  chipBar:    { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  chipRow:    { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip:       {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
    backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e8e8e8',
  },
  chipActive: { backgroundColor: '#b91c1c', borderColor: '#b91c1c' },
  chipText:   { fontSize: 13, fontWeight: '600', color: '#666' },
  chipTextActive: { color: '#fff' },
  list:       { padding: 16, paddingBottom: 24 },
  card:       {
    backgroundColor: '#fff', borderRadius: 16, marginBottom: 14,
    flexDirection: 'row', overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  thumb:      { width: 110, height: '100%' },
  info:       { flex: 1, padding: 14, justifyContent: 'space-between' },
  desc:       { fontSize: 14, color: '#1a1a1a', fontWeight: '600', lineHeight: 20 },
  size:       { fontSize: 12, color: '#999', marginTop: 4 },
  bottom:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  price:      { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  dot:        { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#e0e0e0' },
  empty:      { color: '#999', fontSize: 15 },
  footer:     { paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  footerText: { color: '#999', fontSize: 13 },
});
