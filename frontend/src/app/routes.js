// Route-level code splitting. The Maps SDK lives behind Explore and three.js behind Studio, so the home page stays tiny.
// Each page also prefetches the NEXT one while the browser is idle, so the step after a click feels instant.
import { lazy } from 'react';

const load = {
  explore: () => import('../features/explore/ExplorePage.jsx'),
  studio: () => import('../features/studio/StudioPage.jsx'),
  summary: () => import('../features/summary/SummaryPage.jsx'),
  vendors: () => import('../features/vendors/VendorsPage.jsx'),
  method: () => import('../features/method/AssumptionsPage.jsx'),
};

export const ExplorePage = lazy(load.explore);
export const StudioPage = lazy(load.studio);
export const SummaryPage = lazy(load.summary);
export const VendorsPage = lazy(load.vendors);
export const AssumptionsPage = lazy(load.method);

/** Warm a page's chunk when the browser has nothing better to do. */
export function prefetch(name) {
  const run = () => load[name]?.().catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
