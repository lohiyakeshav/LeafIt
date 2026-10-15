import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'motion.dart';
import 'theme.dart';

/// Mono label with a breathing accent dot: "● 01 — Choose a block".
class Kicker extends StatelessWidget {
  const Kicker(this.text, {super.key, this.dot = true, this.color = Leaf.muted});
  final String text;
  final bool dot;
  final Color color;

  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        if (dot) ...[const PulseDot(), const SizedBox(width: 10)],
        Flexible(child: Text(text, style: mono(11.5, color: color))),
      ]);
}

class PulseDot extends StatefulWidget {
  const PulseDot({super.key, this.color = Leaf.accent, this.size = 7});
  final Color color;
  final double size;

  @override
  State<PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<PulseDot> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dot = Container(width: widget.size, height: widget.size, decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle));
    if (Motion.reduced(context)) return dot;
    return SizedBox.square(
      dimension: widget.size,
      child: Stack(clipBehavior: Clip.none, alignment: Alignment.center, children: [
        AnimatedBuilder(
          animation: _c,
          builder: (_, _) => Transform.scale(
            scale: 1 + _c.value * 1.6,
            child: Opacity(opacity: (1 - _c.value) * 0.5, child: dot),
          ),
        ),
        dot,
      ]),
    );
  }
}

/// Sans headline with one word set in italic serif accent, e.g. "Cool the *block*."
class AccentText extends StatelessWidget {
  const AccentText(this.text, {super.key, this.accent, required this.style, this.color = Leaf.accent, this.textAlign});
  final String text;
  final String? accent;
  final TextStyle style;
  final Color color;
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) {
    final a = accent;
    if (a == null || !text.contains(a)) return Text(text, style: style, textAlign: textAlign);
    final i = text.indexOf(a);
    final size = (style.fontSize ?? 16) * 1.12; // serif italic reads smaller than Geist at the same size
    return Text.rich(
      TextSpan(style: style, children: [
        TextSpan(text: text.substring(0, i)),
        TextSpan(text: a, style: serif(size, color: color, italic: true, height: style.height ?? 1)),
        TextSpan(text: text.substring(i + a.length)),
      ]),
      textAlign: textAlign,
    );
  }
}

enum PillKind { solid, outline, ghost }

/// The one button shape in the app: a pill with press feedback.
class Pill extends StatelessWidget {
  const Pill(this.label,
      {super.key, this.icon, this.onTap, this.kind = PillKind.solid, this.loading = false, this.dense = false, this.expand = false, this.height});
  final String label;
  final IconData? icon;
  final VoidCallback? onTap;
  final PillKind kind;
  final bool loading, dense, expand;
  final double? height;

  @override
  Widget build(BuildContext context) {
    final solid = kind == PillKind.solid;
    final fg = solid ? Leaf.onAccent : Leaf.ink;
    return Pressable(
      onTap: loading ? null : onTap,
      semanticLabel: label,
      child: AnimatedContainer(
        duration: Motion.fast,
        curve: Motion.ease,
        height: height ?? (dense ? 38 : 48),
        padding: EdgeInsets.symmetric(horizontal: dense ? 14 : 20),
        decoration: ShapeDecoration(
          color: solid ? Leaf.accent : (kind == PillKind.outline ? Colors.transparent : Leaf.surfaceHi),
          shape: StadiumBorder(side: kind == PillKind.outline ? const BorderSide(color: Leaf.rule) : BorderSide.none),
        ),
        child: Row(
          mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedSwitcher(
              duration: Motion.fast,
              child: loading
                  ? SizedBox.square(key: const ValueKey('l'), dimension: 16, child: CircularProgressIndicator(strokeWidth: 2, color: fg))
                  : icon == null
                      ? const SizedBox.shrink()
                      : Icon(icon, key: ValueKey(icon), size: dense ? 16 : 18, color: fg),
            ),
            if (loading || icon != null) SizedBox(width: dense ? 6 : 8),
            Flexible(
              child: Text(label,
                  overflow: TextOverflow.ellipsis,
                  style: geist(dense ? 13 : 14.5, w: 550, color: fg, tracking: -0.01)),
            ),
          ],
        ),
      ),
    );
  }
}

/// 40 px round icon button with a hairline ring.
class CircleBtn extends StatelessWidget {
  const CircleBtn(this.icon, {super.key, required this.tooltip, this.onTap, this.filled = false});
  final IconData icon;
  final String tooltip;
  final VoidCallback? onTap;
  final bool filled;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: tooltip,
        child: Pressable(
          onTap: onTap,
          semanticLabel: tooltip,
          scale: 0.9,
          child: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: filled ? Leaf.accent : Colors.transparent,
              border: Border.all(color: filled ? Leaf.accent : Leaf.rule),
            ),
            child: Icon(icon, size: 18, color: filled ? Leaf.onAccent : Leaf.ink),
          ),
        ),
      );
}

/// Segmented pill with an accent thumb that slides between options.
class PillToggle<T> extends StatelessWidget {
  const PillToggle(
      {super.key, required this.options, required this.value, required this.onChanged, this.dense = false, this.expand = false, this.bare = false});
  final List<(T, String, IconData?)> options;
  final T value;
  final ValueChanged<T> onChanged;
  final bool dense, expand;
  final bool bare; // no track of its own (inside a Glass bar)

  @override
  Widget build(BuildContext context) {
    final style = dense ? mono(11.5, color: Leaf.ink, w: 500) : geist(13.5, w: 550);
    final iconW = options.any((o) => o.$3 != null) ? (dense ? 20.0 : 22.0) : 0.0;
    final pad = dense ? 24.0 : 32.0;
    double textW(String s) => (TextPainter(text: TextSpan(text: s, style: style), textDirection: TextDirection.ltr, textScaler: MediaQuery.textScalerOf(context))..layout()).width;
    final natural = options.map((o) => textW(o.$2)).reduce((a, b) => a > b ? a : b) + iconW + pad;
    final h = dense ? 34.0 : 44.0;
    final index = options.indexWhere((o) => o.$1 == value);

    return LayoutBuilder(builder: (context, box) {
      final chrome = 6 + (bare ? 0 : 2); // padding + 1 px border each side
      final segW = expand && box.hasBoundedWidth ? (box.maxWidth - chrome) / options.length : natural;
      return Container(
        height: h,
        width: segW * options.length + chrome,
        padding: const EdgeInsets.all(3),
        decoration: bare ? null : const ShapeDecoration(color: Leaf.sunk, shape: StadiumBorder(side: BorderSide(color: Leaf.rule))),
        child: Stack(children: [
          AnimatedPositioned(
            duration: Motion.reduced(context) ? Duration.zero : Motion.med,
            curve: Motion.ease,
            left: segW * index,
            top: 0,
            bottom: 0,
            width: segW,
            child: const DecoratedBox(decoration: ShapeDecoration(color: Leaf.accent, shape: StadiumBorder())),
          ),
          Row(children: [
            for (final o in options)
              SizedBox(
                width: segW,
                child: Semantics(
                  button: true,
                  selected: o.$1 == value,
                  label: o.$2,
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () {
                      if (o.$1 == value) return;
                      HapticFeedback.selectionClick();
                      onChanged(o.$1);
                    },
                    child: TweenAnimationBuilder<Color?>(
                      tween: ColorTween(end: o.$1 == value ? Leaf.onAccent : Leaf.ink),
                      duration: Motion.fast,
                      builder: (_, c, _) => Center(
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          if (o.$3 != null) ...[Icon(o.$3, size: dense ? 14 : 16, color: c), const SizedBox(width: 6)],
                          Flexible(child: Text(o.$2, maxLines: 1, overflow: TextOverflow.fade, softWrap: false, style: style.copyWith(color: c))),
                        ]),
                      ),
                    ),
                  ),
                ),
              ),
          ]),
        ]),
      );
    });
  }
}

/// Frosted bar that floats over the map.
class Glass extends StatelessWidget {
  const Glass({super.key, required this.child, this.radius = 999, this.padding = EdgeInsets.zero});
  final Widget child;
  final double radius;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: 14, sigmaY: 14),
          child: Container(
            padding: padding,
            decoration: BoxDecoration(
              color: Leaf.page.withValues(alpha: 0.72),
              borderRadius: BorderRadius.circular(radius),
              border: Border.all(color: Leaf.rule),
            ),
            child: child,
          ),
        ),
      );
}

/// Editorial stat: mono label over a big tight number that counts to its value.
class Stat extends StatelessWidget {
  const Stat(this.label, this.value, this.format, {super.key, this.color = Leaf.ink, this.size = 26});
  final String label;
  final double value, size;
  final String Function(double) format;
  final Color color;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(label, style: mono(11)),
        const SizedBox(height: 6),
        AnimatedValue(value, format, style: geist(size, w: 600, color: color, height: 1, tracking: -0.045)),
      ]);
}

class VRule extends StatelessWidget {
  const VRule({super.key, this.height = 40});
  final double height;
  @override
  Widget build(BuildContext context) => Container(width: 1, height: height, color: Leaf.rule);
}

/// Numbered index row with an accent arrow that turns to point at its target on press/hover.
class IndexRow extends StatefulWidget {
  const IndexRow({super.key, required this.no, required this.title, this.meta, this.trailing, this.onTap, this.busy = false});
  final String no, title;
  final String? meta;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool busy;

  @override
  State<IndexRow> createState() => _IndexRowState();
}

class _IndexRowState extends State<IndexRow> {
  bool _hot = false;

  @override
  Widget build(BuildContext context) => MouseRegion(
        onEnter: (_) => setState(() => _hot = true),
        onExit: (_) => setState(() => _hot = false),
        child: Listener(
          onPointerDown: (_) => setState(() => _hot = true),
          onPointerUp: (_) => setState(() => _hot = false),
          onPointerCancel: (_) => setState(() => _hot = false),
          child: Pressable(
            onTap: widget.onTap,
            scale: 0.985,
            semanticLabel: widget.title,
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 18),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Leaf.rule))),
              child: Row(children: [
                SizedBox(width: 40, child: Text(widget.no, style: mono(12))),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    AnimatedDefaultTextStyle(
                      duration: Motion.fast,
                      style: geist(21, w: 600, tracking: -0.03, color: _hot ? Leaf.accent : Leaf.ink, height: 1.15),
                      child: Text(widget.title),
                    ),
                    if (widget.meta != null) ...[const SizedBox(height: 4), Text(widget.meta!, style: mono(11.5))],
                  ]),
                ),
                const SizedBox(width: 12),
                widget.trailing ??
                    AnimatedRotation(
                      turns: _hot ? 0 : -0.125,
                      duration: const Duration(milliseconds: 400),
                      curve: Motion.ease,
                      child: AnimatedScale(
                        scale: _hot ? 1 : 0.85,
                        duration: const Duration(milliseconds: 400),
                        curve: Motion.ease,
                        child: Container(
                          width: 40,
                          height: 40,
                          decoration: const BoxDecoration(color: Leaf.accent, shape: BoxShape.circle),
                          child: widget.busy
                              ? const Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator(strokeWidth: 2, color: Leaf.onAccent))
                              : const Icon(Icons.arrow_forward, size: 18, color: Leaf.onAccent),
                        ),
                      ),
                    ),
              ]),
            ),
          ),
        ),
      );
}

/// Handwritten margin note with a self-drawing arrow.
class HandNote extends StatelessWidget {
  const HandNote(this.text, {super.key, this.angle = -0.07, this.arrow = true, this.size = 22, this.pointBack = false});
  final String text;
  final double angle, size;
  final bool arrow;
  final bool pointBack; // arrow sits before the text and points up-left, at what's above

  @override
  Widget build(BuildContext context) => Reveal(
        delay: const Duration(milliseconds: 900),
        child: Transform.rotate(
          angle: angle,
          child: Row(mainAxisSize: MainAxisSize.min, crossAxisAlignment: pointBack ? CrossAxisAlignment.start : CrossAxisAlignment.end, children: [
            if (arrow && pointBack) ...[
              Transform.rotate(angle: 3.1416, child: const DrawnArrow(delay: Duration(milliseconds: 1200), size: Size(64, 44))),
              const SizedBox(width: 6),
            ],
            Padding(padding: EdgeInsets.only(top: pointBack ? 26 : 0), child: Text(text, style: hand(size))),
            if (arrow && !pointBack) ...[const SizedBox(width: 4), const DrawnArrow(delay: Duration(milliseconds: 1200))],
          ]),
        ),
      );
}

/// Endless drifting band of words, alternating solid and outlined italic serif.
class Marquee extends StatefulWidget {
  const Marquee(this.words, {super.key, this.size = 44, this.seconds = 38});
  final List<String> words;
  final double size;
  final int seconds;

  @override
  State<Marquee> createState() => _MarqueeState();
}

class _MarqueeState extends State<Marquee> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: Duration(seconds: widget.seconds))..repeat();
  late final TextPainter _tp = TextPainter(
    textDirection: TextDirection.ltr,
    text: TextSpan(children: [
      for (var i = 0; i < widget.words.length; i++)
        TextSpan(
          text: '${widget.words[i]} — ',
          style: i.isOdd
              ? serif(widget.size, italic: true).copyWith(
                  color: null,
                  foreground: Paint()
                    ..style = PaintingStyle.stroke
                    ..strokeWidth = 1
                    ..color = Leaf.ink.withValues(alpha: 0.7))
              : serif(widget.size, color: Leaf.ink.withValues(alpha: 0.85)),
        ),
    ]),
  )..layout();

  @override
  void dispose() {
    _c.dispose();
    _tp.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: ClipRect(
          child: SizedBox(
            height: _tp.height + 4,
            width: double.infinity,
            child: RepaintBoundary(
              child: CustomPaint(painter: _MarqueePainter(_tp, Motion.reduced(context) ? const AlwaysStoppedAnimation(0.0) : _c)),
            ),
          ),
        ),
      );
}

class _MarqueePainter extends CustomPainter {
  _MarqueePainter(this.tp, this.t) : super(repaint: t);
  final TextPainter tp;
  final Animation<double> t;

  @override
  void paint(Canvas canvas, Size size) {
    final w = tp.width;
    for (var x = -t.value * w; x < size.width; x += w) {
      tp.paint(canvas, Offset(x, 2));
    }
  }

  @override
  bool shouldRepaint(_MarqueePainter old) => false;
}

/// "- point" lines rendered as an editorial list with accent dashes, revealed one by one.
class Bullets extends StatelessWidget {
  const Bullets(this.text, {super.key, this.color = Leaf.inkSoft});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final lines = text
        .split('\n')
        .map((l) => l.trim())
        .where((l) => l.isNotEmpty)
        .map((l) => l.replaceFirst(RegExp(r'^([-•*]|\d+\.)\s*'), '').replaceAll('**', ''))
        .toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (var i = 0; i < lines.length; i++)
        Reveal(
          delay: Reveal.step(i, ms: 90),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Padding(padding: const EdgeInsets.only(top: 3), child: Text('—', style: mono(13, color: Leaf.accent))),
              const SizedBox(width: 12),
              Expanded(child: Text(lines[i], style: geist(15, color: color, height: 1.55))),
            ]),
          ),
        ),
    ]);
  }
}

/// Drag a divider across two views: today on the left, with the plan on the right.
/// Opens with a short sweep so people discover it can be dragged.
class CompareSlider extends StatefulWidget {
  const CompareSlider({super.key, required this.before, required this.after, this.beforeLabel = 'TODAY', this.afterLabel = 'WITH PLAN'});
  final Widget before, after;
  final String beforeLabel, afterLabel;

  @override
  State<CompareSlider> createState() => _CompareSliderState();
}

class _CompareSliderState extends State<CompareSlider> with SingleTickerProviderStateMixin {
  late final _intro = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));
  double? _drag; // null while the intro owns the position

  @override
  void initState() {
    super.initState();
    Future.delayed(const Duration(milliseconds: 400), () {
      if (mounted) _intro.forward();
    });
  }

  @override
  void dispose() {
    _intro.dispose();
    super.dispose();
  }

  double get _f => _drag ?? (1 - 0.5 * Motion.ease.transform(_intro.value)); // 1.0 → 0.5

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final w = box.maxWidth;
        void set(double dx) => setState(() => _drag = (dx / w).clamp(0.0, 1.0));
        return GestureDetector(
          onHorizontalDragStart: (d) => set(d.localPosition.dx),
          onHorizontalDragUpdate: (d) => set(d.localPosition.dx),
          onTapDown: (d) => set(d.localPosition.dx),
          child: AnimatedBuilder(
            animation: _intro,
            builder: (context, _) {
              final x = _f * w;
              return Stack(children: [
                widget.before,
                ClipRect(clipper: _FromX(x), child: widget.after),
                Positioned(left: x - 1, top: 0, bottom: 0, child: Container(width: 2, color: Leaf.ink)),
                Positioned(
                  left: x - 20,
                  top: 0,
                  bottom: 0,
                  child: Center(
                    child: Container(
                      width: 40,
                      height: 40,
                      decoration: const BoxDecoration(color: Leaf.ink, shape: BoxShape.circle, boxShadow: Leaf.shadow),
                      child: const Icon(Icons.code, size: 18, color: Leaf.page, semanticLabel: 'Drag to compare'),
                    ),
                  ),
                ),
                Positioned(left: 10, top: 10, child: _Tag(widget.beforeLabel)),
                Positioned(right: 10, top: 10, child: _Tag(widget.afterLabel, accent: true)),
              ]);
            },
          ),
        );
      });
}

class _FromX extends CustomClipper<Rect> {
  _FromX(this.x);
  final double x;
  @override
  Rect getClip(Size size) => Rect.fromLTRB(x, 0, size.width, size.height);
  @override
  bool shouldReclip(_FromX old) => old.x != x;
}

class _Tag extends StatelessWidget {
  const _Tag(this.text, {this.accent = false});
  final String text;
  final bool accent;
  @override
  Widget build(BuildContext context) => Glass(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        child: Text(text, style: mono(10.5, color: accent ? Leaf.accent : Leaf.ink, w: 500)),
      );
}

/// Section opener: kicker + accent headline, both revealed.
class SectionHead extends StatelessWidget {
  const SectionHead({super.key, required this.kicker, required this.title, this.accent, this.sub, this.size = 34});
  final String kicker, title;
  final String? accent, sub;
  final double size;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Reveal(child: Kicker(kicker)),
        const SizedBox(height: 14),
        Reveal(
          delay: const Duration(milliseconds: 80),
          child: AccentText(title, accent: accent, style: geist(size, w: 600, height: 1.02, tracking: -0.045)),
        ),
        if (sub != null) ...[
          const SizedBox(height: 10),
          Reveal(delay: const Duration(milliseconds: 160), child: Text(sub!, style: Theme.of(context).textTheme.bodyMedium)),
        ],
      ]);
}

/// Compact pill toast, as wide as its text. [lift] raises it above on-screen controls (e.g. the map legend).
void toast(BuildContext context, String msg, {double lift = 0, SnackBarAction? action, Duration duration = const Duration(seconds: 2)}) {
  final style = geist(13, w: 500, color: Leaf.page);
  final textW = (TextPainter(text: TextSpan(text: msg, style: style), textDirection: TextDirection.ltr, maxLines: 1)..layout()).width;
  final screenW = MediaQuery.sizeOf(context).width;
  final w = (textW + 36 + (action == null ? 0 : 84)).clamp(0.0, screenW - 2 * Leaf.gutter);
  final side = (screenW - w) / 2;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(msg, style: style, textAlign: action == null ? TextAlign.center : TextAlign.start),
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 2),
      margin: EdgeInsets.fromLTRB(side, 0, side, 12 + lift),
      action: action,
      duration: duration,
    ));
}
