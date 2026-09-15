import { useCallback, useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useAuthStore } from '../../stores/authStore';
import { useBadgeStore } from '../../stores/badgeStore';
import { useAppResume } from '../../lib/screenRefresh';

// Slow on purpose. This is the one poll that runs whatever tab is open, so it
// is the one that must not become background chatter. Anything the customer
// does themselves refreshes the counts immediately; this only has to catch
// what the STORE does — a reply, or an order update posted to the thread.
const BADGE_POLL_MS = 60000;

export default function TabsLayout() {
  const token   = useAuthStore((s) => s.token);
  const unread  = useBadgeStore((s) => s.unread);
  const cart    = useBadgeStore((s) => s.cart);
  const refresh = useBadgeStore((s) => s.refresh);

  const refreshBadges = useCallback(() => refresh(token), [refresh, token]);

  useEffect(() => {
    refreshBadges();
    const timer = setInterval(refreshBadges, BADGE_POLL_MS);

    return () => clearInterval(timer);
  }, [refreshBadges]);

  // Timers are frozen while the app is away, so the counts would be up to a
  // minute stale at exactly the moment the customer opens the app to look.
  useAppResume(refreshBadges);

  // A count of 0 must be undefined, not 0 — React Navigation renders a literal
  // "0" bubble otherwise.
  const badge = (n) => (n > 0 ? n : undefined);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#b91c1c',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#e0e0e0',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <Ionicons name="home-outline" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Cart',
          tabBarBadge: badge(cart),
          tabBarIcon: ({ color }) => (
            <Ionicons name="cart-outline" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color }) => (
            <Ionicons name="receipt-outline" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarBadge: badge(unread),
          tabBarIcon: ({ color }) => (
            <Ionicons name="chatbubble-outline" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <Ionicons name="person-outline" size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}