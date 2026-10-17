import 'package:flutter/services.dart';

/// Budget limits in lakh; must match the backend's MIN_BUDGET_INR / MAX_BUDGET_INR (₹10,000 – ₹100 crore).
const minBudgetLakh = 0.1, maxBudgetLakh = 10000.0;

/// Only digits with at most one decimal point and two decimals, up to 5 whole digits: "10000.25".
/// Stops "1e28", "--5" and pasted junk at the keyboard.
final budgetInput = <TextInputFormatter>[
  FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
  TextInputFormatter.withFunction((old, next) => RegExp(r'^\d{0,5}(\.\d{0,2})?$').hasMatch(next.text) ? next : old),
];

/// Null when the budget (in lakh) is fine, otherwise a short message to show under the field.
String? budgetError(String text) {
  final t = text.trim();
  if (t.isEmpty) return 'Enter a budget in lakh, e.g. 15';
  final v = double.tryParse(t);
  if (v == null) return 'Numbers only, e.g. 15 or 7.5';
  if (v < minBudgetLakh) return 'At least 0.1 lakh (₹10,000)';
  if (v > maxBudgetLakh) return 'At most 10,000 lakh (₹100 crore)';
  return null;
}
