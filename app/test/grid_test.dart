import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:leafit/models.dart';
import 'package:leafit/state.dart';
import 'package:leafit/screens/simulator.dart';
import 'package:leafit/ui/theme.dart';
import 'package:leafit/widgets/heat_grid.dart';

Block _block() => Block.fromJson({
      'id': 'b', 'name': 'B', 'rows': 4, 'cols': 4, 'cell_m': 10,
      'landcover_classes': ['built', 'road', 'trees', 'grass', 'bare', 'water'],
      'landcover': List.generate(4, (_) => List.filled(4, 1)),
      'lst_c': List.generate(4, (_) => List.filled(4, 40.0)),
      'building_frac': List.generate(4, (_) => List.filled(4, 0.0)),
      'roof_area_m2': List.generate(4, (_) => List.filled(4, 0.0)),
    });

void main() {
  testWidgets('every tap on the grid places an item', (tester) async {
    final s = SimState(_block());
    await tester.pumpWidget(MaterialApp(
      home: Center(
        child: SizedBox.square(
          dimension: 400,
          child: ListenableBuilder(
              listenable: s,
              builder: (_, _) => HeatGrid(state: s, onTap: (r, c) => s.tap(r, c), onLongPress: (r, c) => s.removeAt(r, c))),
        ),
      ),
    ));
    final topLeft = tester.getTopLeft(find.byType(HeatGrid));
    for (final (r, c) in [(0, 0), (1, 2), (3, 3)]) {
      await tester.tapAt(topLeft + Offset(c * 100 + 50, r * 100 + 50));
      await tester.pump(const Duration(milliseconds: 800));
    }
    expect(s.placements.length, 3);

    // rapid taps 50 ms apart all count
    for (final c in [1, 2, 3]) {
      await tester.tapAt(topLeft + Offset(c * 100 + 50, 50));
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(s.placements.fold(0, (n, p) => n + p.count), 6);

    // a drag is a pan, not a tap
    final before = s.placements.length;
    await tester.dragFrom(topLeft + const Offset(50, 350), const Offset(120, 0));
    await tester.pump(const Duration(milliseconds: 600));
    expect(s.placements.length, before);

    // long-press removes
    await tester.longPressAt(topLeft + const Offset(50, 50));
    await tester.pump(const Duration(milliseconds: 600));
    expect(s.placements.any((p) => p.row == 0 && p.col == 0), isFalse);
    s.dispose();
  });

  testWidgets('every tap on the simulator map places an item', (tester) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final s = SimState(_block());
    await tester.pumpWidget(MaterialApp(theme: leafTheme(), home: SimulatorScreen(state: s)));
    await tester.pump(const Duration(seconds: 2));
    final grid = tester.getRect(find.byType(HeatGrid));
    final cell = grid.width / 4;
    for (final (r, c) in [(0, 0), (1, 2), (3, 3)]) {
      await tester.tapAt(grid.topLeft + Offset(c * cell + cell / 2, r * cell + cell / 2));
      await tester.pump(const Duration(milliseconds: 800));
      // what a successful /simulate does: new metrics + cooling grid
      s.metrics = {'temp_reduction_c': 0.1 * s.placements.length, 'total_cost_inr': 3000};
      s.cooling = List.generate(4, (_) => List.filled(4, 0.2));
      s.setShowAfter(true);
      await tester.runAsync(() => Future.delayed(const Duration(milliseconds: 100))); // let the heat image decode
      await tester.pump(const Duration(milliseconds: 800));
    }
    expect(s.placements.length, 3);
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 3));
  });

  testWidgets('the map pinch-zooms and pans; the + button zooms', (tester) async {
    tester.view.physicalSize = const Size(392 * 3, 870 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final s = SimState(_block());
    await tester.pumpWidget(MaterialApp(theme: leafTheme(), home: SimulatorScreen(state: s)));
    await tester.pump(const Duration(seconds: 2));
    final viewer = tester.widget<InteractiveViewer>(find.byType(InteractiveViewer));
    final zoom = viewer.transformationController!;
    final c = tester.getCenter(find.byType(HeatGrid));

    // pinch out
    final a = await tester.startGesture(c - const Offset(30, 0), pointer: 1);
    final b = await tester.startGesture(c + const Offset(30, 0), pointer: 2);
    for (var i = 1; i <= 10; i++) {
      await a.moveTo(c - Offset(30.0 + i * 8, 0));
      await b.moveTo(c + Offset(30.0 + i * 8, 0));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await a.up();
    await b.up();
    await tester.pump(const Duration(milliseconds: 500));
    expect(zoom.value.getMaxScaleOnAxis(), greaterThan(1.5), reason: 'pinch should zoom');
    expect(s.placements, isEmpty, reason: 'a pinch must not plant anything');

    // one-finger pan moves the zoomed map, and doesn't plant
    final before = zoom.value.getTranslation().x;
    await tester.dragFrom(c, const Offset(-80, 0));
    await tester.pump(const Duration(milliseconds: 500));
    expect(zoom.value.getTranslation().x, isNot(before), reason: 'drag should pan');
    expect(s.placements, isEmpty);

    // fit, then +
    await tester.tap(find.byTooltip('Fit the whole block'));
    await tester.pumpAndSettle(const Duration(milliseconds: 50));
    expect(zoom.value.getMaxScaleOnAxis(), closeTo(1, 0.01));
    await tester.tap(find.byTooltip('Zoom in'));
    await tester.pumpAndSettle(const Duration(milliseconds: 50));
    expect(zoom.value.getMaxScaleOnAxis(), closeTo(1.6, 0.01));
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 3));
  });
}
