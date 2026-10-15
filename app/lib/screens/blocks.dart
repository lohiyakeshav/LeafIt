import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../models.dart';
import '../state.dart';
import '../ui/motion.dart';
import '../ui/parts.dart';
import '../ui/theme.dart';
import 'photo_audit.dart';
import 'simulator.dart';

String _delhiTime() {
  final t = DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));
  final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
  return '$h:${t.minute.toString().padLeft(2, '0')} ${t.hour < 12 ? 'am' : 'pm'}';
}

class BlocksScreen extends StatefulWidget {
  const BlocksScreen({super.key});

  @override
  State<BlocksScreen> createState() => _BlocksScreenState();
}

class _BlocksScreenState extends State<BlocksScreen> {
  late Future<dynamic> _blocks = api.get('/blocks');
  String? _opening;
  String _time = _delhiTime();
  Timer? _clock;

  @override
  void initState() {
    super.initState();
    _clock = Timer.periodic(const Duration(seconds: 30), (_) => setState(() => _time = _delhiTime()));
  }

  @override
  void dispose() {
    _clock?.cancel();
    super.dispose();
  }

  Future<void> _open(String id) async {
    setState(() => _opening = id);
    try {
      final state = SimState(Block.fromJson(await api.get('/blocks/$id')))..refresh();
      if (mounted) await Navigator.push(context, MaterialPageRoute(builder: (_) => SimulatorScreen(state: state)));
    } catch (e) {
      if (mounted) toast(context, '$e');
    } finally {
      if (mounted) setState(() => _opening = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    final title = geist((w * 0.17).clamp(54, 104), w: 600, height: 0.92, tracking: -0.055);
    return Scaffold(
      body: SafeArea(
        child: ListView(padding: EdgeInsets.zero, children: [
          // masthead
          Padding(
            padding: const EdgeInsets.fromLTRB(Leaf.gutter, 14, Leaf.gutter, 0),
            child: Reveal(
              child: Row(children: [
                Text('LeafIt', style: geist(15, w: 650, tracking: -0.02)),
                const SizedBox(width: 10),
                Text('v0.1 — 2026', style: mono(11)),
                const Spacer(),
                Text('New Delhi · $_time', style: mono(11)),
              ]),
            ),
          ),
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: Leaf.gutter),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SizedBox(height: w < 500 ? 48 : 88),
                  const Reveal(delay: Duration(milliseconds: 450), child: Kicker('Heat-action planner — New Delhi')),
                  const SizedBox(height: 22),
                  MaskReveal(delay: const Duration(milliseconds: 150), lines: [
                    Text('Cool the', style: title),
                    AccentText('block.', accent: 'block', style: title),
                  ]),
                  Padding(
                    // note is ~230 px wide; slide it right only as far as the screen allows
                    padding: EdgeInsets.only(top: 2, left: (w - 2 * Leaf.gutter - 240).clamp(0, 150).toDouble()),
                    child: const HandNote('a digital twin of\nyour street', angle: -0.05, pointBack: true),
                  ),
                  const SizedBox(height: 22),
                  Reveal(
                    delay: const Duration(milliseconds: 650),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 460),
                      child: Text(
                        'Test trees, cool roofs and shaded bus stops on a satellite twin of your neighbourhood. '
                        'Gemini plans with you, every number comes from the simulator, and local vendors turn the plan into shade.',
                        style: geist(16, color: Leaf.inkSoft, height: 1.55),
                      ),
                    ),
                  ),
                  const SizedBox(height: 26),
                  Reveal(
                    delay: const Duration(milliseconds: 750),
                    child: Pill(
                      'Audit a street from a photo',
                      icon: Icons.photo_camera_outlined,
                      kind: PillKind.outline,
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PhotoAuditScreen())),
                    ),
                  ),
                  const SizedBox(height: 56),
                  Reveal(
                    delay: const Duration(milliseconds: 850),
                    child: Row(children: [
                      Text('01 — Choose a block', style: mono(11.5)),
                      const Spacer(),
                      Text('10 m grid', style: mono(11.5)),
                    ]),
                  ),
                  const SizedBox(height: 10),
                  const Divider(),
                  FutureBuilder(
                    future: _blocks,
                    builder: (context, snap) {
                      if (snap.hasError) return _Offline(error: '${snap.error}', retry: () => setState(() => _blocks = api.get('/blocks')));
                      if (!snap.hasData) {
                        return const Padding(padding: EdgeInsets.all(28), child: Center(child: CircularProgressIndicator(strokeWidth: 2)));
                      }
                      final list = snap.data as List;
                      return Column(children: [
                        for (var i = 0; i < list.length; i++)
                          Reveal(
                            delay: Reveal.step(i, start: 950),
                            child: IndexRow(
                              no: (i + 1).toString().padLeft(2, '0'),
                              title: '${list[i]['name']}'.replaceAll(' (synthetic demo)', ''),
                              meta: list[i]['synthetic'] == true ? 'SYNTHETIC DEMO DATA · 600 × 600 m' : 'SATELLITE DATA',
                              busy: _opening == list[i]['id'],
                              onTap: _opening == null ? () => _open(list[i]['id']) : null,
                            ),
                          ),
                      ]);
                    },
                  ),
                ]),
              ),
            ),
          ),
          const SizedBox(height: 64),
          const Divider(),
          const SizedBox(height: 10),
          const Marquee(['trees', 'cool roofs', 'shaded stops', 'less heat', 'more shade', 'cleaner air']),
          Padding(
            padding: const EdgeInsets.fromLTRB(Leaf.gutter, 14, Leaf.gutter, 24),
            child: Row(children: [
              Text('Estimates, not promises', style: mono(11)),
              const Spacer(),
              Text('28.57° N 77.24° E', style: mono(11)),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _Offline extends StatelessWidget {
  const _Offline({required this.error, required this.retry});
  final String error;
  final VoidCallback retry;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 22),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Kicker("Can't reach the LeafIt server", color: Leaf.warn),
          const SizedBox(height: 10),
          Text('$apiBase\n$error', style: mono(11.5)),
          const SizedBox(height: 16),
          Pill('Try again', icon: Icons.refresh, kind: PillKind.outline, dense: true, onTap: retry),
        ]),
      );
}
