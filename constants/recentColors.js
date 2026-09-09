import AsyncStorage from '@react-native-async-storage/async-storage';

// The customer's recently chosen custom colours.
//
// Kept out of ColorPicker so that *choosing* a colour and *committing* to one
// are separate: the picker reads this list, but only a successful add-to-cart
// writes to it. Recording every colour dragged past on the way would fill the
// list with near-misses and bury the one they actually bought.

const KEY = 'ncm.recentColors';
const MAX = 8;

export async function loadRecentColors() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(c => typeof c === 'string') : [];
  } catch {
    // A missing or corrupt list is not worth an error state — it is a
    // convenience, and an empty one behaves correctly.
    return [];
  }
}

export async function rememberColor(hex) {
  if (!hex) return;
  const colour = String(hex).toUpperCase();

  try {
    const current = await loadRecentColors();
    const next = [colour, ...current.filter(c => c.toUpperCase() !== colour)].slice(0, MAX);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Failing to persist a convenience must never break the purchase.
  }
}
