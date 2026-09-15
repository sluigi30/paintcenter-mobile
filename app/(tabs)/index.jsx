import { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, Image
} from 'react-native';
import { router } from 'expo-router';
import { useFocusRefresh } from '../../lib/screenRefresh';

import { API_URL } from '../../constants/api';
const PER_PAGE = 15;

// Decoration on the custom-mix card, not a palette to pick from — kept muted
// and unlabelled so the card does not read as four buyable shades.
const MIX_SWATCHES = ['#7ea86b', '#e0b04a', '#c96a5c', '#5b7fa6'];

export default function Home() {
  // Brand grid (the catalog landing)
  const [brands, setBrands]           = useState([]);

  // Whether the shop has a custom-mix product set up at all (CUSTOM_COLOR.md).
  // The admin creates one by ticking a checkbox, and may not have — offering to
  // mix a colour that lands on "none available" is worse than not offering.
  const [canMix, setCanMix]           = useState(false);

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

  // Mirrors `page` for the focus refresh below, which must not take page as a
  // dependency — that would re-run it every time another page is loaded.
  const pageRef   = useRef(1);
  const searchRef = useRef('');

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

  // One row is enough; this asks "does the service exist", not "what is in it".
  const fetchMixable = async () => {
    try {
      const res  = await fetch(`${API_URL}/products?tintable=1&per_page=1`, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      setCanMix((data?.data?.length ?? 0) > 0);
    } catch (e) {
      // A failed check hides the card rather than showing a dead one.
      setCanMix(false);
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
      pageRef.current = data.current_page;
    } catch (e) {
      console.log('Search fetch error:', e.message);
    } finally {
      setSearching(false);
      setLoadingMore(false);
      isFetchingMore.current = false;
    }
  };

  // Refresh on focus and on resume rather than only on mount: coming back from
  // a product page should not show prices and stock badges from an hour ago.
  //
  // Search results are left alone once the customer has paged into them —
  // refetching page 1 would throw away everything below it and put them back at
  // the top, which is worse than slightly stale badges. The brand grid has no
  // pagination, so it always refreshes.
  useFocusRefresh(useCallback(() => {
    const term = searchRef.current.trim();

    if (!term) {
      fetchBrands();
      fetchMixable();
    } else if (pageRef.current <= 1) {
      fetchProducts(term, 1);
    }
  }, []));

  // Debounced global search — matches product name, color code, or color name
  const onSearch = (t) => {
    setSearch(t);
    searchRef.current = t;
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
        <View style={[styles.thumb, { backgroundColor: item.colors?.[0]?.hex_code || '#ccc' }]} />
      )}
      <View style={styles.info}>
        <Text style={styles.brand}>{item.brand?.brand_name}</Text>
        <Text style={styles.desc} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.size}>
          {item.size_volume}
          {item.colors?.length === 1 && item.colors[0].color_code
            ? `  ·  ${item.colors[0].color_code}`
            : item.colors?.length > 1
              ? `  ·  ${item.colors.length} colors`
              : ''}
        </Text>
        <View style={styles.bottom}>
          <Text style={styles.price}>₱{parseFloat(item.price).toLocaleString()}</Text>
          {/* A line's shades are one card now, so the card shows a few of them
              rather than the single swatch each colour used to get. */}
          <View style={styles.dotRow}>
            {(item.colors ?? []).slice(0, 4).map((c) => (
              <View key={c.key} style={[styles.dot, { backgroundColor: c.hex_code || '#ddd' }]} />
            ))}
            {item.colors?.length > 4 && (
              <Text style={styles.dotMore}>+{item.colors.length - 4}</Text>
            )}
          </View>
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
                {/* A custom-mix product has no color_name for the search above
                    to match on, so a colour search can only ever land here.
                    This dead end is exactly where the offer to mix one belongs. */}
                {canMix ? (
                  <>
                    <TouchableOpacity
                      style={styles.mixOwnBtn}
                      onPress={() => router.push('/color/order')}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.mixOwnText}>Mix your own colour →</Text>
                    </TouchableOpacity>
                    <Text style={styles.mixOwnHint}>
                      Can't find the shade you want? We can mix it in store.
                    </Text>
                  </>
                ) : null}
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
          ListHeaderComponent={
            <>
              {/* The custom-mix product cannot be found by searching — it has no
                  colour name to match — so without a front door it is reachable
                  only from the AR preview or an empty result. This is the door.
                  A tab was considered and rejected: mixing a colour is a task
                  done once per project, and tab slots belong to places you
                  return to. */}
              {canMix ? (
                <TouchableOpacity
                  style={styles.mixCard}
                  onPress={() => router.push('/color/order')}
                  activeOpacity={0.85}
                >
                  <View style={styles.mixDots}>
                    {MIX_SWATCHES.map((hex) => (
                      <View key={hex} style={[styles.mixDot, { backgroundColor: hex }]} />
                    ))}
                  </View>

                  <View style={styles.mixCopy}>
                    <Text style={styles.mixTitle}>Mix your own colour</Text>
                    <Text style={styles.mixSub}>Any shade you like, mixed in store</Text>
                  </View>

                  <Text style={styles.mixChevron}>›</Text>
                </TouchableOpacity>
              ) : null}

              <Text style={styles.sectionTitle}>Our Brands</Text>
            </>
          }
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
  dotRow:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot:        { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#e0e0e0' },
  dotMore:    { fontSize: 11, fontWeight: '700', color: '#999', marginLeft: 2 },
  empty:      { color: '#999', fontSize: 15 },
  mixOwnBtn:  { backgroundColor: '#b91c1c', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22, marginTop: 18 },
  mixOwnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  mixOwnHint: { color: '#999', fontSize: 12.5, marginTop: 10, textAlign: 'center', lineHeight: 18 },

  // "Mix your own colour" — the custom-mix front door
  mixCard:    {
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 18,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  // Grey tile, not white: a swatch judged against a white surround reads as a
  // different colour (CUSTOM_COLOR.md, "Screen colour is approximate").
  mixDots:    {
    width: 46, height: 46, borderRadius: 12, backgroundColor: '#eee',
    flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center',
    justifyContent: 'center', gap: 3, padding: 5,
  },
  mixDot:     { width: 15, height: 15, borderRadius: 8 },
  mixCopy:    { flex: 1 },
  mixTitle:   { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  mixSub:     { fontSize: 12.5, color: '#999', marginTop: 3 },
  mixChevron: { fontSize: 26, color: '#ccc', fontWeight: '300' },
  footer:     { paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  footerText: { color: '#999', fontSize: 13 },
});
