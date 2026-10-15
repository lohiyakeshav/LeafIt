import 'dart:math';
import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme.dart';

/// Motion vocabulary from the portfolio: one soft ease for UI, expo-out for headlines.
/// Everything collapses to instant when the OS asks for reduced motion.
abstract final class Motion {
  static const ease = Cubic(0.2, 0.8, 0.2, 1);
  static const expo = Cubic(0.16, 1, 0.3, 1);
  static const fast = Duration(milliseconds: 220);
  static const med = Duration(milliseconds: 450);
  static const slow = Duration(milliseconds: 900);

  static bool reduced(BuildContext c) => MediaQuery.maybeDisableAnimationsOf(c) ?? false;
}

/// Page transition: new page fades in while rising 4%, the old one dims slightly.
class FadeSlideTransitions extends PageTransitionsBuilder {
  const FadeSlideTransitions();

  @override
  Widget buildTransitions<T>(PageRoute<T> route, BuildContext context, Animation<double> animation,
      Animation<double> secondaryAnimation, Widget child) {
    final inCurve = CurvedAnimation(parent: animation, curve: Motion.ease, reverseCurve: Curves.easeIn);
    return FadeTransition(
      opacity: Tween(begin: 1.0, end: 0.6).animate(secondaryAnimation),
      child: FadeTransition(
        opacity: inCurve,
        child: SlideTransition(position: Tween(begin: const Offset(0, 0.04), end: Offset.zero).animate(inCurve), child: child),
      ),
    );
  }
}

/// Fades and rises into place once, after [delay]. Use increasing delays for a stagger.
class Reveal extends StatefulWidget {
  const Reveal({super.key, required this.child, this.delay = Duration.zero, this.dy = 14, this.duration = const Duration(milliseconds: 700)});
  final Widget child;
  final Duration delay, duration;
  final double dy;

  /// Delay for the i-th item of a list.
  static Duration step(int i, {int ms = 70, int start = 0}) => Duration(milliseconds: start + i * ms);

  @override
  State<Reveal> createState() => _RevealState();
}

class _RevealState extends State<Reveal> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: widget.duration);
  late final _a = CurvedAnimation(parent: _c, curve: Motion.ease);

  @override
  void initState() {
    super.initState();
    Future.delayed(widget.delay, () {
      if (mounted) _c.forward();
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (Motion.reduced(context)) return widget.child;
    return AnimatedBuilder(
      animation: _a,
      child: widget.child,
      builder: (_, child) => Opacity(
        opacity: _a.value,
        child: Transform.translate(offset: Offset(0, widget.dy * (1 - _a.value)), child: child),
      ),
    );
  }
}

/// Headline lines rise from under a mask, one after another (the portfolio's cover entrance).
class MaskReveal extends StatefulWidget {
  const MaskReveal({super.key, required this.lines, this.delay = Duration.zero, this.stagger = 120});
  final List<Widget> lines;
  final Duration delay;
  final int stagger;

  @override
  State<MaskReveal> createState() => _MaskRevealState();
}

class _MaskRevealState extends State<MaskReveal> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(
      vsync: this, duration: Duration(milliseconds: 1100 + widget.stagger * (widget.lines.length - 1)));

  @override
  void initState() {
    super.initState();
    Future.delayed(widget.delay, () {
      if (mounted) _c.forward();
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final total = _c.duration!.inMilliseconds;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < widget.lines.length; i++)
          ClipRect(
            child: Motion.reduced(context)
                ? widget.lines[i]
                : SlideTransition(
                    position: Tween(begin: const Offset(0, 1.1), end: Offset.zero).animate(CurvedAnimation(
                      parent: _c,
                      curve: Interval(i * widget.stagger / total, min(1, (i * widget.stagger + 1100) / total), curve: Motion.expo),
                    )),
                    child: widget.lines[i],
                  ),
          ),
      ],
    );
  }
}

/// Press feedback: a quick scale-down with a light haptic. Wraps any tappable surface.
class Pressable extends StatefulWidget {
  const Pressable({super.key, required this.child, this.onTap, this.onLongPress, this.scale = 0.96, this.semanticLabel});
  final Widget child;
  final VoidCallback? onTap, onLongPress;
  final double scale;
  final String? semanticLabel;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _down = false;

  void _set(bool v) {
    if (widget.onTap != null && v != _down) setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.semanticLabel,
      child: MouseRegion(
        cursor: enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapDown: (_) => _set(true),
          onTapUp: (_) => _set(false),
          onTapCancel: () => _set(false),
          onTap: enabled
              ? () {
                  HapticFeedback.lightImpact();
                  widget.onTap!();
                }
              : null,
          onLongPress: widget.onLongPress,
          child: AnimatedScale(
            scale: _down ? widget.scale : 1,
            duration: Motion.fast,
            curve: Motion.ease,
            child: AnimatedOpacity(opacity: enabled ? 1 : 0.4, duration: Motion.fast, child: widget.child),
          ),
        ),
      ),
    );
  }
}

/// A number that animates to its new value, so every edit visibly moves the metrics.
class AnimatedValue extends StatelessWidget {
  const AnimatedValue(this.value, this.format, {super.key, this.style});
  final double value;
  final String Function(double) format;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
        tween: Tween(end: value),
        duration: Motion.reduced(context) ? Duration.zero : const Duration(milliseconds: 650),
        curve: Motion.ease,
        builder: (_, v, _) => Text(format(v), style: style, maxLines: 1, softWrap: false, overflow: TextOverflow.visible),
      );
}

/// A hand-drawn arrow that draws itself in (the portfolio's SVG path draw).
class DrawnArrow extends StatefulWidget {
  const DrawnArrow({super.key, this.size = const Size(90, 56), this.delay = const Duration(milliseconds: 600), this.flip = false});
  final Size size;
  final Duration delay;
  final bool flip; // points left/down instead of right/down

  @override
  State<DrawnArrow> createState() => _DrawnArrowState();
}

class _DrawnArrowState extends State<DrawnArrow> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 900));

  @override
  void initState() {
    super.initState();
    Future.delayed(widget.delay, () {
      if (mounted) _c.forward();
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Transform.flip(
        flipX: widget.flip,
        child: CustomPaint(
          size: widget.size,
          painter: _ArrowPainter(Motion.reduced(context) ? const AlwaysStoppedAnimation(1.0) : CurvedAnimation(parent: _c, curve: Curves.easeInOut)),
        ),
      );
}

class _ArrowPainter extends CustomPainter {
  _ArrowPainter(this.t) : super(repaint: t);
  final Animation<double> t;

  @override
  void paint(Canvas canvas, Size s) {
    final shaft = Path()
      ..moveTo(s.width * 0.05, s.height * 0.12)
      ..cubicTo(s.width * 0.45, s.height * 0.1, s.width * 0.75, s.height * 0.35, s.width * 0.88, s.height * 0.86);
    final head = Path()
      ..moveTo(s.width * 0.7, s.height * 0.78)
      ..lineTo(s.width * 0.89, s.height * 0.9)
      ..lineTo(s.width * 0.96, s.height * 0.66);
    final paint = Paint()
      ..color = Leaf.accent
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    _partial(canvas, shaft, (t.value / 0.75).clamp(0, 1), paint);
    _partial(canvas, head, ((t.value - 0.75) / 0.25).clamp(0, 1), paint);
  }

  void _partial(Canvas canvas, Path p, double f, Paint paint) {
    if (f <= 0) return;
    for (final PathMetric m in p.computeMetrics()) {
      canvas.drawPath(m.extractPath(0, m.length * f), paint);
    }
  }

  @override
  bool shouldRepaint(_ArrowPainter old) => false;
}
