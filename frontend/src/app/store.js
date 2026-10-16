// Session state shared by Studio, Summary and Vendors (replaces passing everything through router state, which broke
// on refresh and deep links). Persisted to sessionStorage: a reload restores the plan; a new tab starts fresh.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const HISTORY_LIMIT = 200;

export const useSession = create(
  persist(
    (set, get) => ({
      blockId: null,
      items: [],        // positioned things the user placed (see features/studio/placements.js)
      history: [],      // previous `items` arrays, for undo (not persisted)
      tool: 'tree',
      showAfter: true,
      years: 10,
      budget: 2_000_000,
      plan: null,       // { id, bom } once the user has reviewed the plan

      /** Switch to another block/area: a different place starts with an empty plan. */
      openBlock: (id) => { if (get().blockId !== id) set({ blockId: id, items: [], history: [], plan: null }); },
      setItems: (items) => set((s) => ({ items, history: [...s.history.slice(-(HISTORY_LIMIT - 1)), s.items], plan: null })),
      undo: () => set((s) => (s.history.length ? { items: s.history[s.history.length - 1], history: s.history.slice(0, -1), plan: null } : s)),
      clear: () => get().setItems([]),
      // one paint drag = one undo step: snapshot once at the start, then update items without touching history
      beginStroke: () => set((s) => ({ history: [...s.history.slice(-(HISTORY_LIMIT - 1)), s.items], plan: null })),
      strokeSet: (items) => set({ items }),
      setTool: (tool) => set({ tool }),
      setShowAfter: (showAfter) => set({ showAfter }),
      setYears: (years) => set({ years, plan: null }),
      setBudget: (budget) => set({ budget }),
      setPlan: (plan) => set({ plan }),
    }),
    {
      name: 'leafit-session',
      version: 1,
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ blockId, items, tool, showAfter, years, budget, plan }) => ({ blockId, items, tool, showAfter, years, budget, plan }),
    },
  ),
);
