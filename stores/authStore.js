import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = 'http://192.168.1.69:8000/api';

export const useAuthStore = create((set) => ({
  user:      null,
  token:     null,
  isLoading: false,

  initialize: async () => {
    const token = await AsyncStorage.getItem('token');
    const user  = await AsyncStorage.getItem('user');
    if (token && user) {
      set({ token, user: JSON.parse(user) });
    }
  },

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'Accept':           'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email, password }),
      });
      const text = await res.text();
      console.log('Login status:', res.status);
      const data = JSON.parse(text);
      if (res.ok) {
        await AsyncStorage.setItem('token', data.token);
        await AsyncStorage.setItem('user', JSON.stringify(data.user));
        set({ user: data.user, token: data.token, isLoading: false });
        return { success: true };
      } else {
        set({ isLoading: false });
        return { success: false, message: data.message || 'Login failed.' };
      }
    } catch (e) {
      set({ isLoading: false });
      return { success: false, message: e.message };
    }
  },

  register: async (data) => {
    set({ isLoading: true });
    try {
      const res = await fetch(`${API_URL}/auth/register`, {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'Accept':           'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(data),
      });
      const text = await res.text();
      console.log('Register status:', res.status);
      const json = JSON.parse(text);
      if (res.ok) {
        await AsyncStorage.setItem('token', json.token);
        await AsyncStorage.setItem('user', JSON.stringify(json.user));
        set({ user: json.user, token: json.token, isLoading: false });
        return { success: true };
      } else {
        set({ isLoading: false });
        return { success: false, message: json.message || 'Registration failed.' };
      }
    } catch (e) {
      set({ isLoading: false });
      return { success: false, message: e.message };
    }
  },

  logout: async () => {
    const token = useAuthStore.getState().token;
    await fetch(`${API_URL}/auth/logout`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/json',
      },
    }).catch(() => {});
    await AsyncStorage.removeItem('token');
    await AsyncStorage.removeItem('user');
    set({ user: null, token: null });
  },
}));