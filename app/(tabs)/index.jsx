import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, Image
} from 'react-native';
import { router } from 'expo-router';

const API_URL = 'http://192.168.1.69:8000/api';
const PER_PAGE = 15;

export default function Home() {
  const [products, setProducts]       = useState([]);
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage]               = useState(1);
  const [hasMore, setHasMore]         = useState(true);

  const isFetchingMore = useRef(false);

  const fetchProducts = async (q = '', pageNum = 1) => {
    try {
      const url = `${API_URL}/products?page=${pageNum}&per_page=${PER_PAGE}${q ? `&search=${encodeURIComponent(q)}` : ''}`;
      console.log('Fetching:', url);
      const res  = await fetch(url);
      const data = await res.json();
      console.log(`Got products: ${data.data?.length} (page ${pageNum} of ${data.last_page})`);

      if (pageNum === 1) {
        setProducts(data.data || []);
      } else {
        setProducts(prev => [...prev, ...(data.data || [])]);
      }

      setHasMore(data.current_page < data.last_page);
      setPage(data.current_page);
    } catch (e) {
      console.log('Fetch error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      isFetchingMore.current = false;
    }
  };

  useEffect(() => { fetchProducts(); }, []);

  const onRefresh = () => {
    setRefreshing(true);
    setPage(1);
    setHasMore(true);
    fetchProducts(search, 1);
  };
  const onSearch = (t) => {
    setSearch(t);
    setPage(1);
    setHasMore(true);
    setLoading(true);
    fetchProducts(t, 1);
  };

  const loadMore = useCallback(() => {
    if (isFetchingMore.current || !hasMore || loadingMore) return;
    isFetchingMore.current = true;
    setLoadingMore(true);
    fetchProducts(search, page + 1);
  }, [hasMore, loadingMore, page, search]);

const renderProduct = ({ item }) => (
  <TouchableOpacity
    style={styles.card}
    onPress={() => router.push(`/product/${item.id}`)}
  >
    {item.image ? (
      <Image
        source={{ uri: `http://192.168.1.69:8000/storage/${item.image}` }}
        style={styles.thumb}
        resizeMode="cover"
      />
    ) : (
      <View style={[styles.thumb, { backgroundColor: item.hex_code || '#ccc' }]} />
    )}
    <View style={styles.info}>
      <Text style={styles.brand}>{item.brand?.brand_name}</Text>
      <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
      <Text style={styles.size}>{item.size_volume}</Text>
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
        <ActivityIndicator size="small" color="#f97316" />
        <Text style={styles.footerText}>Loading more...</Text>
      </View>
    );
  };
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>NCM Paint Center</Text>
        <Text style={styles.subtitle}>Find your perfect paint</Text>
      </View>

      <TextInput
        style={styles.search}
        placeholder="Search paints..."
        placeholderTextColor="#999"
        value={search}
        onChangeText={(t) => { setSearch(t); fetchProducts(t); }}
      />

      <FlatList
        data={products}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderProduct}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f97316" />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.empty}>No products found.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#f5f5f5' },
  center:     { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  header:     { backgroundColor: '#f97316', paddingTop: 60, paddingBottom: 24, paddingHorizontal: 20 },
  title:      { fontSize: 26, fontWeight: '700', color: '#fff' },
  subtitle:   { fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  search:     {
    margin: 16, backgroundColor: '#fff', borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 13, fontSize: 15,
    borderWidth: 1, borderColor: '#e8e8e8',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  list:       { paddingHorizontal: 16, paddingBottom: 24 },
  card:       {
    backgroundColor: '#fff', borderRadius: 16, marginBottom: 14,
    flexDirection: 'row', overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  thumb:      { width: 110, height: '100%' },
  info:       { flex: 1, padding: 14, justifyContent: 'space-between' },
  brand:      { fontSize: 11, color: '#f97316', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  desc:       { fontSize: 14, color: '#1a1a1a', fontWeight: '600', marginTop: 4, lineHeight: 20 },
  size:       { fontSize: 12, color: '#999', marginTop: 4 },
  bottom:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  price:      { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  dot:        { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#e0e0e0' },
  empty:      { color: '#999', fontSize: 15 },
  footer:     { paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  footerText: { color: '#999', fontSize: 13 },
});