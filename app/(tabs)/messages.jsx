import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';
import { useBadgeStore } from '../../stores/badgeStore';
import { useResumeWhileFocused } from '../../lib/screenRefresh';

import { API_URL } from '../../constants/api';

// How often the open thread re-reads itself. Only ever runs while the tab is
// on screen — see the useFocusEffect below.
const MESSAGE_POLL_MS = 5000;

// Bubbles carry the date as well as the time — order updates land here and get
// referred to by when they were placed, so "Aug 13" has to be readable in the
// thread itself. Matches the admin panel's stamp format.
const formatStamp = (value) => {
  const d = new Date(value);
  if (isNaN(d)) return '';
  return d.toLocaleString([], {
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
};

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
      // Fetching the thread marks it read server-side, so the badge is stale
      // the instant this returns. No round trip needed to know it is zero.
      useBadgeStore.getState().setUnread(0);
    } catch (e) {
      console.log('Messages error:', e.message);
    } finally {
      setLoading(false);
    }
  };

  // Which admin account this customer is talking to. Looked up once — it does
  // not change while the app is open. Setting it re-runs the poll below, which
  // is what fetches the thread for the first time.
  useEffect(() => {
    getAdmin();
  }, []);

  // Poll ONLY while the tab is actually on screen, the same way the Orders tab
  // does it. A plain useEffect cleans up when the screen is DESTROYED, and tab
  // screens are kept mounted so switching back is instant — so the timer never
  // stopped, and the thread was re-fetched every 5s while the customer was
  // browsing paint, filling the cart, checking out.
  useFocusEffect(useCallback(() => {
    if (!adminId) return;

    fetchMessages(adminId);
    const timer = setInterval(() => fetchMessages(adminId), MESSAGE_POLL_MS);

    return () => clearInterval(timer);
  }, [adminId, token]));

  // Same frozen-timer gap: a reply that arrived while the app was away should
  // be there on the way back in, not five seconds later.
  useResumeWhileFocused(useCallback(() => {
    if (adminId) fetchMessages(adminId);
  }, [adminId, token]));

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
    return <View style={styles.center}><ActivityIndicator size="large" color="#b91c1c" /></View>;
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
                  {formatStamp(item.created_at)}
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
  header:         { backgroundColor: '#b91c1c', paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20 },
  title:          { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle:       { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  list:           { padding: 16, flexGrow: 1 },
  bubbleRow:      { marginBottom: 8, flexDirection: 'row' },
  myRow:          { justifyContent: 'flex-end' },
  theirRow:       { justifyContent: 'flex-start' },
  bubble:         { maxWidth: '75%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  myBubble:       { backgroundColor: '#b91c1c', borderBottomRightRadius: 4 },
  theirBubble:    { backgroundColor: '#fff', borderBottomLeftRadius: 4, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  bubbleText:     { fontSize: 15, lineHeight: 20 },
  myText:         { color: '#fff' },
  theirText:      { color: '#1a1a1a' },
  time:           { fontSize: 10, marginTop: 4, textAlign: 'right' },
  myTime:         { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
  theirTime:      { color: '#999' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyIcon:      { fontSize: 48, marginBottom: 12 },
  emptyText:      { fontSize: 15, color: '#999' },
  inputRow:       { flexDirection: 'row', padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e0e0e0', alignItems: 'flex-end' },
  input:          { flex: 1, backgroundColor: '#f5f5f5', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 100, color: '#1a1a1a' },
  sendBtn:        { marginLeft: 8, backgroundColor: '#b91c1c', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  sendText:       { color: '#fff', fontWeight: '700', fontSize: 14 },
});