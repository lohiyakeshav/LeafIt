import 'dart:async';

import 'package:flutter/foundation.dart';

import 'api.dart';
import 'models.dart';

/// Everything the simulator screen shows. Each edit re-simulates on the backend (debounced).
class SimState extends ChangeNotifier {
  SimState(this.block);

  final Block block;
  List<Placement> placements = [];
  final _history = <List<Placement>>[];
  Tool tool = Tool.tree;
  double budget = 2000000;
  int years = 10;
  bool showAfter = true;
  Map<String, dynamic>? metrics;
  Map<String, dynamic>? breakdown; // inputs behind each metric, for the "how is this calculated" sheets
  List<List<double>>? cooling;
  String? error;
  (int, int)? lastCell;
  int placeTick = 0; // bumps on each placement so the grid can play a ripple

  Timer? _debounce;
  int _seq = 0;
  bool _disposed = false;

  double get cost => (metrics?['total_cost_inr'] as num?)?.toDouble() ?? 0;
  bool get canUndo => _history.isNotEmpty;

  /// Returns a message to show the user, or null on success.
  String? tap(int r, int c) {
    final why = block.whyNot(tool, r, c);
    if (why != null) return why;
    final i = placements.indexWhere((p) => p.row == r && p.col == c && p.type == tool);
    if (i >= 0 && tool != Tool.tree) return '${tool.label} already here';
    if (i >= 0 && placements[i].count >= maxTreesPerCell) return 'Cell is full ($maxTreesPerCell trees)';
    final next = [...placements];
    i >= 0 ? next[i] = Placement(tool, r, c, placements[i].count + 1) : next.add(Placement(tool, r, c));
    lastCell = (r, c);
    placeTick++;
    _commit(next);
    return null;
  }

  bool removeAt(int r, int c) {
    final next = placements.where((p) => p.row != r || p.col != c).toList();
    if (next.length == placements.length) return false;
    _commit(next);
    return true;
  }

  void undo() {
    if (_history.isEmpty) return;
    placements = _history.removeLast();
    _changed();
  }

  void clear() => _commit([]);
  void apply(List<Placement> plan) => _commit(plan);

  void setTool(Tool t) => _set(() => tool = t);
  void setBudget(double b) => _set(() => budget = b);
  void setShowAfter(bool v) => _set(() => showAfter = v);
  void setYears(int y) {
    years = y;
    _changed();
  }

  Map<String, dynamic> request() =>
      {'block_id': block.id, 'placements': [for (final p in placements) p.toJson()], 'years': years};

  Future<void> refresh() async {
    final seq = ++_seq;
    try {
      final res = await api.post('/simulate', request());
      if (seq != _seq || _disposed) return;
      metrics = res['metrics'];
      breakdown = res['breakdown'];
      cooling = grid(res['cooling_grid'], toD);
      error = null;
    } catch (e) {
      if (seq != _seq || _disposed) return;
      error = '$e';
    }
    notifyListeners();
  }

  void _set(VoidCallback f) {
    f();
    notifyListeners();
  }

  void _commit(List<Placement> next) {
    _history.add(placements);
    if (_history.length > 200) _history.removeAt(0);
    placements = next;
    _changed();
  }

  void _changed() {
    notifyListeners();
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 120), refresh);
  }

  @override
  void dispose() {
    _disposed = true;
    _debounce?.cancel();
    super.dispose();
  }
}
