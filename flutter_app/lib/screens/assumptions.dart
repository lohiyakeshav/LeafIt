import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../ui/motion.dart';
import '../ui/parts.dart';
import '../ui/theme.dart';

const _statusColor = {
  'cited': Leaf.accent,
  'derived': Leaf.accent,
  'estimate': Leaf.ink,
  'modelling choice': Leaf.muted,
  'under review': Leaf.warn,
};

class AssumptionsScreen extends StatelessWidget {
  const AssumptionsScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 760),
              child: FutureBuilder(
                future: api.get('/assumptions'),
                builder: (context, snap) => ListView(padding: const EdgeInsets.fromLTRB(Leaf.gutter, 10, Leaf.gutter, 40), children: [
                  Row(children: [CircleBtn(Icons.arrow_back, tooltip: 'Back', onTap: () => Navigator.maybePop(context))]),
                  const SizedBox(height: 28),
                  const SectionHead(
                    kicker: 'Method',
                    title: 'How we calculate this.',
                    accent: 'calculate',
                    sub: 'A fast grid model, not a physics simulation. Each 10 m cell starts from its satellite surface temperature; '
                        'each item\'s cooling is spread over its own cell and its neighbours. Gemini only picks and explains plans. '
                        'Every figure comes from this model. Measured values link to their source; design decisions are marked as modelling choices.',
                    size: 38,
                  ),
                  const SizedBox(height: 18),
                  Reveal(
                    delay: const Duration(milliseconds: 200),
                    child: Wrap(spacing: 14, runSpacing: 6, children: [
                      for (final (k, d) in const [
                        ('CITED', 'a source gives the value'),
                        ('DERIVED', 'computed from cited figures'),
                        ('ESTIMATE', 'inside a cited range'),
                      ])
                        Text('$k · $d', style: mono(10.5)),
                    ]),
                  ),
                  const SizedBox(height: 18),
                  const Divider(),
                  if (snap.hasError) Padding(padding: const EdgeInsets.all(20), child: Text('${snap.error}', style: mono(12, color: Leaf.warn))),
                  if (!snap.hasData && !snap.hasError)
                    const Padding(padding: EdgeInsets.all(28), child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
                  if (snap.data is List)
                    for (final (i, a) in (snap.data as List).indexed) Reveal(delay: Reveal.step(i, start: 200, ms: 50), child: _Item(a)),
                ]),
              ),
            ),
          ),
        ),
      );
}

class _Item extends StatelessWidget {
  const _Item(this.a);
  final Map a;

  @override
  Widget build(BuildContext context) {
    final status = '${a['status']}';
    final color = _statusColor[status] ?? Leaf.muted;
    final why = '${a['why'] ?? ''}';
    final sources = (a['sources'] as List?) ?? const [];
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 18),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Leaf.rule))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Text(a['item'], style: geist(17, w: 600, tracking: -0.02))),
          const SizedBox(width: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
            decoration: ShapeDecoration(shape: StadiumBorder(side: BorderSide(color: color == Leaf.muted ? Leaf.rule : color))),
            child: Text(status.toUpperCase(), style: mono(10, color: color)),
          ),
        ]),
        const SizedBox(height: 6),
        Text(a['value'], style: geist(15, color: Leaf.ink, height: 1.5)),
        if (why.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(why, style: Theme.of(context).textTheme.bodySmall?.copyWith(height: 1.55)),
        ],
        for (final s in sources)
          Pressable(
            scale: 0.98,
            semanticLabel: 'Source: ${s['title']}',
            onTap: () => launchUrl(Uri.parse(s['url']), mode: LaunchMode.externalApplication),
            child: Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Padding(padding: EdgeInsets.only(top: 2), child: Icon(Icons.north_east, size: 13, color: Leaf.accent)),
                const SizedBox(width: 6),
                Expanded(child: Text(s['title'], style: mono(11, color: Leaf.accent))),
              ]),
            ),
          ),
      ]),
    );
  }
}
