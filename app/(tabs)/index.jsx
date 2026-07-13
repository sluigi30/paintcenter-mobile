import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, Image
} from 'react-native';
import { router } from 'expo-router';

const API_URL = 'http://192.168.1.69:8000/api';
const PER_PAGE = 15;

export default function Home() {
  // Brand grid (the catalog landing)
  const [brands, setBrands]           = useState([]);

  // Global search results (shown INSTEAD of the grid while typing)
  const [products, setProducts]       = useState([]);
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [searching, setSearching]     = useState(false);
  const [refreshing, setRefreshing]   = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage]               = useState(1);
  const [hasMore, setHasMore]         = useState(true);

  const isFetchingMore = useRef(false);
  const debounceTimer  = useRef(null);

  const isSearchMode = search.trim().length > 0;

  const fetchBrands = async () => {
    try {
      const res  = await fetch(`${API_URL}/brands`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      setBrands(Array.isArray(data) ? data : []);
    } catch (e) {
      console.log('Brands fetch error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchProducts = async (q, pageNum = 1) => {
    try {
      const url = `${API_URL}/products?page=${pageNum}&per_page=${PER_PAGE}&search=${encodeURIComponent(q)}`;
      const res  = await fetch(url);
      const data = await res.json();

      if (pageNum === 1) {
        setProducts(data.data || []);
      } else {
        setProducts(prev => [...prev, ...(data.data || [])]);
      }

      setHasMore(data.current_page < data.last_page);
      setPage(data.current_page);
    } catch (e) {
      console.log('Search fetch error:', e.message);
    } finally {
      setSearching(false);
      setLoadingMore(false);
      isFetchingMore.current = false;
    }
  };

  useEffect(() => { fetchBrands(); }, []);

  // Debounced global search — matches product name, color code, or color name
  const onSearch = (t) => {
    setSearch(t);
    clearTimeout(debounceTimer.current);

    if (!t.trim()) {
      setProducts([]);
      return;
    }

    setSearching(true);
    setPage(1);
    setHasMore(true);
    debounceTimer.current = setTimeout(() => fetchProducts(t.trim(), 1), 350);
  };

  const onRefresh = () => {
    setRefreshing(true);
    isSearchMode ? fetchProducts(search.trim(), 1).then(() => setRefreshing(false)) : fetchBrands();
  };

  const loadMore = useCallback(() => {
    if (!isSearchMode || isFetchingMore.current || !hasMore || loadingMore) return;
    isFetchingMore.current = true;
    setLoadingMore(true);
    fetchProducts(search.trim(), page + 1);
  }, [isSearchMode, hasMore, loadingMore, page, search]);

  const renderBrand = ({ item }) => (
    <TouchableOpacity
      style={styles.brandCard}
      onPress={() => router.push({ pathname: `/brand/${item.id}`, params: { name: item.brand_name } })}
    >
      {item.image ? (
        <Image
          source={{ uri: `${API_URL.replace('/api', '')}/storage/${item.image}` }}
          style={styles.brandLogo}
          resizeMode="contain"
        />
      ) : (
        <View style={styles.brandLetterTile}>
          <Text style={styles.brandLetter}>{(item.brand_name || '?').charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <Text style={styles.brandName} numberOfLines={1}>{item.brand_name}</Text>
      <Text style={styles.brandCount}>
        {item.products_count} {item.products_count === 1 ? 'product' : 'products'}
      </Text>
    </TouchableOpacity>
  );

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
        <Text style={styles.brand}>{item.brand?.brand_name}</Text>
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#b91c1c" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>NCM Paint Center</Text>
        <Text style={styles.subtitle}>Shop by brand, or search everything</Text>
      </View>

      <TextInput
        style={styles.search}
        placeholder="Search paints, color codes, colors..."
        placeholderTextColor="#999"
        value={search}
        onChangeText={onSearch}
      />

      {isSearchMode ? (
        searching ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#b91c1c" />
          </View>
        ) : (
          <FlatList
            data={products}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderProduct}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            ListFooterComponent={renderFooter}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.empty}>No products match "{search.trim()}".</Text>
              </View>
            }
          />
        )
      ) : (
        <FlatList
          data={brands}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderBrand}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#b91c1c" />
          }
          ListHeaderComponent={<Text style={styles.sectionTitle}>Our Brands</Text>}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.empty}>No brands available yet.</Text>
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
  header:     { backgroundColor: '#b91c1c', paddingTop: 60, paddingBottom: 24, paddingHorizontal: 20 },
  title:      { fontSize: 26, fontWeight: '700', color: '#fff' },
  subtitle:   { fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  search:     {
    margin: 16, backgroundColor: '#fff', borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 13, fontSize: 15,
    borderWidth: 1, borderColor: '#e8e8e8',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  list:       { paddingHorizontal: 16, paddingBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },

  // Brand grid
  gridRow:    { gap: 12, marginBottom: 12 },
  brandCard:  {
    flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 16,
    alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  brandLogo:  { width: 72, height: 72, borderRadius: 12, marginBottom: 10 },
  brandLetterTile: {
    width: 72, height: 72, borderRadius: 12, marginBottom: 10,
    backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#fecaca',
  },
  brandLetter: { fontSize: 30, fontWeight: '800', color: '#b91c1c' },
  brandName:  { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  brandCount: { fontSize: 12, color: '#999', marginTop: 2 },

  // Product result cards (search mode)
  card:       {
    backgroundColor: '#fff', borderRadius: 16, marginBottom: 14,
    flexDirection: 'row', overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  thumb:      { width: 110, height: '100%' },
  info:       { flex: 1, padding: 14, justifyContent: 'space-between' },
  brand:      { fontSize: 11, color: '#b91c1c', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  desc:       { fontSize: 14, color: '#1a1a1a', fontWeight: '600', marginTop: 4, lineHeight: 20 },
  size:       { fontSize: 12, color: '#999', marginTop: 4 },
  bottom:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  price:      { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  dot:        { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#e0e0e0' },
  empty:      { color: '#999', fontSize: 15 },
  footer:     { paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  footerText: { color: '#999', fontSize: 13 },
});
