import 'dart:async';
import 'dart:math';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../models.dart';
import '../state.dart';
import '../ui/theme.dart';

/// Which cell a point inside the grid falls in, or null if outside.
(int, int)? cellAt(Offset p, Size s, int rows, int cols) {
  if (p.dx < 0 || p.dy < 0 || p.dx >= s.width || p.dy >= s.height) return null;
  return ((p.dy / s.height * rows).floor(), (p.dx / s.width * cols).floor());
}

const glowColor = Leaf.cool;
const heatStops = [Color(0xFF2C7BB6), Color(0xFFABD9E9), Color(0xFFFFFFBF), Color(0xFFFDAE61), Color(0xFFD7191C)];

Color heatColor(double t) {
  final x = t.clamp(0.0, 1.0) * (heatStops.length - 1);
  final i = x.floor().clamp(0, heatStops.length - 2);
  return Color.lerp(heatStops[i], heatStops[i + 1], x - i)!;
}

/// Heat + building shade + cooling glow as one RGBA pixel per cell.
/// Drawn as a single scaled image instead of thousands of rects.
Future<ui.Image> heatImage(Block b, List<List<double>>? cooling) {
  final px = Uint8List(b.rows * b.cols * 4);
  final span = max(b.maxT - b.minT, 0.1);
  for (var r = 0; r < b.rows; r++) {
    for (var c = 0; c < b.cols; c++) {
      final cool = cooling?[r][c] ?? 0;
      var color = heatColor((b.lst[r][c] - cool - b.minT) / span);
      final bf = b.buildingFrac[r][c];
      if (bf > 0) color = Color.alphaBlend(Colors.black.withValues(alpha: 0.3 * bf), color);
      // Small °C changes vanish on a 10 °C scale, so cooling also gets a cyan glow.
      if (cool > 0.03) color = Color.alphaBlend(glowColor.withValues(alpha: min(0.75, 0.15 + cool * 0.35)), color);
      final argb = color.toARGB32(), i = (r * b.cols + c) * 4;
      px[i] = (argb >> 16) & 0xFF;
      px[i + 1] = (argb >> 8) & 0xFF;
      px[i + 2] = argb & 0xFF;
      px[i + 3] = 0xFF;
    }
  }
  final done = Completer<ui.Image>();
  ui.decodeImageFromPixels(px, b.cols, b.rows, ui.PixelFormat.rgba8888, done.complete);
  return done.future;
}

/// The block's digital twin. Four layers, each repainting only when its own input changes:
/// heat image (new simulation result) · items (placements) · landmarks (never) · ripple (animation).
class HeatGrid extends StatefulWidget {
  const HeatGrid({super.key, required this.state, this.showAfter, this.onTap, this.onLongPress, this.zoom});
  final SimState state;
  final ValueListenable<Matrix4>? zoom; // the enclosing InteractiveViewer's transform; keeps labels a constant size
  final bool? showAfter; // null = follow state.showAfter
  final void Function(int r, int c)? onTap, onLongPress;

  @override
  State<HeatGrid> createState() => _HeatGridState();
}

class _HeatGridState extends State<HeatGrid> with TickerProviderStateMixin {
  late final _ripple = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));
  // new heat images fade in over the old one instead of popping
  late final _fade = AnimationController(vsync: this, duration: const Duration(milliseconds: 320), value: 1);
  ui.Image? _prev;
  int _tick = 0;
  ui.Image? _image;
  Object? _imageKey; // (cooling grid identity, after) the image was built for
  int _imageSeq = 0;

  SimState get s => widget.state;
  bool get _after => widget.showAfter ?? s.showAfter;

  @override
  void initState() {
    super.initState();
    _tick = s.placeTick;
    s.addListener(_onState);
    _refreshImage();
  }

  @override
  void didUpdateWidget(HeatGrid old) {
    super.didUpdateWidget(old);
    _refreshImage();
  }

  void _onState() {
    if (s.placeTick != _tick) {
      _tick = s.placeTick;
      _ripple.forward(from: 0);
    }
    _refreshImage();
  }

  void _refreshImage() {
    final cooling = _after ? s.cooling : null;
    final key = (identityHashCode(cooling), _after);
    if (key == _imageKey) return;
    _imageKey = key;
    final seq = ++_imageSeq;
    heatImage(s.block, cooling).then((img) {
      if (!mounted || seq != _imageSeq) return img.dispose();
      setState(() {
        _prev?.dispose();
        _prev = _image; // kept until the fade finishes
        _image = img;
      });
      _fade.forward(from: _prev == null ? 1 : 0).whenComplete(() {
        if (!mounted || _fade.value < 1) return;
        _prev?.dispose();
        _prev = null;
      });
    });
  }

  @override
  void dispose() {
    s.removeListener(_onState);
    _ripple.dispose();
    _fade.dispose();
    _image?.dispose();
    _prev?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final b = s.block;
    return AspectRatio(
      aspectRatio: b.cols / b.rows,
      child: LayoutBuilder(builder: (context, box) {
        void hit(Offset p, void Function(int, int)? f) {
          final cell = cellAt(p, box.biggest, b.rows, b.cols);
          if (cell != null) f?.call(cell.$1, cell.$2);
        }

        Widget layer(CustomPainter p) => RepaintBoundary(child: CustomPaint(size: box.biggest, painter: p));
        return Semantics(
          label: 'Heat map of ${b.name}. Tap a cell to place the selected intervention, long-press to remove.',
          child: GestureDetector(
            onTapUp: (d) => hit(d.localPosition, widget.onTap),
            onLongPressStart: (d) => hit(d.localPosition, widget.onLongPress),
            child: Stack(children: [
              layer(_ImagePainter(_image, _prev, _fade)),
              layer(_ItemsPainter(b, _after ? s.placements : const [])),
              layer(_LandmarksPainter(b, widget.zoom)),
              layer(_RipplePainter(b, s.lastCell, _ripple)),
            ]),
          ),
        );
      }),
    );
  }
}

class _ImagePainter extends CustomPainter {
  _ImagePainter(this.image, this.prev, this.fade) : super(repaint: fade);
  final ui.Image? image, prev;
  final Animation<double> fade;

  @override
  void paint(Canvas canvas, Size size) {
    void draw(ui.Image img, double opacity) => canvas.drawImageRect(
        img,
        Rect.fromLTWH(0, 0, img.width.toDouble(), img.height.toDouble()),
        Offset.zero & size,
        Paint()
          ..filterQuality = FilterQuality.none // crisp 10 m cells
          ..color = Color.fromRGBO(0, 0, 0, opacity));
    final p = prev, img = image;
    if (p != null && fade.value < 1) draw(p, 1);
    if (img != null) draw(img, p == null ? 1 : Curves.easeOut.transform(fade.value));
  }

  @override
  bool shouldRepaint(_ImagePainter old) => old.image != image || old.prev != prev;
}

class _ItemsPainter extends CustomPainter {
  _ItemsPainter(this.b, this.placements);
  final Block b;
  final List<Placement> placements;

  @override
  void paint(Canvas canvas, Size size) {
    final cw = size.width / b.cols, ch = size.height / b.rows, unit = min(cw, ch);
    final tree = Paint()..color = Leaf.accent;
    final outline = Paint()
      ..color = Leaf.page
      ..style = PaintingStyle.stroke
      ..strokeWidth = max(1, unit * 0.1);
    final roof = Paint()
      ..color = Leaf.ink
      ..style = PaintingStyle.stroke
      ..strokeWidth = max(1.2, unit * 0.12);
    final stop = Paint()..color = Leaf.cool;
    for (final p in placements) {
      final rect = Rect.fromLTWH(p.col * cw, p.row * ch, cw, ch);
      switch (p.type) {
        case Tool.tree:
          final rad = unit * min(0.5, 0.28 + 0.03 * p.count);
          canvas.drawCircle(rect.center, rad, tree);
          canvas.drawCircle(rect.center, rad, outline);
        case Tool.coolRoof:
          canvas.drawRect(rect.deflate(unit * 0.14), roof);
        case Tool.shadeStop:
          canvas.drawRect(rect.deflate(unit * 0.15), stop);
          canvas.drawRect(rect.deflate(unit * 0.15), outline);
      }
    }
  }

  @override
  bool shouldRepaint(_ItemsPainter old) => !identical(old.placements, placements); // SimState swaps lists on edit
}

class _LandmarksPainter extends CustomPainter {
  _LandmarksPainter(this.b, this.zoom) : super(repaint: zoom);
  final Block b;
  final ValueListenable<Matrix4>? zoom;

  @override
  void paint(Canvas canvas, Size size) {
    final cw = size.width / b.cols, ch = size.height / b.rows, unit = min(cw, ch);
    // Every size is divided by the zoom, so labels stay the same size on screen while the map zooms under them.
    final z = zoom?.value.getMaxScaleOnAxis() ?? 1;
    final r = max(3.5, unit * 0.45) / z;
    final dot = Paint()..color = Leaf.ink;
    final ring = Paint()
      ..color = Leaf.page
      ..style = PaintingStyle.stroke
      ..strokeWidth = max(1.5, unit * 0.15) / z;
    final label = Paint()..color = Leaf.page.withValues(alpha: 0.82);
    for (final l in b.landmarks) {
      final at = Offset((l.col + 0.5) * cw, (l.row + 0.5) * ch);
      canvas.drawCircle(at, r, dot);
      canvas.drawCircle(at, r, ring);
      final tp = TextPainter(
        text: TextSpan(text: l.name, style: mono(max(9.5, unit * 0.95) / z, color: Leaf.ink, w: 500)),
        textDirection: TextDirection.ltr,
      )..layout();
      final gap = max(6.0, unit * 0.9) / z, padX = 6 / z, padY = 3 / z, w = tp.width + 2 * padX;
      final right = at.dx + gap + w <= size.width; // flip to the left of the dot near the right edge
      final box = Rect.fromLTWH(right ? at.dx + gap : at.dx - gap - w, at.dy - tp.height / 2 - padY, w, tp.height + 2 * padY);
      canvas.drawRRect(RRect.fromRectAndRadius(box, Radius.circular(box.height / 2)), label);
      tp.paint(canvas, box.topLeft + Offset(padX, padY));
      tp.dispose();
    }
  }

  @override
  bool shouldRepaint(_LandmarksPainter old) => old.b != b || old.zoom != zoom;
}

class _RipplePainter extends CustomPainter {
  _RipplePainter(this.b, this.cell, this.anim) : super(repaint: anim);
  final Block b;
  final (int, int)? cell;
  final Animation<double> anim;

  @override
  void paint(Canvas canvas, Size size) {
    final c = cell, v = anim.value;
    if (c == null || v <= 0 || v >= 1) return;
    final cw = size.width / b.cols, ch = size.height / b.rows;
    canvas.drawCircle(
      Offset((c.$2 + 0.5) * cw, (c.$1 + 0.5) * ch),
      min(cw, ch) * 5 * v,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5
        ..color = Leaf.accent.withValues(alpha: 1 - v),
    );
  }

  @override
  bool shouldRepaint(_RipplePainter old) => old.cell != cell;
}

/// Colour key for the heat map: "36° ▬▬▬ 46° surface".
class HeatLegend extends StatelessWidget {
  const HeatLegend({super.key, required this.min, required this.max, this.barWidth});
  final double min, max;
  final double? barWidth; // null = fill the row

  @override
  Widget build(BuildContext context) {
    final bar = Container(
      height: 6,
      width: barWidth,
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(3), gradient: const LinearGradient(colors: heatStops)),
    );
    return Row(mainAxisSize: barWidth == null ? MainAxisSize.max : MainAxisSize.min, children: [
      Text('${min.toStringAsFixed(0)}°', style: mono(11, color: Leaf.ink)),
      const SizedBox(width: 8),
      barWidth == null ? Expanded(child: bar) : Flexible(child: bar),
      const SizedBox(width: 8),
      Flexible(
        flex: 2,
        child: Text('${max.toStringAsFixed(0)}° surface', maxLines: 1, overflow: TextOverflow.clip, softWrap: false, style: mono(11, color: Leaf.ink)),
      ),
    ]);
  }
}
