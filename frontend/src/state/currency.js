// The display currency and today's exchange rates. The choice is remembered across visits (localStorage); the rates
// come from the backend's /fx, which records them once a day. Maths everywhere stays in INR.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api } from '../api/client.js';
import { setDisplayCurrency } from '../shared/lib/format.js';

export const CURRENCIES = [
  ['INR', 'Indian rupee'], ['USD', 'US dollar'], ['EUR', 'Euro'], ['GBP', 'British pound'], ['JPY', 'Japanese yen'],
  ['CNY', 'Chinese yuan'], ['RUB', 'Russian rouble'], ['AED', 'UAE dirham'], ['SAR', 'Saudi riyal'], ['QAR', 'Qatari riyal'],
  ['SGD', 'Singapore dollar'], ['AUD', 'Australian dollar'], ['CAD', 'Canadian dollar'], ['CHF', 'Swiss franc'],
];

export const useCurrency = create(persist(
  (set, get) => ({
    code: 'INR',
    rates: { INR: 1 },
    date: null,
    stale: false,
    setCode: (code) => { setDisplayCurrency(code, get().rates[code] ?? 1); set({ code }); },
    load: async () => {
      try {
        const fx = await api.get('/fx');
        set({ rates: fx.rates, date: fx.date, stale: Boolean(fx.stale) });
      } catch { /* offline: keep the last rates we had */ }
      const { code, rates } = get();
      if (!rates[code]) get().setCode('INR'); else setDisplayCurrency(code, rates[code]);
      set({});   // re-render with the fresh rate
    },
  }),
  { name: 'leafit-currency', storage: createJSONStorage(() => localStorage), partialize: ({ code, rates, date }) => ({ code, rates, date }),
    onRehydrateStorage: () => (s) => { if (s) setDisplayCurrency(s.code, s.rates[s.code] ?? 1); } },
));
