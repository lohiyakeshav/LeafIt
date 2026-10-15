import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../ui/motion.dart';
import '../ui/parts.dart';
import '../ui/theme.dart';

const _cat = {'nursery': 'NURSERY', 'roofing': 'COOL ROOFS', 'shade': 'SHADE STRUCTURES'};

class VendorsScreen extends StatefulWidget {
  const VendorsScreen({super.key, required this.blockId, required this.planId, required this.categories});
  final String blockId, planId;
  final Set<String> categories;

  @override
  State<VendorsScreen> createState() => _VendorsScreenState();
}

class _VendorsScreenState extends State<VendorsScreen> {
  late final _vendors = api.get('/vendors', {'block_id': widget.blockId, 'category': widget.categories.join(',')});
  String? _busy;

  Future<void> _quote(Map v) async {
    setState(() => _busy = v['id']);
    try {
      final q = await api.post('/quotes', {'plan_id': widget.planId, 'vendor_id': v['id']});
      if (mounted) await _showQuote(v, q);
    } catch (e) {
      if (mounted) toast(context, '$e');
    }
    if (mounted) setState(() => _busy = null);
  }

  Future<void> _showQuote(Map v, Map q) => showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        constraints: const BoxConstraints(maxWidth: 640),
        builder: (ctx) => SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(Leaf.gutter + 4, 0, Leaf.gutter + 4, 28 + MediaQuery.paddingOf(ctx).bottom),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SectionHead(kicker: 'Quote request', title: _clean(v['name']), size: 28),
            const SizedBox(height: 18),
            Reveal(
              delay: const Duration(milliseconds: 150),
              child: Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(color: Leaf.sunk, borderRadius: BorderRadius.circular(18), border: Border.all(color: Leaf.rule)),
                child: SelectableText(q['message'], style: mono(12.5, color: Leaf.ink)),
              ),
            ),
            const SizedBox(height: 18),
            Row(children: [
              Expanded(
                child: Pill('WhatsApp',
                    icon: Icons.chat_outlined,
                    expand: true,
                    onTap: () => launchUrl(Uri.parse(q['whatsapp_url']), mode: LaunchMode.externalApplication)),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Pill('Email', icon: Icons.mail_outline, kind: PillKind.outline, expand: true, onTap: () => launchUrl(Uri.parse(q['mailto_url']))),
              ),
            ]),
          ]),
        ),
      );

  static String _clean(String name) => name.replaceAll(' (demo)', '');

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 820),
              child: FutureBuilder(
                future: _vendors,
                builder: (context, snap) {
                  final list = snap.data as List?;
                  return ListView(padding: const EdgeInsets.fromLTRB(Leaf.gutter, 10, Leaf.gutter, 40), children: [
                    Row(children: [CircleBtn(Icons.arrow_back, tooltip: 'Back', onTap: () => Navigator.maybePop(context))]),
                    const SizedBox(height: 28),
                    const SectionHead(
                      kicker: '06 — Make it real',
                      title: 'Who can build it.',
                      accent: 'build',
                      sub: 'Local suppliers matched to your bill of materials, nearest and best-rated first.',
                      size: 40,
                    ),
                    const SizedBox(height: 22),
                    if (list != null && list.any((v) => v['demo'] == true))
                      Reveal(
                        delay: const Duration(milliseconds: 200),
                        child: Text('DEMO LISTINGS — REAL ONES WILL COME FROM GOOGLE PLACES', style: mono(10.5, color: Leaf.warn)),
                      ),
                    const SizedBox(height: 12),
                    const Divider(),
                    if (snap.hasError) Padding(padding: const EdgeInsets.all(20), child: Text('${snap.error}', style: mono(12, color: Leaf.warn))),
                    if (!snap.hasData && !snap.hasError)
                      const Padding(padding: EdgeInsets.all(28), child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
                    if (list != null && list.isEmpty) Padding(padding: const EdgeInsets.all(20), child: Text('No vendors within 15 km', style: mono(12))),
                    if (list != null)
                      for (var i = 0; i < list.length; i++)
                        Reveal(
                          delay: Reveal.step(i, start: 250),
                          child: IndexRow(
                            no: (i + 1).toString().padLeft(2, '0'),
                            title: _clean(list[i]['name']),
                            meta: '${_cat[list[i]['category']] ?? list[i]['category']} · ${list[i]['distance_km']} KM · ★ ${list[i]['rating']}',
                            busy: _busy == list[i]['id'],
                            onTap: _busy == null ? () => _quote(list[i]) : null,
                          ),
                        ),
                  ]);
                },
              ),
            ),
          ),
        ),
      );
}
