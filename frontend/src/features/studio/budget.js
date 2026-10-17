import { inr } from '../../shared/lib/format.js';

const MIN_BUDGET = 10_000, MAX_BUDGET = 1_000_000_000;   // the server's limits (api/schemas.py)

/** Why the planner can't work with this budget, in words, or null when it can. */
export function budgetProblem(budget, treePrice) {
  if (isNaN(budget)) return 'Enter a budget';
  if (budget < treePrice) return `${inr(Math.max(0, budget))} can't pay for a single tree (${inr(treePrice)} each). Raise the budget to plan.`;
  if (budget < MIN_BUDGET) return `The planner needs at least ${inr(MIN_BUDGET)} to compare options`;
  if (budget > MAX_BUDGET) return `The most the planner works with is ${inr(MAX_BUDGET)}`;
  return null;
}
