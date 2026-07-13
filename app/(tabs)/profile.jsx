import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';

export default function Profile() {
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.name}>{user?.first_name} {user?.last_name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.role}>{user?.role}</Text>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#f5f5f5' },
  header:      { backgroundColor: '#b91c1c', paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20 },
  title:       { fontSize: 24, fontWeight: '700', color: '#fff' },
  card:        { backgroundColor: '#fff', margin: 16, borderRadius: 16, padding: 20, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 3 },
  name:        { fontSize: 22, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  email:       { fontSize: 15, color: '#666', marginBottom: 4 },
  role:        { fontSize: 13, color: '#b91c1c', fontWeight: '600', textTransform: 'capitalize' },
  logoutBtn:   { margin: 16, backgroundColor: '#ef4444', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  logoutText:  { color: '#fff', fontSize: 16, fontWeight: '700' },
});