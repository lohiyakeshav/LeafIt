import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api.dart';
import '../models.dart';
import '../ui/motion.dart';
import '../ui/parts.dart';
import '../ui/theme.dart';

/// Citizen heat audit: Gemini reads a street photo and suggests LeafIt interventions.
class PhotoAuditScreen extends StatefulWidget {
  const PhotoAuditScreen({super.key});

  @override
  State<PhotoAuditScreen> createState() => _PhotoAuditScreenState();
}

class _PhotoAuditScreenState extends State<PhotoAuditScreen> {
  Uint8List? _image;
  Map<String, dynamic>? _res;
  String? _error;
  bool _busy = false;

  Future<void> _pick(ImageSource src) async {
    final f = await ImagePicker().pickImage(source: src, maxWidth: 1600, imageQuality: 85);
    if (f == null) return;
    final bytes = await f.readAsBytes();
    setState(() {
      _image = bytes;
      _res = null;
      _error = null;
      _busy = true;
    });
    try {
      final mime = f.mimeType ?? (f.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
      _res = await api.post('/photo', {'image_b64': base64Encode(bytes), 'mime_type': mime});
    } catch (e) {
      _error = '$e';
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final r = _res;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: ListView(padding: const EdgeInsets.fromLTRB(Leaf.gutter, 10, Leaf.gutter, 40), children: [
              Row(children: [CircleBtn(Icons.arrow_back, tooltip: 'Back', onTap: () => Navigator.maybePop(context))]),
              const SizedBox(height: 28),
              const SectionHead(
                kicker: 'Street audit',
                title: 'Show us the street.',
                accent: 'street',
                sub: 'Take or upload a photo. Gemini spots heat traps (bare asphalt, no shade, people waiting in the sun) and suggests what to add.',
                size: 40,
              ),
              const SizedBox(height: 22),
              Reveal(
                delay: const Duration(milliseconds: 220),
                child: Row(children: [
                  Expanded(child: Pill('Camera', icon: Icons.photo_camera_outlined, expand: true, onTap: _busy ? null : () => _pick(ImageSource.camera))),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Pill('Upload',
                        icon: Icons.photo_library_outlined, kind: PillKind.outline, expand: true, onTap: _busy ? null : () => _pick(ImageSource.gallery)),
                  ),
                ]),
              ),
              if (_image != null) ...[
                const SizedBox(height: 20),
                Reveal(
                  child: Container(
                    height: 280,
                    decoration: BoxDecoration(borderRadius: BorderRadius.circular(Leaf.radius), border: Border.all(color: Leaf.rule)),
                    clipBehavior: Clip.antiAlias,
                    child: Stack(fit: StackFit.expand, children: [
                      Image.memory(_image!, fit: BoxFit.cover, semanticLabel: 'Your street photo'),
                      if (_busy) const _Scan(),
                    ]),
                  ),
                ),
              ],
              if (_busy) const Padding(padding: EdgeInsets.only(top: 14), child: Kicker('Gemini is looking at your street…')),
              if (_error != null) Padding(padding: const EdgeInsets.only(top: 14), child: Text(_error!, style: mono(12, color: Leaf.warn))),
              if (r != null) ..._result(r),
            ]),
          ),
        ),
      ),
    );
  }

  List<Widget> _result(Map<String, dynamic> r) {
    String up(Object? s) => '$s'.replaceAll('_', ' ').toUpperCase();
    final risk = '${r['heat_risk']}';
    return [
      const SizedBox(height: 26),
      Reveal(
        child: Row(children: [
          Expanded(child: _Big('HEAT RISK', risk, risk == 'high' ? Leaf.warn : (risk == 'low' ? Leaf.accent : Leaf.ink))),
          const VRule(height: 52),
          const SizedBox(width: 18),
          Expanded(child: _Big('SHADE', '${r['shade_level']}', Leaf.ink)),
        ]),
      ),
      const SizedBox(height: 18),
      Reveal(
        delay: const Duration(milliseconds: 120),
        child: Wrap(spacing: 8, runSpacing: 8, children: [
          if (r['people_exposed'] == true) _tag('PEOPLE IN THE SUN', Leaf.warn),
          for (final s in r['surfaces'] as List) _tag(up(s), Leaf.muted),
        ]),
      ),
      const SizedBox(height: 28),
      Text('SUGGESTIONS', style: mono(11)),
      const SizedBox(height: 4),
      const Divider(),
      for (final (i, s) in (r['suggestions'] as List).indexed)
        Reveal(
          delay: Reveal.step(i, start: 200, ms: 90),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 16),
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Leaf.rule))),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                width: 36,
                height: 36,
                decoration: const BoxDecoration(color: Leaf.accent, shape: BoxShape.circle),
                child: Icon(Tool.from(s['intervention']).icon, size: 18, color: Leaf.onAccent),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${Tool.from(s['intervention']).label} · ${s['where']}', style: geist(15.5, w: 600, tracking: -0.02)),
                  const SizedBox(height: 4),
                  Text(s['why'], style: Theme.of(context).textTheme.bodyMedium),
                ]),
              ),
            ]),
          ),
        ),
      if ('${r['notes'] ?? ''}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 14), child: Text(r['notes'], style: mono(11.5))),
      const SizedBox(height: 18),
      Text('Analysed by Gemini. Check suggestions on the simulator before acting.', style: mono(11)),
    ];
  }

  Widget _tag(String t, Color c) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: ShapeDecoration(shape: StadiumBorder(side: BorderSide(color: c == Leaf.muted ? Leaf.rule : c))),
        child: Text(t, style: mono(10.5, color: c == Leaf.muted ? Leaf.ink : c)),
      );
}

class _Big extends StatelessWidget {
  const _Big(this.label, this.value, this.color);
  final String label, value;
  final Color color;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: mono(11)),
        const SizedBox(height: 4),
        AccentText(value, accent: value, color: color, style: geist(34, w: 600, tracking: -0.04, color: color)),
      ]);
}

/// A soft accent line sweeping over the photo while Gemini analyses it.
class _Scan extends StatefulWidget {
  const _Scan();
  @override
  State<_Scan> createState() => _ScanState();
}

class _ScanState extends State<_Scan> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => IgnorePointer(
        child: Container(
          color: Leaf.page.withValues(alpha: 0.25),
          child: AnimatedBuilder(
            animation: _c,
            builder: (_, _) => Align(
              alignment: Alignment(0, -1 + 2 * Motion.ease.transform(_c.value)),
              child: Container(
                height: 70,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Leaf.accent.withValues(alpha: 0), Leaf.accent.withValues(alpha: 0.35), Leaf.accent.withValues(alpha: 0)],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
}
