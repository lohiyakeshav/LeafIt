// A block as flat typed arrays: cheap to scan, and posted to the simulator's Web Worker once (copied, not transferred:
// the 3D view keeps reading the originals).

const LEGACY_ROAD_CARRIAGEWAY = 0.45;   // blocks without road data (old cached areas): a road cell is ~half carriageway

const flat = (rows, cols, nested, Type) => {
  const out = new Type(rows * cols);
  for (let r = 0; r < rows; r++) {
    const row = nested[r];
    for (let c = 0; c < cols; c++) out[r * cols + c] = row[c];
  }
  return out;
};

/** Block JSON (as served by the API) -> grid. Plain data only (no functions), so it can be posted to a worker. */
export function toGrid(block) {
  const { rows, cols } = block;
  const classes = block.landcover_classes;
  const lc = flat(rows, cols, block.landcover, Uint8Array);
  const road = classes.indexOf('road');
  const ring = block.ring
    ? { pad: block.ring.pad, rows: rows + 2 * block.ring.pad, cols: cols + 2 * block.ring.pad,
        canopy: flat(rows + 2 * block.ring.pad, cols + 2 * block.ring.pad, block.ring.canopy_frac, Float64Array),
        canopyH: flat(rows + 2 * block.ring.pad, cols + 2 * block.ring.pad, block.ring.canopy_h, Float64Array) }
    : null;
  return {
    id: block.id,
    rows,
    cols,
    cellM: block.cell_m,
    classes,
    lst: flat(rows, cols, block.lst_c ?? block.lst, Float64Array),
    bf: flat(rows, cols, block.building_frac ?? block.buildingFrac, Float64Array),
    roof: flat(rows, cols, block.roof_area_m2 ?? block.roofArea, Float64Array),
    lc,
    canopy: block.canopy_frac ? flat(rows, cols, block.canopy_frac, Float64Array) : new Float64Array(rows * cols),
    canopyH: block.canopy_h ? flat(rows, cols, block.canopy_h, Float64Array) : new Float64Array(rows * cols),
    carriageway: block.carriageway_frac ? flat(rows, cols, block.carriageway_frac, Float64Array)
      : Float64Array.from(lc, (v) => (road >= 0 && v === road ? LEGACY_ROAD_CARRIAGEWAY : 0)),
    exposure: block.exposure ? flat(rows, cols, block.exposure, Float64Array) : null,
    ring,
    climate: block.climate?.class ?? null,
    humid: block.climate?.class === 'humid',
    landmarks: block.landmarks ?? [],
    baselineAqi: block.baseline_aqi ?? null,   // null: no reading, so no AQI change is claimed
  };
}
