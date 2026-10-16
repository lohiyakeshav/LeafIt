// A block as flat typed arrays: cheap to scan, and posted to the simulator's Web Worker once (copied, not transferred:
// the 3D view keeps reading the originals).

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
  return {
    id: block.id,
    rows,
    cols,
    cellM: block.cell_m,
    classes: block.landcover_classes,
    lst: flat(rows, cols, block.lst_c ?? block.lst, Float64Array),
    bf: flat(rows, cols, block.building_frac ?? block.buildingFrac, Float64Array),
    roof: flat(rows, cols, block.roof_area_m2 ?? block.roofArea, Float64Array),
    lc: flat(rows, cols, block.landcover, Uint8Array),
    landmarks: block.landmarks ?? [],
    baselineAqi: block.baseline_aqi ?? 0,
  };
}
