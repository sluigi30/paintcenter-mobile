import { create } from 'zustand';

// Which cart lines are ticked for checkout. Kept OUTSIDE the cart screen so the
// selection survives navigation — the cart tab remounts whenever you come back
// from a product page ("View Cart"), which would otherwise reset every tick.
//
// Stored as the *deselected* ids: anything not listed counts as selected, so a
// freshly added item arrives already ticked.
export const useCartSelection = create((set, get) => ({
  deselected: [],

  isSelected: (id) => !get().deselected.includes(id),

  toggle: (id) => set((s) => ({
    deselected: s.deselected.includes(id)
      ? s.deselected.filter((x) => x !== id)
      : [...s.deselected, id],
  })),

  selectAll:   ()    => set({ deselected: [] }),
  deselectAll: (ids) => set({ deselected: ids }),

  // Drop ids that are no longer in the cart (removed or checked out)
  prune: (ids) => set((s) => {
    const kept = s.deselected.filter((id) => ids.includes(id));
    return kept.length === s.deselected.length ? s : { deselected: kept };
  }),
}));
