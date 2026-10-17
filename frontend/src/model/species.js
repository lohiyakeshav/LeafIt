// Species choices for the Studio: which suit this climate, and what "auto" picks for a spot.
// "Auto" is the same rule the planner uses (backend/app/domain/optimise.py choose_species): among the species that suit the
// climate, take the one whose fully planted cell shades most at this horizon.
import { SPECIES, crownRatio, capacityOf, freeM2, speciesMaturity, suits } from './rules.js';

export const AUTO = 'auto';
export const SPECIES_LIST = SPECIES.species.filter((s) => s.id !== SPECIES.default);

/** Species the picker offers, each flagged with whether it suits the area's climate class. */
export const speciesOptions = (climate) => SPECIES_LIST.map((s) => ({ ...s, suitable: suits(s, climate) }));

/** The species "auto" chooses at (row, col) for a plan judged at `years`; the generic tree when nothing else fits there. */
export function autoSpecies(grid, years, row, col) {
  const i = row * grid.cols + col, free = freeM2(grid, i);
  let best = null, bestScore = -1;
  for (const s of SPECIES_LIST) {
    if (!suits(s, grid.climate)) continue;
    const cap = capacityOf(s, free, grid.cellM);
    const score = cap * crownRatio(s) * speciesMaturity(s, years);
    if (cap >= 1 && score > bestScore) { best = s; bestScore = score; }
  }
  return best?.id ?? SPECIES.default;
}
