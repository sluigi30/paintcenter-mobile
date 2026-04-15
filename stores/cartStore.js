import { create } from 'zustand';
import axios from 'axios';
import { API_URL } from '../constants/api';

export const useCartStore = create((set) => ({
  items:      [],
  itemCount:  0,
  total:      0,
  isLoading:  false,

  fetchCart: async () => {
    try {
      const res = await axios.get(`${API_URL}/cart`);
      set({
        items:     res.data.items,
        itemCount: res.data.item_count,
        total:     res.data.total,
      });
    } catch (err) {
      console.error('Cart fetch error:', err);
    }
  },

  addToCart: async (productId, quantity = 1) => {
    set({ isLoading: true });
    try {
      const res = await axios.post(`${API_URL}/cart/add`, { product_id: productId, quantity });
      set({
        items:     res.data.items,
        itemCount: res.data.item_count,
        total:     res.data.total,
        isLoading: false,
      });
      return { success: true };
    } catch (err) {
      set({ isLoading: false });
      return { success: false, message: err.response?.data?.message || 'Failed to add to cart.' };
    }
  },

  removeFromCart: async (productId) => {
    try {
      const res = await axios.delete(`${API_URL}/cart/${productId}`);
      set({
        items:     res.data.items,
        itemCount: res.data.item_count,
        total:     res.data.total,
      });
    } catch (err) {
      console.error('Remove from cart error:', err);
    }
  },

  clearCart: async () => {
    await axios.delete(`${API_URL}/cart`);
    set({ items: [], itemCount: 0, total: 0 });
  },
}));