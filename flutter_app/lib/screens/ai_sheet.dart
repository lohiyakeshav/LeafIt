import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../format.dart';
import '../models.dart';
import '../state.dart';
import '../ui/motion.dart';
import '../ui/parts.dart';
import '../ui/theme.dart';
import '../validate.dart';

Future<void> showAiSheet(BuildContext context, SimState s) => showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      constraints: BoxConstraints(maxWidth: 720, maxHeight: MediaQuery.sizeOf(context).height * 0.92),
      builder: (_) => AiSheet(state: s),
    );

/// Planner brief in plain language -> /agent -> a tested plan with its reasoning trail.
class AiSheet extends StatefulWidget {
  const AiSheet({super.key, required this.state});
  final SimState state;

  @override
  State<AiSheet> createState() => _AiSheetState();
}

class _AiSheetState extends State<AiSheet> {
  late final _brief = TextEditingController();
  late final _budget = TextEditingController(text: (widget.state.budget / 1e5).toStringAsFixed(0));
  bool _loading = false;
  String? _error;
  Map<String, dynamic>? _res;

  static const _examples = [
    'Keep children walking to the school cool',
    'Cool the streets where people wait for buses',
    'Best average cooling for the whole block',
  ];

  String? get _budgetError => budgetError(_budget.text);

  Future<void> _run() async {
    if (_budgetError != null || _brief.text.trim().isEmpty) return;
    final lakh = double.parse(_budget.text.trim());
    FocusScope.of(context).unfocus();
    widget.state.setBudget(lakh * 1e5);
    setState(() {
      _loading = true;
      _error = null;
      _res = null;
    });
    try {
      final res = await api.post('/agent', {
        'block_id': widget.state.block.id,
        'brief': _brief.text.trim(),
        'budget_inr': lakh * 1e5,
        'years': widget.state.years,
      });
      if (mounted) setState(() => _res = res);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final res = _res;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(Leaf.gutter + 4, 0, Leaf.gutter + 4, 32),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const SectionHead(
            kicker: '02 — AI planner',
            title: 'What should we protect?',
            accent: 'protect',
            sub: 'Say it in your own words. Gemini tests options on the simulator and tells you why it picked one.',
            size: 30,
          ),
          const SizedBox(height: 22),
          TextField(
            controller: _brief,
            minLines: 2,
            maxLines: 4,
            maxLength: 500,
            onChanged: (_) => setState(() {}), // the Plan button needs a brief
            style: geist(16, height: 1.45),
            decoration: const InputDecoration(hintText: 'e.g. Protect elderly shoppers near the market, leave roofs alone'),
          ),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (var i = 0; i < _examples.length; i++)
              Reveal(
                delay: Reveal.step(i, start: 250),
                child: Pressable(
                  onTap: () => setState(() => _brief.text = _examples[i]),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    decoration: const ShapeDecoration(shape: StadiumBorder(side: BorderSide(color: Leaf.rule))),
                    child: Text(_examples[i], style: geist(13, color: Leaf.ink)),
                  ),
                ),
              ),
          ]),
          const SizedBox(height: 18),
          TextField(
            controller: _budget,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: budgetInput,
            onChanged: (_) => setState(() {}), // live hint under the field
            style: geist(18, w: 600, tracking: -0.02, tabular: true),
            decoration: InputDecoration(
              labelText: 'BUDGET',
              suffixText: 'lakh ₹',
              helperText: _budgetError == null ? '= ${inr(double.parse(_budget.text.trim()) * 1e5)} · from 0.1 to 10,000 lakh' : null,
              errorText: _budgetError,
              errorStyle: mono(11, color: Leaf.warn),
              errorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: const BorderSide(color: Leaf.warn)),
              focusedErrorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: const BorderSide(color: Leaf.warn, width: 1.2)),
            ),
          ),
          const SizedBox(height: 18),
          Pill(_loading ? 'Testing options' : 'Plan it',
              icon: Icons.auto_awesome, expand: true, loading: _loading, onTap: _budgetError == null && _brief.text.trim().isNotEmpty && !_loading ? _run : null),
          AnimatedSize(
            duration: Motion.med,
            curve: Motion.ease,
            child: _loading ? const Padding(padding: EdgeInsets.only(top: 16), child: _Thinking()) : const SizedBox(width: double.infinity),
          ),
          if (_error != null) ...[
            const SizedBox(height: 14),
            Text(_error!, style: mono(12, color: Leaf.warn)),
          ],
          if (res != null) ..._result(res),
        ]),
      ),
    );
  }

  List<Widget> _result(Map<String, dynamic> res) {
    final gemini = res['source'] == 'gemini';
    final unverified = (res['unverified_numbers'] as List?) ?? const [];
    final scenarios = (res['scenarios'] as List).cast<Map>();
    return [
      const SizedBox(height: 28),
      const Divider(),
      const SizedBox(height: 22),
      Reveal(
        child: Row(children: [
          const Kicker('Recommendation'),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: ShapeDecoration(shape: StadiumBorder(side: BorderSide(color: gemini ? Leaf.accent : Leaf.rule))),
            child: Text(gemini ? 'GEMINI' : 'OFFLINE RULES', style: mono(10.5, color: gemini ? Leaf.accent : Leaf.muted)),
          ),
        ]),
      ),
      const SizedBox(height: 16),
      Bullets(res['explanation']),
      if (gemini)
        Reveal(
          delay: const Duration(milliseconds: 400),
          child: Row(children: [
            Icon(unverified.isEmpty ? Icons.verified_outlined : Icons.error_outline,
                size: 15, color: unverified.isEmpty ? Leaf.accent : Leaf.warn),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                unverified.isEmpty
                    ? 'Every number above was checked against the simulator'
                    : 'Not from the simulator, ignore: ${unverified.join(', ')}',
                style: mono(11, color: unverified.isEmpty ? Leaf.accent : Leaf.warn),
              ),
            ),
          ]),
        ),
      const SizedBox(height: 26),
      Text('OPTIONS TESTED', style: mono(11)),
      const SizedBox(height: 10),
      for (var i = 0; i < scenarios.length; i++)
        Reveal(
          delay: Reveal.step(i, start: 200, ms: 110),
          child: _Option(scenarios[i], chosen: scenarios[i]['id'] == res['chosen']),
        ),
      const SizedBox(height: 8),
      _Trail((res['steps'] as List).cast<Map>()),
      const SizedBox(height: 20),
      Pill('Apply to the map', icon: Icons.check, expand: true, onTap: () {
        final label = scenarios.firstWhere((x) => x['id'] == res['chosen'])['label'];
        widget.state.apply([for (final p in res['placements'] as List) Placement.fromJson(p)]);
        Navigator.pop(context);
        toast(context, 'Applied: $label');
      }),
    ];
  }
}

/// While the planner runs: a mono ticker of what it's doing, so the wait reads as work.
class _Thinking extends StatefulWidget {
  const _Thinking();
  @override
  State<_Thinking> createState() => _ThinkingState();
}

class _ThinkingState extends State<_Thinking> {
  static const _lines = [
    'Reading the block',
    'Finding the hottest streets',
    'Testing whole-block cooling',
    'Testing your priorities',
    'Comparing options',
    'Writing it up',
  ];
  int _i = 0;
  Timer? _t;

  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(milliseconds: 900), (_) => setState(() => _i = (_i + 1) % _lines.length));
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Row(children: [
        const PulseDot(),
        const SizedBox(width: 10),
        AnimatedSwitcher(
          duration: Motion.fast,
          transitionBuilder: (c, a) => FadeTransition(
            opacity: a,
            child: SlideTransition(position: Tween(begin: const Offset(0, 0.4), end: Offset.zero).animate(a), child: c),
          ),
          child: Text('${_lines[_i]}…', key: ValueKey(_i), style: mono(12, color: Leaf.ink)),
        ),
      ]);
}

class _Option extends StatelessWidget {
  const _Option(this.sc, {required this.chosen});
  final Map sc;
  final bool chosen;

  @override
  Widget build(BuildContext context) {
    final m = sc['metrics'] as Map;
    return AnimatedContainer(
      duration: Motion.med,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: chosen ? Leaf.accent.withValues(alpha: 0.08) : Colors.transparent,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: chosen ? Leaf.accent : Leaf.rule),
      ),
      child: Row(children: [
        Text(sc['id'], style: mono(11.5, color: chosen ? Leaf.accent : Leaf.muted)),
        const SizedBox(width: 14),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(sc['label'], style: geist(15.5, w: 600, tracking: -0.02)),
            const SizedBox(height: 4),
            Text('−${m['temp_reduction_c']}° avg · −${m['peak_reduction_c']}° peak · ${inr(m['total_cost_inr'])}', style: mono(11)),
          ]),
        ),
        AnimatedScale(
          scale: chosen ? 1 : 0,
          duration: Motion.med,
          curve: Curves.easeOutBack,
          child: const Icon(Icons.check_circle, color: Leaf.accent, size: 22),
        ),
      ]),
    );
  }
}

/// Collapsible timeline of the planner's tool calls.
class _Trail extends StatefulWidget {
  const _Trail(this.steps);
  final List<Map> steps;
  @override
  State<_Trail> createState() => _TrailState();
}

class _TrailState extends State<_Trail> {
  bool _open = false;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Pressable(
          scale: 0.98,
          onTap: () => setState(() => _open = !_open),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Row(children: [
              Text('REASONING TRAIL · ${widget.steps.length} STEPS', style: mono(11, color: Leaf.ink)),
              const Spacer(),
              AnimatedRotation(turns: _open ? 0.5 : 0, duration: Motion.med, curve: Motion.ease, child: const Icon(Icons.expand_more, size: 20)),
            ]),
          ),
        ),
        AnimatedSize(
          duration: Motion.med,
          curve: Motion.ease,
          child: !_open
              ? const SizedBox(width: double.infinity)
              : Column(children: [
                  for (var i = 0; i < widget.steps.length; i++)
                    Reveal(
                      delay: Reveal.step(i, ms: 60),
                      dy: 8,
                      child: IntrinsicHeight(
                        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          SizedBox(
                            width: 20,
                            child: Column(children: [
                              const SizedBox(height: 5),
                              Container(width: 7, height: 7, decoration: const BoxDecoration(color: Leaf.accent, shape: BoxShape.circle)),
                              if (i < widget.steps.length - 1) Expanded(child: Container(width: 1, color: Leaf.rule)),
                            ]),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.only(bottom: 14),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(widget.steps[i]['action'], style: geist(14, w: 600)),
                                const SizedBox(height: 2),
                                Text(widget.steps[i]['detail'], style: mono(11)),
                              ]),
                            ),
                          ),
                        ]),
                      ),
                    ),
                ]),
        ),
      ]);
}
