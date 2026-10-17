import { expect, test } from 'vitest';
import { budgetProblem } from './budget.js';

test('the planner explains a budget it cannot use', () => {
  expect(budgetProblem(0, 3000)).toMatch(/can't pay for a single tree/);
  expect(budgetProblem(2999, 3000)).toMatch(/can't pay for a single tree/);
  expect(budgetProblem(5000, 3000)).toMatch(/at least/);          // affords a tree, but below the server's floor
  expect(budgetProblem(20_000, 30_000)).toMatch(/single tree/);   // the user's own tree price counts
  expect(budgetProblem(NaN, 3000)).toBe('Enter a budget');
  expect(budgetProblem(2_000_000, 3000)).toBeNull();
});
