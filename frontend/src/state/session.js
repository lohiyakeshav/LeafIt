// Session state shared by Studio, Summary and Vendors (replaces passing everything through router state, which broke
// on refresh and deep links). Persisted to sessionStorage: a reload restores the plan; a new tab starts fresh.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const HISTORY_LIMIT = 200;
const MAX_OPTIONS = 4;

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
      unitCost: null,   // user-edited prices { tree, cool_roof, shade_stop } in ₹; null = the sourced defaults
      plan: null,       // { id, bom } once the user has reviewed the plan
      options: [],      // saved plan variants to compare: [{ id, label, items, years, metrics }]

      /** Switch to another block/area: a different place starts with an empty plan. */
      openBlock: (id) => { if (get().blockId !== id) set({ blockId: id, items: [], history: [], plan: null, options: [] }); },
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
      setUnitCost: (unitCost) => set({ unitCost, plan: null }),   // a saved plan was costed with the old prices
      setPlan: (plan) => set({ plan }),
      /** Snapshot the current plan (and its simulated metrics) as a named option. Keeps the newest MAX_OPTIONS. */
      saveOption: (metrics, label) => set((s) => {
        const used = new Set(s.options.map((o) => o.label));
        const name = label ?? [...'ABCDEFGH'].map((c) => `Option ${c}`).find((n) => !used.has(n)) ?? `Option ${s.options.length + 1}`;
        const opt = { id: `${Date.now().toString(36)}`, label: name, items: s.items, years: s.years, metrics };
        return { options: [...s.options, opt].slice(-MAX_OPTIONS) };
      }),
      loadOption: (id) => { const o = get().options.find((x) => x.id === id); if (o) { get().setItems(o.items); set({ years: o.years }); } },
      removeOption: (id) => set((s) => ({ options: s.options.filter((o) => o.id !== id) })),
    }),
    {
      name: 'leafit-session',
      version: 1,
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ blockId, items, tool, showAfter, years, budget, unitCost, plan, options }) => ({ blockId, items, tool, showAfter, years, budget, unitCost, plan, options }),
    },
  ),
);
