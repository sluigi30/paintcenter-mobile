// ─────────────────────────────────────────────────────────────
// A one-shot handoff of the registration form from the wizard to the OTP
// screen, held in memory only.
//
// NOT nav params and NOT AsyncStorage: the payload carries the plaintext
// password, which has no business sitting in a URL or on disk. It lives for the
// few seconds between "Create Account" and a verified code, then is cleared —
// on success, on abandonment, or on a hard reload (a module reset wipes it,
// which is the safe direction: the user simply re-enters the wizard).
// ─────────────────────────────────────────────────────────────

let pending = null;

export const setPendingRegistration = (data) => { pending = data; };

export const getPendingRegistration = () => pending;

export const clearPendingRegistration = () => { pending = null; };
