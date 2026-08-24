import { create } from 'zustand';

// The return channel from the AR wall measurement back into the paint calculator.
//
// Navigation params only carry data *forward*. The AR screen is opened from one
// specific wall row and has to answer that same row, so it drops the measurement
// here and pops itself off the stack. Handing the numbers back as params instead
// would push a SECOND calculator on top of the first, leaving the walls the user
// already typed sitting on a screen underneath it.
//
// The measurement is read once and cleared, so re-opening the calculator later
// never silently overwrites a wall with a stale reading.
export const useMeasureStore = create((set, get) => ({
  pending: null,                     // { width, height } in metres, or null

  report: (width, height) => set({ pending: { width, height } }),

  take: () => {
    const { pending } = get();
    if (pending) set({ pending: null });
    return pending;
  },
}));
