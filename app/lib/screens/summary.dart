import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../state.dart';
import '../ui/motion.dart';
import '../ui/parts.dart';
import '../ui/theme.dart';
import '../widgets/heat_grid.dart';
import '../widgets/metrics.dart';
import 'vendors.dart';

/// Before/after, save the plan, bill of materials, AI funding proposal, then vendors.
class SummaryScreen extends StatefulWidget {
  const SummaryScreen({super.key, required this.state});
  final SimState state;

  @override
  State<SummaryScreen> createState() => _SummaryScreenState();
}

class _SummaryScreenState extends State<SummaryScreen> {
  final _name = TextEditingController(text: 'Plan A');
  String? _planId, _error, _proposal, _proposalSource;
  List? _bom;
  bool _saving = false, _writing = false;

  SimState get s => widget.state;

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final id = (await api.post('/plans', {...s.request(), 'name': _name.text.trim()}))['id'];
      _bom = await api.get('/plans/$id/bom');
      _planId = id;
      HapticFeedback.mediumImpact();
    } catch (e) {
      _error = '$e';
    }
    if (mounted) setState(() => _saving = false);
  }

  Future<void> _writeProposal() async {
    setState(() {
      _writing = true;
      _error = null;
    });
    try {
      final res = await api.post('/plans/$_planId/proposal', {});
      _proposal = res['text'];
      _proposalSource = res['source'];
    } catch (e) {
      _error = '$e';
    }
    if (mounted) setState(() => _writing = false);
  }

  @override
  Widget build(BuildContext context) {
    final years = s.years;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 820),
            child: ListView(padding: const EdgeInsets.fromLTRB(Leaf.gutter, 10, Leaf.gutter, 48), children: [
              Row(children: [CircleBtn(Icons.arrow_back, tooltip: 'Back', onTap: () => Navigator.maybePop(context))]),
              const SizedBox(height: 28),
              SectionHead(
                kicker: '03 — The plan',
                title: 'Before & after.',
                accent: 'after',
                sub: '${s.block.name.replaceAll(' (synthetic demo)', '')} · year $years · drag the handle to compare. All figures are estimates.',
                size: 40,
              ),
              const SizedBox(height: 24),
              Reveal(
                delay: const Duration(milliseconds: 200),
                child: Container(
                  decoration: BoxDecoration(borderRadius: BorderRadius.circular(Leaf.radius), border: Border.all(color: Leaf.rule)),
                  clipBehavior: Clip.antiAlias,
                  child: CompareSlider(before: HeatGrid(state: s, showAfter: false), after: HeatGrid(state: s, showAfter: true)),
                ),
              ),
              const SizedBox(height: 12),
              HeatLegend(min: s.block.minT, max: s.block.maxT),
              const SizedBox(height: 32),
              MetricsBoard(s.metrics, s.breakdown, heroSize: 34),
              const SizedBox(height: 44),
              AnimatedSwitcher(
                duration: Motion.med,
                switchInCurve: Motion.ease,
                transitionBuilder: (c, a) => FadeTransition(
                  opacity: a,
                  child: SlideTransition(position: Tween(begin: const Offset(0, 0.05), end: Offset.zero).animate(a), child: c),
                ),
                child: _planId == null ? _saveForm() : _saved(),
              ),
              if (_error != null) Padding(padding: const EdgeInsets.only(top: 14), child: Text(_error!, style: mono(12, color: Leaf.warn))),
              if (_proposal != null) ...[const SizedBox(height: 24), _Document(_proposal!, gemini: _proposalSource == 'gemini')],
            ]),
          ),
        ),
      ),
    );
  }

  Widget _saveForm() => Column(key: const ValueKey('form'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Kicker('04 — Save it'),
        const SizedBox(height: 14),
        TextField(controller: _name, maxLength: 80, style: geist(17, w: 550), decoration: const InputDecoration(labelText: 'PLAN NAME')),
        const SizedBox(height: 6),
        Pill('Save & build the bill of materials', icon: Icons.inventory_2_outlined, expand: true, loading: _saving, onTap: _save),
      ]);

  Widget _saved() => Column(key: const ValueKey('saved'), crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          const Kicker('04 — Bill of materials'),
          const Spacer(),
          Text('PLAN $_planId', style: mono(11)),
        ]),
        const SizedBox(height: 8),
        for (var i = 0; i < _bom!.length; i++)
          Reveal(
            delay: Reveal.step(i, ms: 80),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 16),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Leaf.rule))),
              child: Row(children: [
                Expanded(child: Text(_bom![i]['item'], style: geist(15.5, w: 500))),
                const SizedBox(width: 12),
                Text('${_bom![i]['quantity']} ${_bom![i]['unit']}', style: mono(12.5, color: Leaf.ink)),
              ]),
            ),
          ),
        const SizedBox(height: 20),
        Pill('Find vendors near the block', icon: Icons.storefront_outlined, expand: true, onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => VendorsScreen(
                blockId: s.block.id,
                planId: _planId!,
                categories: {for (final i in _bom!) i['category'] as String},
              ),
            ),
          );
        }),
        const SizedBox(height: 40),
        const Kicker('05 — Funding proposal'),
        const SizedBox(height: 10),
        Text('A one-page pitch for your ward office or a CSR sponsor, written from the numbers above.',
            style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: 16),
        Pill(_proposal == null ? 'Write the proposal' : 'Rewrite it',
            icon: Icons.edit_note, kind: PillKind.outline, expand: true, loading: _writing, onTap: _writeProposal),
      ]);
}

/// The proposal on "paper": a light document card with a tiny Markdown renderer (#, ##, -, *italic*).
class _Document extends StatelessWidget {
  const _Document(this.text, {required this.gemini});
  final String text;
  final bool gemini;

  static const _ink = Color(0xFF1C211D);
  static const _soft = Color(0xFF4C544B);

  @override
  Widget build(BuildContext context) {
    final blocks = <Widget>[];
    for (final raw in text.split('\n')) {
      final l = raw.trimRight().replaceAll('**', '');
      if (l.trim().isEmpty) {
        blocks.add(const SizedBox(height: 8));
      } else if (l.startsWith('# ')) {
        blocks.add(Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(l.substring(2), style: serif(32, color: _ink, height: 1.05))));
      } else if (l.startsWith('## ')) {
        blocks.add(Padding(
          padding: const EdgeInsets.only(top: 12, bottom: 4),
          child: Text(l.substring(3).toUpperCase(), style: mono(11, color: const Color(0xFF3F7A1E), w: 600)),
        ));
      } else if (RegExp(r'^\s*([-•*]|\d+\.)\s').hasMatch(l)) {
        final m = RegExp(r'^\s*([-•*]|\d+\.)\s+').firstMatch(l)!;
        final marker = m.group(1)!;
        blocks.add(Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 22, child: Text(RegExp(r'\d').hasMatch(marker) ? marker : '—', style: mono(12.5, color: _soft))),
            Expanded(child: Text(l.substring(m.end), style: geist(14.5, color: _ink, height: 1.5))),
          ]),
        ));
      } else if (l.startsWith('*') && l.endsWith('*')) {
        blocks.add(Text(l.replaceAll('*', ''), style: geist(12.5, color: _soft, height: 1.5).copyWith(fontStyle: FontStyle.italic)));
      } else {
        blocks.add(Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(l, style: geist(14.5, color: _ink, height: 1.55))));
      }
    }
    return Reveal(
      child: Container(
        padding: const EdgeInsets.fromLTRB(24, 18, 16, 28),
        decoration: BoxDecoration(color: Leaf.paper, borderRadius: BorderRadius.circular(20), boxShadow: Leaf.shadow),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(gemini ? 'DRAFTED BY GEMINI' : 'TEMPLATE DRAFT', style: mono(10.5, color: _soft)),
            const Spacer(),
            IconButton(
              tooltip: 'Copy',
              icon: const Icon(Icons.copy_rounded, size: 18, color: _ink),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: text));
                HapticFeedback.lightImpact();
                toast(context, 'Proposal copied');
              },
            ),
          ]),
          ...blocks,
        ]),
      ),
    );
  }
}
