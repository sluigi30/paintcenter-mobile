import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Pressable, BackHandler,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import {
  getPendingRegistration, clearPendingRegistration,
} from '../../stores/pendingRegistration';

// ─────────────────────────────────────────────────────────────
// Phone verification, between the register wizard and account creation.
//
// The wizard has already collected and validated everything; register() came
// back asking for a verified phone (otp_required). This screen sends the code,
// takes the 6 digits, and on success re-runs register() with the same payload —
// which the API now lets through. The form is held in pendingRegistration (in
// memory), never carried as a nav param, so the password never hits a URL.
// ─────────────────────────────────────────────────────────────

const CODE_LENGTH = 6;

/** "0917 ••• 233" — enough to recognise your own number, not enough to leak it. */
const maskPhone = (value) => {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  const local  = digits.startsWith('63') ? '0' + digits.slice(2) : digits;
  return local.length >= 11 ? `${local.slice(0, 4)} ••• ${local.slice(-3)}` : local;
};

export default function VerifyOtp() {
  const { sendOtp, verifyOtp, register } = useAuthStore();

  const [phone, setPhone]         = useState('');
  const [code, setCode]           = useState('');
  const [focused, setFocused]     = useState(false);
  const [error, setError]         = useState(null);
  const [cooldown, setCooldown]   = useState(0);
  const [sending, setSending]     = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [devCode, setDevCode]     = useState(null);

  const inputRef = useRef(null);
  const sentOnce = useRef(false);

  // Read the stashed form once. Reaching here without it (a deep link, a reload)
  // means there's nothing to verify against — send them back to the wizard.
  useEffect(() => {
    const pending = getPendingRegistration();
    if (!pending) {
      router.replace('/(auth)/register');
      return;
    }
    setPhone(pending.phone);

    // register() only CHECKS verification — it does not send a code. So the
    // first code is sent from here, guarded so it fires exactly once.
    if (!sentOnce.current) {
      sentOnce.current = true;
      send(pending.phone);
    }
  }, []);

  // Hardware back returns to the wizard (its fields are still filled) and drops
  // the in-flight form so a stale password can't linger in memory.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      clearPendingRegistration();
      return false;
    });
    return () => sub.remove();
  }, []);

  // Tick the resend cooldown down to zero, one second at a time.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async (to = phone) => {
    if (sending) return;
    setSending(true);
    setError(null);
    setCode('');
    const res = await sendOtp(to);
    setSending(false);
    setCooldown(res.cooldown ?? 60);
    if (res.devCode) setDevCode(res.devCode);
    // A 429 is not fatal — it still returns a cooldown to count down — but its
    // message is worth showing so the user knows why Resend is greyed out.
    if (!res.success && res.message) setError(res.message);
  };

  const onChangeCode = (value) => {
    const digits = value.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (error) setError(null);
    if (digits.length === CODE_LENGTH) verify(digits);
  };

  const verify = async (value = code) => {
    if (value.length !== CODE_LENGTH || verifying) return;
    setVerifying(true);
    setError(null);

    const check = await verifyOtp(phone, value);
    if (!check.success) {
      setVerifying(false);
      setError(check.message);
      setCode('');
      return;
    }

    // Verified — the number now passes the register() gate. Re-run it with the
    // exact same payload the wizard built.
    const reg = await register(getPendingRegistration());
    setVerifying(false);

    if (reg.success) {
      clearPendingRegistration();
      router.replace('/(tabs)');
      return;
    }

    // Rare: something else failed after verifying (e.g. the email was taken in
    // the meantime). Send them back to the wizard to fix it — its state is intact.
    Alert.alert('Please check your details', reg.message || 'Registration could not be completed.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => { clearPendingRegistration(); router.back(); }}
          hitSlop={12}
          style={styles.backLink}
        >
          <Ionicons name="chevron-back" size={19} color="#b91c1c" />
          <Text style={styles.backLinkText}>Back</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        <View style={styles.iconBadge}>
          <Ionicons name="chatbubble-ellipses-outline" size={26} color="#b91c1c" />
        </View>

        <Text style={styles.title}>Verify your number</Text>
        <Text style={styles.subtitle}>
          {sending && !code
            ? 'Sending a code…'
            : <>Enter the 6-digit code we texted to <Text style={styles.phone}>{maskPhone(phone)}</Text>.</>}
        </Text>

        {/* One transparent input drives six visible cells; tapping any cell
            focuses it. Auto-verifies the moment the sixth digit lands. */}
        <Pressable style={styles.codeRow} onPress={() => inputRef.current?.focus()}>
          {Array.from({ length: CODE_LENGTH }).map((_, i) => {
            const filled = i < code.length;
            const active = focused && i === code.length;
            return (
              <View
                key={i}
                style={[
                  styles.codeCell,
                  filled && styles.codeCellFilled,
                  active && styles.codeCellActive,
                  error && styles.codeCellError,
                ]}
              >
                <Text style={styles.codeDigit}>{code[i] ?? ''}</Text>
              </View>
            );
          })}

          <TextInput
            ref={inputRef}
            style={styles.hiddenInput}
            value={code}
            onChangeText={onChangeCode}
            keyboardType="number-pad"
            maxLength={CODE_LENGTH}
            autoFocus
            caretHidden
            editable={!verifying}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
          />
        </Pressable>

        {error ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle" size={13} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : devCode ? (
          <Text style={styles.devHint}>Dev code: {devCode}</Text>
        ) : null}

        <TouchableOpacity
          style={[styles.button, (code.length !== CODE_LENGTH || verifying) && styles.buttonDisabled]}
          onPress={() => verify()}
          disabled={code.length !== CODE_LENGTH || verifying}
        >
          {verifying
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Verify & Create Account</Text>}
        </TouchableOpacity>

        <View style={styles.resendRow}>
          {cooldown > 0 ? (
            <Text style={styles.resendMuted}>Resend code in {cooldown}s</Text>
          ) : (
            <TouchableOpacity onPress={() => send()} disabled={sending} hitSlop={8}>
              <Text style={styles.resendLink}>
                {sending ? 'Sending…' : "Didn't get it? Resend code"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  header:       { paddingTop: 54, paddingHorizontal: 24, paddingBottom: 4 },
  backLink:     { flexDirection: 'row', alignItems: 'center', minWidth: 62 },
  backLinkText: { color: '#b91c1c', fontSize: 15, fontWeight: '600' },

  body: { flex: 1, paddingHorizontal: 24, paddingTop: 20, alignItems: 'center' },

  iconBadge: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: '#fef2f2',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },

  title:    { fontSize: 25, fontWeight: '700', color: '#1a1a1a', textAlign: 'center' },
  subtitle: { fontSize: 14.5, color: '#777', marginTop: 8, marginBottom: 30, lineHeight: 21, textAlign: 'center' },
  phone:    { color: '#1a1a1a', fontWeight: '700' },

  codeRow: { flexDirection: 'row', justifyContent: 'center', gap: 9, position: 'relative' },
  codeCell: {
    width: 46, height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e5e5',
    backgroundColor: '#fafafa', alignItems: 'center', justifyContent: 'center',
  },
  codeCellFilled: { borderColor: '#b91c1c', backgroundColor: '#fff' },
  codeCellActive: { borderColor: '#b91c1c', backgroundColor: '#fff' },
  codeCellError:  { borderColor: '#dc2626', backgroundColor: '#fef2f2' },
  codeDigit:      { fontSize: 22, fontWeight: '700', color: '#1a1a1a' },

  // Full-width transparent overlay so a tap anywhere on the row focuses input.
  hiddenInput: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    opacity: 0, color: 'transparent',
  },

  errorRow:  { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 16 },
  errorText: { color: '#dc2626', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  devHint:   { color: '#9ca3af', fontSize: 12.5, marginTop: 16 },

  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#b91c1c', borderRadius: 14, paddingVertical: 16,
    marginTop: 30, marginBottom: 18, alignSelf: 'stretch',
  },
  buttonDisabled: { backgroundColor: '#e0aeae' },
  buttonText:     { color: '#fff', fontSize: 16, fontWeight: '700' },

  resendRow:   { alignItems: 'center' },
  resendMuted: { color: '#9ca3af', fontSize: 14 },
  resendLink:  { color: '#b91c1c', fontSize: 14, fontWeight: '600' },
});
