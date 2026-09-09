import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_URL } from '../constants/api';

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
        // Pass Laravel's per-field 422 errors through untouched — the register
        // wizard uses them to jump back to the step holding the bad field
        // (a taken email is only discoverable here, on the last step).
        // `otp_required` is a separate signal: the phone must be verified first,
        // so the wizard diverts to the OTP screen rather than showing an error.
        return {
          success:      false,
          otp_required: json.otp_required ?? false,
          message:      json.message || 'Registration failed.',
          errors:       json.errors ?? null,
        };
      }
    } catch (e) {
      set({ isLoading: false });
      return { success: false, message: e.message };
    }
  },

  // Ask the API to text a verification code to a phone. Returns the cooldown so
  // the OTP screen can disable Resend for that long. A 429 (too soon) is not an
  // error the user must fix — it still carries a cooldown to count down.
  sendOtp: async (phone) => {
    try {
      const res = await fetch(`${API_URL}/auth/send-otp`, {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'Accept':           'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        return { success: true, cooldown: data.cooldown ?? 60, devCode: data.dev_code ?? null };
      }
      if (res.status === 429) {
        return { success: false, cooldown: data.cooldown ?? 60, message: data.message };
      }
      return {
        success: false,
        message: data.message || data.errors?.phone?.[0] || 'Could not send the code.',
      };
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  // Confirm a code for a phone. On success the number is verified server-side
  // for a short window, which the subsequent register() call relies on.
  verifyOtp: async (phone, code) => {
    try {
      const res = await fetch(`${API_URL}/auth/verify-otp`, {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'Accept':           'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) return { success: true };
      return {
        success: false,
        message: data.errors?.code?.[0] || data.message || 'That code did not work.',
      };
    } catch (e) {
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