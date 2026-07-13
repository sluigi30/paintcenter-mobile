import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, ScrollView
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';

export default function Register() {
  const [form, setForm]      = useState({
    first_name: '', last_name: '', email: '',
    phone: '', address: '', password: '', password_confirmation: '',
  });
  const { register, isLoading } = useAuthStore();

  const update = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleRegister = async () => {
    if (!form.first_name || !form.last_name || !form.email || !form.password) {
      Alert.alert('Error', 'Please fill in all required fields.');
      return;
    }
    if (form.password !== form.password_confirmation) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }
    const result = await register(form);
    if (result.success) {
      router.replace('/(tabs)');
    } else {
      Alert.alert('Registration Failed', result.message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner}>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Join NCM Paint Center</Text>

        {[
          { key: 'first_name',           label: 'First Name *' },
          { key: 'last_name',            label: 'Last Name *' },
          { key: 'email',                label: 'Email *', keyboard: 'email-address' },
          { key: 'phone',                label: 'Phone', keyboard: 'phone-pad' },
          { key: 'address',              label: 'Address' },
          { key: 'password',             label: 'Password *', secure: true },
          { key: 'password_confirmation', label: 'Confirm Password *', secure: true },
        ].map(({ key, label, keyboard, secure }) => (
          <TextInput
            key={key}
            style={styles.input}
            placeholder={label}
            placeholderTextColor="#999"
            value={form[key]}
            onChangeText={v => update(key, v)}
            keyboardType={keyboard || 'default'}
            secureTextEntry={secure}
            autoCapitalize="none"
          />
        ))}

        <TouchableOpacity
          style={styles.button}
          onPress={handleRegister}
          disabled={isLoading}
        >
          {isLoading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Create Account</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.link}>Already have an account? <Text style={styles.linkBold}>Sign In</Text></Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#fff' },
  inner:      { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  title:      { fontSize: 28, fontWeight: '700', textAlign: 'center', color: '#1a1a1a', marginBottom: 4 },
  subtitle:   { fontSize: 15, textAlign: 'center', color: '#666', marginBottom: 28 },
  input:      {
    borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 15,
    marginBottom: 14, backgroundColor: '#fafafa', color: '#1a1a1a',
  },
  button:     {
    backgroundColor: '#b91c1c', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 8, marginBottom: 20,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link:       { textAlign: 'center', color: '#666', fontSize: 14 },
  linkBold:   { color: '#b91c1c', fontWeight: '600' },
});