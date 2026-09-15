// ─────────────────────────────────────────────────────────────
// Keeping a screen's data fresh without polling it.
//
// Two gaps these close:
//
//   1. Screens that fetch once on mount. Tab screens and pushed routes stay
//      mounted, so "on mount" can mean "an hour ago" — stock and prices drift
//      while the customer reads.
//   2. Suspended timers. The OS freezes JS timers while the app is in the
//      background, so a screen that polls comes back up to a full interval
//      stale — on exactly the screen someone reopened the app to check.
//
// Polling is still the right tool where a screen must react while you watch it
// (orders, the message thread). These are for everything else.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

/**
 * Run `refresh` when the screen gains focus, and again when the app returns
 * from the background while this screen is the focused one.
 *
 * `refresh` MUST be wrapped in useCallback by the caller — it is a dependency,
 * so a function rebuilt every render would refetch on every render.
 */
export function useFocusRefresh(refresh) {
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  useResumeWhileFocused(refresh);
}

/**
 * Run `onResume` when the app returns from the background, but only if this
 * screen is the focused one.
 *
 * For screens that already handle focus themselves — the ones polling on an
 * interval — where the only gap is that the OS freezes their timer.
 *
 * The focus test is the whole point: tab screens stay mounted, so a plain
 * AppState listener would have every tab fetch at once on every resume, which
 * is the background chatter the focused polling was written to avoid.
 */
export function useResumeWhileFocused(onResume) {
  const focused = useRef(false);

  useFocusEffect(useCallback(() => {
    focused.current = true;

    return () => { focused.current = false; };
  }, []));

  useAppResume(useCallback(() => {
    if (focused.current) onResume();
  }, [onResume]));
}

/** Raw resume signal, no focus test. */
export function useAppResume(onResume) {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') onResume();
    });

    return () => sub.remove();
  }, [onResume]);
}
