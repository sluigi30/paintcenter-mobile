import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useAuthStore } from '../stores/authStore';

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    initialize();
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="product/[id]" />
      <Stack.Screen name="checkout" />
      <Stack.Screen name="order-success" />
      <Stack.Screen name="ar/preview" />
      <Stack.Screen name="ar/estimator" />
    </Stack>
  );
}