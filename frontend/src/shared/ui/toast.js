// A tiny event bus for toasts: any component calls toast('…'); the one <ToastProvider/> in App shows it.
const listeners = new Set();

export function showToast(msg, duration = 2000) {
  const t = { msg, duration, id: Date.now() + Math.random() };
  listeners.forEach((fn) => fn(t));
}

export function onToast(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Hook form, so components read naturally: const toast = useToast(); toast('Saved'). */
export const useToast = () => showToast;
