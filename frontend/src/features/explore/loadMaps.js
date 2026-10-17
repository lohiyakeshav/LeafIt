// Loads the Google Maps JS API once, only when the Explore page needs it (it is ~200 KB the home page never pays for).
import { Loader } from '@googlemaps/js-api-loader';
import { mapsKey } from '../../shared/lib/mapsKey.js';

let promise = null;

export const hasKey = () => Boolean(mapsKey());

export function loadMaps() {
  if (!hasKey()) return Promise.reject(new Error('NO_KEY'));
  promise ??= (async () => {
    const loader = new Loader({ apiKey: mapsKey(), version: 'weekly' });
    await Promise.all([loader.importLibrary('maps'), loader.importLibrary('places')]);
    return window.google;
  })().catch((e) => { promise = null; throw e; });
  return promise;
}
