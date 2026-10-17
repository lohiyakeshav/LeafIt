// Studio settings: the tools, the view toggles and the limits the page enforces.
import { Trees, House, Bus, Eraser } from 'lucide-react';

export const TOOLS = [
  { value: 'tree',       label: 'Street tree',     short: 'Tree',  key: 'T', icon: Trees,  where: 'Streets and open ground', hint: 'Streets, open ground', unit: ' each' },
  { value: 'cool_roof',  label: 'Cool roof',       short: 'Roof',  key: 'R', icon: House,  where: 'Tap a building roof',     hint: 'Building roofs', unit: ' / m²' },
  { value: 'shade_stop', label: 'Shaded bus stop', short: 'Shade', key: 'B', icon: Bus,    where: 'Roads only',              hint: 'Roads only', unit: ' each' },
  { value: 'erase',      label: 'Erase',           short: 'Erase', key: 'E', icon: Eraser, where: 'Remove what you tap',     hint: 'Tap to remove', unit: '' },
];
export const VIEW_OPTS  = [{ value: false, label: 'Today' }, { value: true, label: 'With plan' }];
export const LAYER_OPTS = [{ value: 'heat', label: 'Heat' }, { value: 'sat', label: 'Satellite' }];
export const ITEM_CAP = 5000;       // the API accepts at most 5000 placements
export const PAINT_SPACING_M = 5;   // trees dropped while painting are at least this far apart

export const DEFAULT_BUDGET = 2_000_000;
export const PRICE_FIELDS = [
  { key: 'tree', label: 'Tree', unit: 'each', min: 100, max: 1_000_000 },
  { key: 'cool_roof', label: 'Cool roof', unit: 'per m²', min: 10, max: 100_000 },
  { key: 'shade_stop', label: 'Bus stop', unit: 'each', min: 1_000, max: 100_000_000 },
];
