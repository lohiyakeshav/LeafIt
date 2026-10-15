import 'package:flutter/services.dart';

import 'package:flutter_test/flutter_test.dart';
import 'package:leafit/format.dart';
import 'package:leafit/models.dart';
import 'package:leafit/state.dart';
import 'package:leafit/validate.dart';
import 'package:leafit/widgets/heat_grid.dart';

Block _block() => Block.fromJson({
      'id': 'b', 'name': 'B', 'rows': 2, 'cols': 2, 'cell_m': 10,
      'landcover_classes': ['built', 'road', 'trees', 'grass', 'bare', 'water'],
      'landcover': [[0, 1], [3, 5]],
      'lst_c': [[45, 47], [40, 38]],
      'building_frac': [[0.8, 0], [0, 0]],
      'roof_area_m2': [[80, 0], [0, 0]],
    });

void main() {
  test('inr uses Indian units', () {
    expect(inr(0), '₹0');
    expect(inr(45000), '₹45,000');
    expect(inr(1850000), '₹18.5 L');
    expect(inr(1e7), '₹1 Cr');
    expect(inr(25000000), '₹2.5 Cr');
    expect(inr(-150000), '-₹1.5 L');
  });

  test('cellAt maps points to cells', () {
    const s = Size(100, 50);
    expect(cellAt(const Offset(0, 0), s, 5, 10), (0, 0));
    expect(cellAt(const Offset(99.9, 49.9), s, 5, 10), (4, 9));
    expect(cellAt(const Offset(100, 10), s, 5, 10), null);
  });

  test('placement rules and undo', () {
    final s = SimState(_block());
    expect(s.tap(0, 0), isNotNull); // tree on a building
    expect(s.tap(1, 1), isNotNull); // tree on water
    expect(s.tap(1, 0), isNull);
    expect(s.tap(1, 0), isNull);
    expect(s.placements.single.count, 2); // stacked in one cell
    s.setTool(Tool.coolRoof);
    expect(s.tap(0, 0), isNull);
    expect(s.tap(0, 0), isNotNull); // one roof per cell
    s.setTool(Tool.shadeStop);
    expect(s.tap(1, 0), isNotNull); // not a road
    expect(s.tap(0, 1), isNull);
    expect(s.removeAt(0, 1), isTrue);
    s.undo();
    expect(s.placements.length, 3);
    s.dispose();
  });

  test('budget validation', () {
    expect(budgetError('15'), isNull);
    expect(budgetError('0.1'), isNull);
    expect(budgetError('10000'), isNull);
    expect(budgetError(''), isNotNull);
    expect(budgetError('0.05'), contains('At least'));
    expect(budgetError('10000.5'), contains('At most'));
    expect(budgetError('.'), contains('Numbers only'));
    // the keyboard filter rejects anything that isn't up to 5 digits + 2 decimals
    TextEditingValue type(String old, String next) =>
        budgetInput.fold(TextEditingValue(text: next), (v, f) => f.formatEditUpdate(TextEditingValue(text: old), v));
    expect(type('12', '123').text, '123');
    expect(type('12345', '123456').text, '12345');
    expect(type('1', '1e28').text, '128'); // letters are dropped
    expect(type('7.5', '7.55').text, '7.55');
    expect(type('7.55', '7.555').text, '7.55');
    expect(type('7.5', '7.5.').text, '7.5');
  });
}
