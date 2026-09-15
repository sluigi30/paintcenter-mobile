import { create } from 'zustand';

import { API_URL } from '../constants/api';

/**
 * The numbers on the tab bar: unread messages and cart quantity.
 *
 * Kept in a store rather than in the tabs layout because two different things
 * drive it. The layout polls it on a slow timer, but a screen that has just
 * CHANGED one of the counts — added to the cart, opened the message thread —
 * calls refresh() itself, so the badge reacts immediately instead of sitting
 * wrong until the next tick.
 *
 * Failures are swallowed on purpose. A badge is an ornament; it must never
 * produce an error dialog or block a screen, and the next poll fixes it.
 */
export const useBadgeStore = create((set) => ({
  unread: 0,
  cart:   0,

  refresh: async (token) => {
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/badges`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      });

      if (!res.ok) return;

      const data = await res.json();

      set({
        unread: Number(data.unread_messages) || 0,
        cart:   Number(data.cart_items) || 0,
      });
    } catch (e) {
      console.log('Badge fetch error:', e.message);
    }
  },

  /**
   * Push a count the caller already has, with no round trip.
   *
   * Most of the app knows the answer without asking: every cart endpoint
   * replies with `item_count`, and fetching the message thread marks it read
   * server-side, so the unread count is 0 by the time that call returns.
   */
  setCart:   (n) => set({ cart: Number(n) || 0 }),
  setUnread: (n) => set({ unread: Number(n) || 0 }),

  /** Clear on sign-out so the next account never inherits these numbers. */
  reset: () => set({ unread: 0, cart: 0 }),
}));
