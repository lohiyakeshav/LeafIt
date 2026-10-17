import 'package:flutter/material.dart';

import 'motion.dart';

/// LeafIt palette: the portfolio's "charcoal, bone, one accent", with leaf green as the one accent.
/// Dark by design (an editorial look); all text pairs pass WCAG AA on [page].
abstract final class Leaf {
  static const page = Color(0xFF141815); // charcoal with a green cast
  static const surface = Color(0xFF1B201C); // cards, sheets
  static const surfaceHi = Color(0xFF222823); // raised / pressed
  static const sunk = Color(0xFF0E110F); // inputs, wells
  static const ink = Color(0xFFE8EDE3); // bone
  static const inkSoft = Color(0xC7E8EDE3); // 78% ink, body copy
  static const muted = Color(0xFF8C9589); // 5.6:1 on page
  static const rule = Color(0x24E8EDE3); // 14% hairline
  static const accent = Color(0xFF9EE35F); // leaf
  static const onAccent = Color(0xFF0D120A);
  static const cool = Color(0xFF7FD6FF); // cooling, the portfolio's "arc"
  static const warn = Color(0xFFFF8A5B);
  static const paper = Color(0xFFF2EFE6); // documents (proposal), like the polaroid

  static const gutter = 20.0;
  static const radius = 22.0;
  static const shadow = [BoxShadow(color: Color(0x99000000), blurRadius: 60, offset: Offset(0, 30), spreadRadius: -24)];
}

FontWeight _w(double w) => FontWeight.values[((w / 100).round() - 1).clamp(0, 8)];

/// Geist is a variable font: weight must be set as a font variation, not only fontWeight.
TextStyle geist(double size, {double w = 400, Color color = Leaf.ink, double height = 1.35, double tracking = 0, bool tabular = false}) =>
    TextStyle(
      fontFamily: 'Geist',
      fontSize: size,
      fontWeight: _w(w),
      fontVariations: [FontVariation.weight(w)],
      fontFeatures: tabular ? const [FontFeature.tabularFigures()] : null, // digits all the same width: no wobble while counting
      color: color,
      height: height,
      letterSpacing: tracking * size,
    );

TextStyle mono(double size, {Color color = Leaf.muted, double w = 400}) => TextStyle(
      fontFamily: 'GeistMono',
      fontSize: size,
      fontWeight: _w(w),
      fontVariations: [FontVariation.weight(w)],
      color: color,
      height: 1.35,
    );

TextStyle serif(double size, {Color color = Leaf.ink, bool italic = false, double height = 0.95}) => TextStyle(
      fontFamily: 'InstrumentSerif',
      fontSize: size,
      fontStyle: italic ? FontStyle.italic : FontStyle.normal,
      color: color,
      height: height,
      letterSpacing: -0.02 * size,
    );

TextStyle hand(double size, {Color color = Leaf.accent}) =>
    TextStyle(fontFamily: 'Caveat', fontSize: size, color: color, height: 1.05, fontVariations: const [FontVariation.weight(500)]);

ThemeData leafTheme() {
  final text = TextTheme(
    displayLarge: serif(72),
    displayMedium: serif(56),
    displaySmall: serif(44),
    headlineLarge: geist(40, w: 600, height: 0.95, tracking: -0.045),
    headlineMedium: geist(30, w: 600, height: 1, tracking: -0.04),
    headlineSmall: geist(24, w: 600, height: 1.1, tracking: -0.03),
    titleLarge: geist(20, w: 600, tracking: -0.02),
    titleMedium: geist(16, w: 550, tracking: -0.01),
    titleSmall: geist(14, w: 550),
    bodyLarge: geist(16, color: Leaf.inkSoft, height: 1.55),
    bodyMedium: geist(15, color: Leaf.inkSoft, height: 1.55),
    bodySmall: geist(13, color: Leaf.muted, height: 1.5),
    labelLarge: geist(14, w: 550),
    labelMedium: mono(12),
    labelSmall: mono(11),
  );
  const scheme = ColorScheme.dark(
    primary: Leaf.accent,
    onPrimary: Leaf.onAccent,
    secondary: Leaf.cool,
    onSecondary: Leaf.page,
    surface: Leaf.page,
    onSurface: Leaf.ink,
    onSurfaceVariant: Leaf.muted,
    surfaceContainerLowest: Leaf.sunk,
    surfaceContainerLow: Leaf.surface,
    surfaceContainer: Leaf.surface,
    surfaceContainerHigh: Leaf.surfaceHi,
    surfaceContainerHighest: Leaf.surfaceHi,
    outline: Leaf.rule,
    outlineVariant: Leaf.rule,
    error: Leaf.warn,
    onError: Leaf.page,
  );
  final stadium = WidgetStatePropertyAll<OutlinedBorder>(const StadiumBorder());
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: Leaf.page,
    fontFamily: 'Geist',
    textTheme: text,
    splashFactory: NoSplash.splashFactory, // feedback comes from Pressable's scale, not ink
    highlightColor: Colors.transparent,
    hoverColor: Leaf.ink.withValues(alpha: 0.04),
    dividerTheme: const DividerThemeData(color: Leaf.rule, thickness: 1, space: 1),
    appBarTheme: AppBarTheme(
      backgroundColor: Leaf.page,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      elevation: 0,
      titleTextStyle: text.titleLarge,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: ButtonStyle(
        shape: stadium,
        minimumSize: const WidgetStatePropertyAll(Size(0, 48)),
        padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 22)),
        textStyle: WidgetStatePropertyAll(text.labelLarge),
        backgroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.disabled) ? Leaf.surfaceHi : Leaf.accent),
        foregroundColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.disabled) ? Leaf.muted : Leaf.onAccent),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: ButtonStyle(
        shape: stadium,
        minimumSize: const WidgetStatePropertyAll(Size(0, 44)),
        padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 18)),
        textStyle: WidgetStatePropertyAll(text.labelLarge),
        foregroundColor: const WidgetStatePropertyAll(Leaf.ink),
        side: const WidgetStatePropertyAll(BorderSide(color: Leaf.rule)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: ButtonStyle(shape: stadium, foregroundColor: const WidgetStatePropertyAll(Leaf.ink), textStyle: WidgetStatePropertyAll(text.labelLarge)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Leaf.sunk,
      labelStyle: mono(12),
      floatingLabelStyle: mono(12, color: Leaf.accent),
      hintStyle: geist(15, color: Leaf.muted),
      helperStyle: mono(11),
      counterStyle: mono(11),
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: const BorderSide(color: Leaf.rule)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: const BorderSide(color: Leaf.rule)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: const BorderSide(color: Leaf.accent, width: 1.2)),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Leaf.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: Leaf.rule,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Leaf.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24), side: const BorderSide(color: Leaf.rule)),
      titleTextStyle: text.headlineSmall,
      contentTextStyle: text.bodyMedium,
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: Leaf.ink,
      contentTextStyle: geist(14, w: 500, color: Leaf.page),
      shape: const StadiumBorder(),
      elevation: 0,
      insetPadding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: Leaf.accent, linearTrackColor: Leaf.rule, circularTrackColor: Colors.transparent),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(color: Leaf.ink, borderRadius: BorderRadius.circular(8)),
      textStyle: mono(11, color: Leaf.page),
    ),
    iconTheme: const IconThemeData(color: Leaf.ink, size: 20),
    pageTransitionsTheme: PageTransitionsTheme(builders: {
      for (final p in TargetPlatform.values) p: const FadeSlideTransitions(),
    }),
  );
}
