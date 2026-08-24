import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, BackHandler,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';

// ─────────────────────────────────────────────────────────────
// Registration is a short wizard, not one long form.
//
// Seven inputs on a single screen reads as a wall of work and people abandon
// it; one field per screen is the opposite mistake — it turns a 2-minute job
// into eight taps of Next. So the fields are GROUPED: three steps of two to
// three related fields each, each step answering one question.
// ─────────────────────────────────────────────────────────────

const FIELDS = {
  first_name: {
    label: 'First Name', placeholder: 'e.g. Juan', required: true,
    autoCapitalize: 'words', autoComplete: 'given-name',
  },
  last_name: {
    label: 'Last Name', placeholder: 'e.g. Dela Cruz', required: true,
    autoCapitalize: 'words', autoComplete: 'family-name',
  },
  email: {
    label: 'Email', placeholder: 'you@example.com', required: true,
    keyboardType: 'email-address', autoCapitalize: 'none', autoComplete: 'email',
    hint: 'You sign in with this.',
  },
  phone: {
    label: 'Mobile Number', placeholder: '09171234567', required: true,
    keyboardType: 'phone-pad', autoCapitalize: 'none', autoComplete: 'tel',
    hint: 'We text you when your order is confirmed and on its way.',
  },
  address: {
    label: 'Address', placeholder: 'House/street, barangay, city', required: false,
    autoCapitalize: 'sentences', autoComplete: 'street-address', multiline: true,
    hint: "Optional — we'll ask at checkout if you choose delivery.",
  },
  password: {
    label: 'Password', placeholder: 'At least 8 characters', required: true,
    secure: true, autoCapitalize: 'none', autoComplete: 'password-new',
  },
  password_confirmation: {
    label: 'Confirm Password', placeholder: 'Re-type your password', required: true,
    secure: true, autoCapitalize: 'none', autoComplete: 'password-new',
  },
};

const STEPS = [
  {
    title:  'Your Name',
    blurb:  'What should we call you?',
    fields: ['first_name', 'last_name'],
  },
  {
    title:  'Contact Details',
    blurb:  'So we can reach you about your orders.',
    fields: ['email', 'phone', 'address'],
  },
  {
    title:  'Create a Password',
    blurb:  'Last step — keep your account secure.',
    fields: ['password', 'password_confirmation'],
  },
];

/** field -> step index, so a server error can send the customer back to it. */
const FIELD_STEP = Object.fromEntries(
  STEPS.flatMap((step, i) => step.fields.map((key) => [key, i]))
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Mirrors the phone rule in AuthController::register — keep the two in step.
const PHONE_RE = /^(\+?63|0)9\d{9}$/;

const stripPhone = (value) => String(value ?? '').replace(/[^0-9+]/g, '');

/** Passwords are never trimmed — a trailing space is part of the secret. */
const valueOf = (key, form) => {
  const raw = form[key] ?? '';
  return key.startsWith('password') ? raw : raw.trim();
};

const validateField = (key, form) => {
  const config = FIELDS[key];
  const value  = valueOf(key, form);

  if (config.required && !value) return `${config.label} is required.`;
  if (!value) return null;

  switch (key) {
    case 'email':
      return EMAIL_RE.test(value) ? null : 'Enter a valid email address.';
    case 'phone':
      return PHONE_RE.test(stripPhone(value))
        ? null
        : 'Enter a valid PH mobile number, e.g. 09171234567.';
    case 'password':
      return value.length >= 8 ? null : 'Password must be at least 8 characters.';
    case 'password_confirmation':
      return value === (form.password ?? '') ? null : 'Passwords do not match.';
    default:
      return null;
  }
};

export default function Register() {
  const [step, setStep]         = useState(0);
  const [form, setForm]         = useState({
    first_name: '', last_name: '', email: '',
    phone: '', address: '', password: '', password_confirmation: '',
  });
  const [errors, setErrors]     = useState({});
  const [reveal, setReveal]     = useState(false);
  const { register, isLoading } = useAuthStore();
  const scrollRef               = useRef(null);
  const inputRefs               = useRef({});

  const isLastStep = step === STEPS.length - 1;

  const update = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    // Clear the complaint as soon as they start fixing it
    setErrors((e) => (e[key] ? { ...e, [key]: null } : e));
  };

  const goBack = () => {
    setStep((s) => Math.max(0, s - 1));
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  // Hardware back walks back through the wizard instead of dropping the
  // customer out of registration and losing everything they typed.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step > 0) {
        goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [step]);

  const collectErrors = (keys) => {
    const found = {};
    for (const key of keys) {
      const error = validateField(key, form);
      if (error) found[key] = error;
    }
    return found;
  };

  const submit = async () => {
    // Sweep every step, not just this one — editing an earlier field after
    // passing it (going Back, then changing the password) can invalidate it.
    const all = collectErrors(Object.keys(FIELD_STEP));

    if (Object.keys(all).length) {
      setErrors(all);
      setStep(Math.min(...Object.keys(all).map((k) => FIELD_STEP[k])));
      return;
    }

    const result = await register({
      first_name:            form.first_name.trim(),
      last_name:             form.last_name.trim(),
      email:                 form.email.trim(),
      phone:                 stripPhone(form.phone),
      address:               form.address.trim() || null,
      password:              form.password,
      password_confirmation: form.password_confirmation,
    });

    if (result.success) {
      router.replace('/(tabs)');
      return;
    }

    // A taken email only surfaces here, on the last step — so land the customer
    // on the field at fault rather than showing a dead-end alert.
    if (result.errors) {
      const mapped = Object.fromEntries(
        Object.entries(result.errors)
          .map(([field, messages]) => [field, Array.isArray(messages) ? messages[0] : String(messages)])
      );
      setErrors(mapped);

      const steps = Object.keys(mapped)
        .map((key) => FIELD_STEP[key])
        .filter((n) => n !== undefined);

      if (steps.length) {
        setStep(Math.min(...steps));
        scrollRef.current?.scrollTo({ y: 0, animated: false });
        return;
      }
    }

    Alert.alert('Registration Failed', result.message);
  };

  const goNext = () => {
    const stepErrors = collectErrors(STEPS[step].fields);

    if (Object.keys(stepErrors).length) {
      setErrors((e) => ({ ...e, ...stepErrors }));
      return;
    }

    if (isLastStep) {
      submit();
      return;
    }

    setStep((s) => s + 1);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const current = STEPS[step];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Progress — always visible, so the end is always in sight */}
      <View style={styles.progressHeader}>
        <View style={styles.progressTop}>
          {step > 0 ? (
            <TouchableOpacity onPress={goBack} hitSlop={12} style={styles.backLink}>
              <Ionicons name="chevron-back" size={19} color="#b91c1c" />
              <Text style={styles.backLinkText}>Back</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.backLink} />
          )}

          <Text style={styles.stepCount}>Step {step + 1} of {STEPS.length}</Text>
        </View>

        <View style={styles.progressTrack}>
          {STEPS.map((s, i) => (
            <View
              key={s.title}
              style={[
                styles.progressSegment,
                i <= step && styles.progressSegmentDone,
                i === 0 && { marginLeft: 0 },
              ]}
            />
          ))}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.subtitle}>{current.blurb}</Text>

        {current.fields.map((key, i) => {
          const config = FIELDS[key];
          const error  = errors[key];

          // The keyboard's next key moves to the next field IN THIS STEP, and
          // only advances the wizard from the last one.
          const nextKey   = current.fields[i + 1];
          const isLastHere = i === current.fields.length - 1;

          return (
            <View key={key} style={styles.field}>
              <Text style={styles.label}>
                {config.label}
                {config.required
                  ? <Text style={styles.req}> *</Text>
                  : <Text style={styles.optional}>  (optional)</Text>}
              </Text>

              <View style={[
                styles.inputWrap,
                config.multiline && styles.inputWrapTall,
                error && styles.inputWrapError,
              ]}>
                <TextInput
                  ref={(el) => { inputRefs.current[key] = el; }}
                  style={[styles.input, config.multiline && styles.inputMultiline]}
                  placeholder={config.placeholder}
                  placeholderTextColor="#aaa"
                  value={form[key]}
                  onChangeText={(v) => update(key, v)}
                  keyboardType={config.keyboardType || 'default'}
                  autoCapitalize={config.autoCapitalize}
                  autoComplete={config.autoComplete}
                  autoCorrect={false}
                  secureTextEntry={config.secure && !reveal}
                  multiline={config.multiline}
                  maxLength={key === 'phone' ? 20 : 255}
                  // Multiline keeps Enter as a newline; everything else either
                  // hops to the next field or advances the wizard.
                  returnKeyType={
                    config.multiline ? 'default' : isLastHere ? 'go' : 'next'
                  }
                  blurOnSubmit={isLastHere}
                  onSubmitEditing={
                    config.multiline
                      ? undefined
                      : isLastHere
                        ? goNext
                        : () => inputRefs.current[nextKey]?.focus()
                  }
                />

                {config.secure && (
                  <TouchableOpacity onPress={() => setReveal((r) => !r)} hitSlop={10}>
                    <Ionicons
                      name={reveal ? 'eye-off-outline' : 'eye-outline'}
                      size={19}
                      color="#999"
                    />
                  </TouchableOpacity>
                )}
              </View>

              {error ? (
                <View style={styles.errorRow}>
                  <Ionicons name="alert-circle" size={13} color="#dc2626" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : config.hint ? (
                <Text style={styles.hint}>{config.hint}</Text>
              ) : null}
            </View>
          );
        })}

        <TouchableOpacity style={styles.button} onPress={goNext} disabled={isLoading}>
          {isLoading
            ? <ActivityIndicator color="#fff" />
            : (
              <>
                <Text style={styles.buttonText}>
                  {isLastStep ? 'Create Account' : 'Continue'}
                </Text>
                {!isLastStep && <Ionicons name="arrow-forward" size={17} color="#fff" />}
              </>
            )
          }
        </TouchableOpacity>

        {step === 0 && (
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.link}>
              Already have an account? <Text style={styles.linkBold}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  progressHeader:  { paddingTop: 54, paddingHorizontal: 24, paddingBottom: 4 },
  progressTop:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  backLink:        { flexDirection: 'row', alignItems: 'center', minWidth: 62 },
  backLinkText:    { color: '#b91c1c', fontSize: 15, fontWeight: '600' },
  stepCount:       { fontSize: 12.5, color: '#999', fontWeight: '600' },
  progressTrack:   { flexDirection: 'row' },
  progressSegment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: '#eee', marginLeft: 6 },
  progressSegmentDone: { backgroundColor: '#b91c1c' },

  inner:    { flexGrow: 1, paddingHorizontal: 24, paddingTop: 26, paddingBottom: 40 },
  title:    { fontSize: 25, fontWeight: '700', color: '#1a1a1a' },
  subtitle: { fontSize: 14.5, color: '#777', marginTop: 5, marginBottom: 24, lineHeight: 20 },

  field:    { marginBottom: 18 },
  label:    { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 7 },
  req:      { color: '#b91c1c' },
  optional: { color: '#aaa', fontWeight: '400', fontSize: 12 },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#e5e5e5', borderRadius: 12,
    paddingHorizontal: 14, backgroundColor: '#fafafa',
  },
  inputWrapTall:  { alignItems: 'flex-start', paddingVertical: 4 },
  inputWrapError: { borderColor: '#dc2626', backgroundColor: '#fef2f2' },
  input:          { flex: 1, paddingVertical: 14, fontSize: 15, color: '#1a1a1a' },
  inputMultiline: { minHeight: 76, textAlignVertical: 'top' },

  errorRow:  { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  errorText: { color: '#dc2626', fontSize: 12.5, flex: 1, lineHeight: 17 },
  hint:      { color: '#9ca3af', fontSize: 12, marginTop: 6, lineHeight: 17 },

  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#b91c1c', borderRadius: 14,
    paddingVertical: 16, marginTop: 10, marginBottom: 20,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link:       { textAlign: 'center', color: '#666', fontSize: 14 },
  linkBold:   { color: '#b91c1c', fontWeight: '600' },
});
