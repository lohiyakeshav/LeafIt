/// ₹ in Indian units: ₹45,000 · ₹18.5 L · ₹2.5 Cr
String inr(num v) {
  final a = v.abs();
  final sign = v < 0 ? '-' : '';
  if (a >= 1e7) return '$sign₹${_short(a / 1e7)} Cr';
  if (a >= 1e5) return '$sign₹${_short(a / 1e5)} L';
  final s = a.round().toString();
  return '$sign₹${s.length > 3 ? '${s.substring(0, s.length - 3)},${s.substring(s.length - 3)}' : s}';
}

String _short(num x) {
  final s = x.toStringAsFixed(x >= 100 ? 0 : (x >= 10 ? 1 : 2));
  return s.contains('.') ? s.replaceFirst(RegExp(r'\.?0+$'), '') : s;
}
