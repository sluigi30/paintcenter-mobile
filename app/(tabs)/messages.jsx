import { useState, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import { useAuthStore } from '../../stores/authStore';

const API_URL = 'http://192.168.1.69:8000/api';

export default function Messages() {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [adminId, setAdminId] = useState(null);
  const { token, user } = useAuthStore();
  const flatListRef = useRef(null);

  const getAdmin = async () => {
    try {
      const res  = await fetch(`${API_URL}/messages/admin`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setAdminId(data.id);
      return data.id;
    } catch (e) {
      console.log('Admin error:', e.message);
    }
  };

  const fetchMessages = async (aId) => {
    try {
      const res  = await fetch(`${API_URL}/messages/thread/${aId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setMessages(data);
    } catch (e) {
      console.log('Messages error:', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      const aId = await getAdmin();
      if (aId) fetchMessages(aId);
    };
    init();

    const interval = setInterval(() => {
      if (adminId) fetchMessages(adminId);
    }, 5000);
    return () => clearInterval(interval);
  }, [adminId]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !adminId) return;
    const content = newMessage.trim();
    setNewMessage('');
    try {
      await fetch(`${API_URL}/messages/send`, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ receiver_id: adminId, content }),
      });
      fetchMessages(adminId);
    } catch (e) {
      console.log('Send error:', e.message);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#f97316" /></View>;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.subtitle}>Chat with NCM Paint Center</Text>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const isMe = item.sender_id === user?.id;
          return (
            <View style={[styles.bubbleRow, isMe ? styles.myRow : styles.theirRow]}>
              <View style={[styles.bubble, isMe ? styles.myBubble : styles.theirBubble]}>
                <Text style={[styles.bubbleText, isMe ? styles.myText : styles.theirText]}>
                  {item.content}
                </Text>
                <Text style={[styles.time, isMe ? styles.myTime : styles.theirTime]}>
                  {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>💬</Text>
            <Text style={styles.emptyText}>No messages yet. Say hi!</Text>
          </View>
        }
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          placeholderTextColor="#999"
          value={newMessage}
          onChangeText={setNewMessage}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
          multiline
        />
        <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#f5f5f5' },
  center:         { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header:         { backgroundColor: '#f97316', paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20 },
  title:          { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle:       { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  list:           { padding: 16, flexGrow: 1 },
  bubbleRow:      { marginBottom: 8, flexDirection: 'row' },
  myRow:          { justifyContent: 'flex-end' },
  theirRow:       { justifyContent: 'flex-start' },
  bubble:         { maxWidth: '75%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  myBubble:       { backgroundColor: '#f97316', borderBottomRightRadius: 4 },
  theirBubble:    { backgroundColor: '#fff', borderBottomLeftRadius: 4, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  bubbleText:     { fontSize: 15, lineHeight: 20 },
  myText:         { color: '#fff' },
  theirText:      { color: '#1a1a1a' },
  time:           { fontSize: 10, marginTop: 4 },
  myTime:         { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
  theirTime:      { color: '#999' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyIcon:      { fontSize: 48, marginBottom: 12 },
  emptyText:      { fontSize: 15, color: '#999' },
  inputRow:       { flexDirection: 'row', padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e0e0e0', alignItems: 'flex-end' },
  input:          { flex: 1, backgroundColor: '#f5f5f5', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 100, color: '#1a1a1a' },
  sendBtn:        { marginLeft: 8, backgroundColor: '#f97316', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  sendText:       { color: '#fff', fontWeight: '700', fontSize: 14 },
});