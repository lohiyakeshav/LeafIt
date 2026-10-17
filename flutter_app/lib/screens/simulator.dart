import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models.dart';
import '../state.dart';
import '../ui/motion.dart';
import '../ui/parts.dart';
import '../ui/theme.dart';
import '../widgets/heat_grid.dart';
import '../widgets/metrics.dart';
import 'ai_sheet.dart';
import 'assumptions.dart';
import 'summary.dart';

class SimulatorScreen extends StatefulWidget {
  const SimulatorScreen({super.key, required this.state});
  final SimState state;

  @override
  State<SimulatorScreen> createState() => _SimulatorScreenState();
}

class _SimulatorScreenState extends State<SimulatorScreen> with SingleTickerProviderStateMixin {
  SimState get s => widget.state;
  final zoom = TransformationController();
  late final _zoomAnim = AnimationController(vsync: this, duration: Motion.med);
  Animation<Matrix4>? _zoomTween;
  Size _viewport = Size.zero;

  @override
  void initState() {
    super.initState();
    _zoomAnim.addListener(() {
      final t = _zoomTween;
      if (t != null) zoom.value = t.value;
    });
  }

  /// Animated zoom by [factor] around the centre of the map; factor 0 = back to fit.
  void _zoomBy(double factor) {
    final current = zoom.value.getMaxScaleOnAxis();
    final next = factor == 0 ? 1.0 : (current * factor).clamp(1.0, 6.0);
    final c = Offset(_viewport.width / 2, _viewport.height / 2);
    final focal = zoom.toScene(c); // the map point now at the centre stays at the centre
    final target = next == 1.0
        ? Matrix4.identity()
        : (Matrix4.identity()
          ..translateByDouble(c.dx - focal.dx * next, c.dy - focal.dy * next, 0, 1)
          ..scaleByDouble(next, next, 1, 1));
    _zoomTween = Matrix4Tween(begin: zoom.value, end: target).animate(CurvedAnimation(parent: _zoomAnim, curve: Motion.ease));
    _zoomAnim.forward(from: 0);
    HapticFeedback.selectionClick();
  }

  @override
  void dispose() {
    _zoomAnim.dispose();
    zoom.dispose();
    s.dispose();
    super.dispose();
  }

  void _tap(int r, int c) {
    final msg = s.tap(r, c);
    if (msg == null) {
      HapticFeedback.selectionClick();
    } else {
      HapticFeedback.heavyImpact();
      toast(context, msg, lift: _toastLift);
    }
  }

  void _remove(int r, int c) {
    if (s.removeAt(r, c)) {
      HapticFeedback.mediumImpact();
      toast(context, 'Removed', lift: _toastLift);
    }
  }

  // phone: the map card touches the body's bottom edge, and its legend row is ~56 px tall, so float toasts above it
  double get _toastLift => MediaQuery.sizeOf(context).width >= 900 ? 0 : 52;

  void _summary() => Navigator.push(context, MaterialPageRoute(builder: (_) => SummaryScreen(state: s)));

  void _startOver() {
    final n = s.placements.fold(0, (a, p) => a + p.count);
    s.clear();
    HapticFeedback.mediumImpact();
    toast(context, 'Cleared $n items',
        lift: _toastLift,
        duration: const Duration(seconds: 4),
        action: SnackBarAction(label: 'UNDO', textColor: const Color(0xFF3F7A1E), onPressed: s.undo));
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: s,
        builder: (context, _) {
          final wide = MediaQuery.sizeOf(context).width >= 900;
          final map = _MapCard(s, zoom: zoom, onZoom: _zoomBy, onViewport: (v) => _viewport = v, onTap: _tap, onLongPress: _remove);
          final top = _TopBar(s, wide: wide, onSummary: s.placements.isEmpty ? null : _summary, onStartOver: s.placements.isEmpty ? null : _startOver);
          final controls = _Controls(s);
          final dock = _Dock(s);
          return Scaffold(
            body: SafeArea(
              bottom: false,
              child: wide
                  ? Row(children: [
                      Expanded(
                        child: Column(children: [
                          Padding(padding: const EdgeInsets.fromLTRB(Leaf.gutter, 12, Leaf.gutter, 14), child: top),
                          Padding(padding: const EdgeInsets.fromLTRB(Leaf.gutter, 0, Leaf.gutter, 12), child: controls),
                          Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: Leaf.gutter), child: map)),
                        ]),
                      ),
                      Container(
                        width: 380,
                        decoration: const BoxDecoration(border: Border(left: BorderSide(color: Leaf.rule))),
                        child: ListView(padding: const EdgeInsets.all(24), children: [
                          const Kicker('Live estimate'),
                          const SizedBox(height: 18),
                          MetricsBoard(s.metrics, s.breakdown, heroSize: 34, stacked: true),
                          const SizedBox(height: 28),
                          BudgetLine(cost: s.cost, budget: s.budget),
                          const SizedBox(height: 28),
                          Text('Tap a cell to place · long-press to remove · pinch to zoom. Tap any number to see how it is calculated.',
                              style: mono(11)),
                        ]),
                      ),
                    ])
                  : Column(children: [
                      Padding(padding: const EdgeInsets.fromLTRB(Leaf.gutter, 8, Leaf.gutter, 16), child: top),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: Leaf.gutter),
                        child: MetricsBoard(s.metrics, s.breakdown, heroSize: 28),
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(Leaf.gutter, 14, Leaf.gutter, 14),
                        child: BudgetLine(cost: s.cost, budget: s.budget),
                      ),
                      Padding(padding: const EdgeInsets.fromLTRB(Leaf.gutter, 0, Leaf.gutter, 10), child: controls),
                      Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: map)),
                    ]),
            ),
            bottomNavigationBar: dock, // as the bottom bar, toasts float above it instead of covering the tools
          );
        },
      );
}

class _TopBar extends StatelessWidget {
  const _TopBar(this.s, {required this.wide, this.onSummary, this.onStartOver});
  final SimState s;
  final bool wide;
  final VoidCallback? onSummary, onStartOver;

  @override
  Widget build(BuildContext context) {
    final n = s.placements.fold(0, (a, p) => a + p.count);
    final title = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(s.block.name.replaceAll(' (synthetic demo)', ''), maxLines: 1, overflow: TextOverflow.ellipsis, style: serif(wide ? 28 : 34, height: 1)),
      const SizedBox(height: 4),
      SizedBox(
        height: 26, // same slot for the hand-written hint and the mono item count: no layout shift
        child: AnimatedSwitcher(
        duration: Motion.med,
        layoutBuilder: (current, previous) => Stack(alignment: Alignment.centerLeft, children: [...previous, ?current]),
        child: n == 0
            ? Text('tap a street on the map to plant a tree', key: const ValueKey('hint'), style: hand(21))
            : Text('$n ITEMS · YEAR ${s.years}${s.block.synthetic ? ' · DEMO DATA' : ''}',
                key: ValueKey('$n${s.years}'), maxLines: 1, softWrap: false, overflow: TextOverflow.fade, style: mono(10.5)),
        ),
      ),
    ]);
    final actions = [
      CircleBtn(Icons.undo, tooltip: 'Undo', onTap: s.canUndo ? s.undo : null),
      const SizedBox(width: 8),
      CircleBtn(Icons.restart_alt, tooltip: 'Start over', onTap: onStartOver),
      const SizedBox(width: 10),
      AnimatedOpacity(
        opacity: onSummary == null ? 0.4 : 1,
        duration: Motion.fast,
        child: Pill('Review', icon: Icons.arrow_forward, dense: true, height: 40, onTap: onSummary),
      ),
    ];
    final back = CircleBtn(Icons.arrow_back, tooltip: 'Back', onTap: () => Navigator.maybePop(context));
    if (wide) return Row(children: [back, const SizedBox(width: 14), Expanded(child: title), ...actions]);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [back, const Spacer(), ...actions]),
      const SizedBox(height: 14),
      title,
    ]);
  }
}

/// View (today / with plan) and tree age, side by side, each taking half the row.
class _Controls extends StatelessWidget {
  const _Controls(this.s);
  final SimState s;

  @override
  Widget build(BuildContext context) => Row(children: [
        Expanded(
          child: PillToggle<bool>(
            dense: true,
            expand: true,
            options: const [(false, 'Today', null), (true, 'With plan', null)],
            value: s.showAfter,
            onChanged: s.setShowAfter,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: PillToggle<int>(
            dense: true,
            expand: true,
            options: const [(1, 'Yr 1', null), (10, 'Yr 10', null), (20, 'Yr 20', null)],
            value: s.years,
            onChanged: s.setYears,
          ),
        ),
      ]);
}

class _MapCard extends StatelessWidget {
  const _MapCard(this.s, {required this.zoom, required this.onZoom, required this.onViewport, required this.onTap, required this.onLongPress});
  final SimState s;
  final TransformationController zoom;
  final void Function(double) onZoom;
  final void Function(Size) onViewport;
  final void Function(int, int) onTap, onLongPress;

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: Leaf.sunk,
          borderRadius: BorderRadius.circular(Leaf.radius),
          border: Border.all(color: Leaf.rule),
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(children: [
          Positioned.fill(
            child: LayoutBuilder(builder: (context, box) {
              onViewport(box.biggest);
              return InteractiveViewer(
                transformationController: zoom,
                maxScale: 6,
                child: Center(child: HeatGrid(state: s, zoom: zoom, onTap: onTap, onLongPress: onLongPress)),
              );
            }),
          ),
          Positioned(
            top: 10,
            right: 10,
            child: Glass(
              radius: 22,
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                _ZoomBtn(Icons.add, 'Zoom in', () => onZoom(1.6)),
                Container(width: 22, height: 1, color: Leaf.rule),
                _ZoomBtn(Icons.remove, 'Zoom out', () => onZoom(1 / 1.6)),
                Container(width: 22, height: 1, color: Leaf.rule),
                _ZoomBtn(Icons.fit_screen_outlined, 'Fit the whole block', () => onZoom(0)),
              ]),
            ),
          ),
          Positioned(
            left: 10,
            right: 10,
            bottom: 10,
            child: Row(children: [
              Flexible(
                child: Glass(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  child: HeatLegend(min: s.block.minT, max: s.block.maxT, barWidth: 64),
                ),
              ),
              const SizedBox(width: 8),
              Pressable(
                semanticLabel: 'How we calculate this',
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AssumptionsScreen())),
                child: Glass(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.info_outline, size: 14, color: Leaf.ink),
                    const SizedBox(width: 6),
                    Text('ESTIMATES', style: mono(11, color: Leaf.ink)),
                  ]),
                ),
              ),
            ]),
          ),
          if (s.error != null)
            Positioned(
              top: 12,
              left: 0,
              right: 0,
              child: Center(
                child: Glass(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  child: Text(s.error!, style: mono(11.5, color: Leaf.warn)),
                ),
              ),
            ),
        ]),
      );
}

class _ZoomBtn extends StatelessWidget {
  const _ZoomBtn(this.icon, this.label, this.onTap);
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: label,
        child: Pressable(
          onTap: onTap,
          scale: 0.85,
          semanticLabel: label,
          child: SizedBox.square(dimension: 42, child: Icon(icon, size: 19, color: Leaf.ink)),
        ),
      );
}

class _Dock extends StatelessWidget {
  const _Dock(this.s);
  final SimState s;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(12, 12, 12, 12 + MediaQuery.paddingOf(context).bottom),
        child: Align(
          heightFactor: 1, // as bottomNavigationBar: take only the dock's own height
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 620),
            child: Glass(
              radius: 30,
              padding: const EdgeInsets.all(6),
              child: Row(children: [
                Expanded(
                  child: PillToggle<Tool>(
                    bare: true,
                    expand: true,
                    options: [for (final t in Tool.values) (t, t.short, t.icon)],
                    value: s.tool,
                    onChanged: s.setTool,
                  ),
                ),
                const SizedBox(width: 6),
                Pill('Ask AI', icon: Icons.auto_awesome, height: 44, onTap: () => showAiSheet(context, s)),
              ]),
            ),
          ),
        ),
      );
}
