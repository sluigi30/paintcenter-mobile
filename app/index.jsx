import { useEffect } from 'react';
import { router } from 'expo-router';
import { useAuthStore } from '../stores/authStore';
import { View, ActivityIndicator } from 'react-native';

export default function Index() {
  useEffect(() => {
    const timeout = setTimeout(async () => {
      await useAuthStore.getState().initialize();
      const { token } = useAuthStore.getState();

      if (token) {
        router.replace('/(tabs)');
      } else {
        router.replace('/(auth)/login');
      }
    }, 0);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
      <ActivityIndicator size="large" color="#b91c1c" />
    </View>
  );
}