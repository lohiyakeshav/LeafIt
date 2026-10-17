import 'dart:math';

import 'package:flutter/material.dart';

const maxTreesPerCell = 10; // same as backend sim.MAX_TREES_PER_CELL

enum Tool {
  tree('tree', 'Tree', 'Tree', Icons.park_outlined),
  coolRoof('cool_roof', 'Cool roof', 'Roof', Icons.roofing_outlined),
  shadeStop('shade_stop', 'Shaded stop', 'Shade', Icons.directions_bus_outlined);

  const Tool(this.api, this.label, this.short, this.icon);
  final String api, label, short; // short fits the phone dock
  final IconData icon;

  static Tool from(String s) => values.firstWhere((t) => t.api == s);
}

class Placement {
  const Placement(this.type, this.row, this.col, [this.count = 1]);
  final Tool type;
  final int row, col, count;

  factory Placement.fromJson(Map j) => Placement(Tool.from(j['type']), j['row'], j['col'], j['count'] ?? 1);
  Map<String, dynamic> toJson() => {'type': type.api, 'row': row, 'col': col, 'count': count};
}

List<List<T>> grid<T>(dynamic g, T Function(dynamic) f) => [
      for (final r in g as List) [for (final v in r as List) f(v)]
    ];
double toD(dynamic v) => (v as num).toDouble();

/// Cached block from GET /blocks/{id}. Row 0 = north edge, col 0 = west edge.
class Block {
  Block.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        name = j['name'],
        synthetic = j['synthetic'] == true,
        rows = j['rows'],
        cols = j['cols'],
        classes = List<String>.from(j['landcover_classes']),
        landcover = grid(j['landcover'], (v) => v as int),
        lst = grid(j['lst_c'], toD),
        buildingFrac = grid(j['building_frac'], toD),
        roofArea = grid(j['roof_area_m2'], toD),
        landmarks = [for (final l in j['landmarks'] ?? const []) (name: l['name'] as String, row: l['row'] as int, col: l['col'] as int)] {
    final all = lst.expand((r) => r);
    minT = all.reduce(min);
    maxT = all.reduce(max);
  }

  final String id, name;
  final bool synthetic;
  final int rows, cols;
  final List<String> classes;
  final List<List<int>> landcover;
  final List<List<double>> lst, buildingFrac, roofArea;
  final List<({String name, int row, int col})> landmarks;
  late final double minT, maxT;

  /// Mirrors the backend's placement rules for instant feedback; the backend stays authoritative.
  String? whyNot(Tool t, int r, int c) => switch (t) {
        Tool.tree when buildingFrac[r][c] >= 0.5 || classes[landcover[r][c]] == 'water' => 'No room for a tree here',
        Tool.coolRoof when roofArea[r][c] <= 0 => 'No roof in this cell',
        Tool.shadeStop when classes[landcover[r][c]] != 'road' => 'Bus stops go on roads',
        _ => null,
      };
}
