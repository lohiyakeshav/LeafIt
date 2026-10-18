import 'package:flutter/material.dart';

import '../format.dart';
import '../screens/assumptions.dart';
import '../ui/motion.dart';
import '../ui/parts.dart';
import '../ui/theme.dart';

String _deg(double v, int d) => '${v >= 0.5 / (d == 1 ? 10 : 100) ? '−' : ''}${v.toStringAsFixed(d)}°';
String _aqi(double v) => v.abs() < 0.005 ? '0.00' : v.toStringAsFixed(2); // trees move AQI only slightly (Nowak 2013)
String _t(double kg) => '${(kg / 1000).toStringAsFixed(1)} t';

/// The live metrics, in order of importance: cooling, air quality and CO₂ large; exposure and money small.
/// Every stat opens a sheet that shows how it was calculated, using the backend's real inputs.
class MetricsBoard extends StatelessWidget {
  const MetricsBoard(this.m, this.b, {super.key, this.heroSize = 30, this.stacked = false});
  final Map<String, dynamic>? m, b; // metrics, breakdown
  final double heroSize;
  final bool stacked; // narrow side panel: one hero per row

  double _v(String k) => (m?[k] as num?)?.toDouble() ?? 0;

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        // Hero font size is fixed once from the column width (widest value is ~6 characters), never per frame,
        // so a number counting up can't shrink or wobble mid-animation.
        final col = stacked ? box.maxWidth : (box.maxWidth - 2 * 25) / 3;
        return _board(context, (col / 3.9).clamp(18.0, heroSize));
      });

  Widget _board(BuildContext context, double heroSize) {
    final cool = _v('temp_reduction_c'), peak = _v('peak_reduction_c'), aqi = _v('aqi_change');
    final perDeg = m?['cost_per_degree_inr'] as num?;
    void why(String k) => showMetricWhy(context, k, m, b);

    final heroes = [
      _Hero('COOLING', cool, (v) => _deg(v, 2), cool > 0.005 ? Leaf.accent : Leaf.ink, heroSize,
          sub: 'peak ${_deg(peak, 1)}', subColor: peak > 0.05 ? Leaf.cool : Leaf.muted, onInfo: () => why('cooling')),
      _Hero('AIR QUALITY', aqi, _aqi, aqi < -0.005 ? Leaf.accent : Leaf.ink, heroSize, sub: 'AQI points', onInfo: () => why('aqi')),
      _Hero('CO₂', _v('co2_captured_kg_per_year'), _t, Leaf.ink, heroSize, sub: 'captured / year', onInfo: () => why('co2')),
    ];
    final minor = [
      _Minor('HEAT-EXPOSED', _v('heat_exposure_pct'), (v) => '${v.toStringAsFixed(0)}%', () => why('exposure')),
      _Minor('COST', _v('total_cost_inr'), inr, () => why('cost')),
      _Minor('₹ PER °C', perDeg?.toDouble() ?? 0, (v) => perDeg == null ? '—' : inr(v), () => why('per_degree')),
    ];

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      if (stacked)
        for (var i = 0; i < heroes.length; i++)
          Padding(padding: const EdgeInsets.only(bottom: 18), child: Reveal(delay: Reveal.step(i, ms: 60), child: heroes[i]))
      else
        IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (var i = 0; i < heroes.length; i++) ...[
              if (i > 0) const Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: VRule(height: double.infinity)),
              Expanded(child: Reveal(delay: Reveal.step(i, ms: 60), child: heroes[i])),
            ],
          ]),
        ),
      SizedBox(height: stacked ? 4 : 16),
      Reveal(
        delay: const Duration(milliseconds: 200),
        child: Container(
          padding: const EdgeInsets.only(top: 12),
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: Leaf.rule))),
          child: Row(children: [
            for (var i = 0; i < minor.length; i++) ...[
              if (i > 0) const SizedBox(width: 12),
              Expanded(child: minor[i]),
            ],
          ]),
        ),
      ),
    ]);
  }
}

class _InfoLabel extends StatelessWidget {
  const _InfoLabel(this.label);
  final String label;

  @override
  Widget build(BuildContext context) => Row(children: [
        Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.fade, softWrap: false, style: mono(10.5))),
        const SizedBox(width: 4),
        const Icon(Icons.info_outline, size: 12, color: Leaf.muted),
      ]);
}

class _Hero extends StatelessWidget {
  const _Hero(this.label, this.value, this.format, this.color, this.size, {required this.sub, this.subColor = Leaf.muted, required this.onInfo});
  final String label, sub;
  final double value, size;
  final String Function(double) format;
  final Color color, subColor;
  final VoidCallback onInfo;

  @override
  Widget build(BuildContext context) => Pressable(
        onTap: onInfo,
        scale: 0.97,
        semanticLabel: '$label ${format(value)}, $sub. How is this calculated?',
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          _InfoLabel(label),
          const SizedBox(height: 6),
          AnimatedValue(value, format, style: geist(size, w: 600, color: color, height: 1, tracking: -0.04, tabular: true)),
          const SizedBox(height: 4),
          Text(sub, maxLines: 1, overflow: TextOverflow.fade, softWrap: false, style: mono(10.5, color: subColor)),
        ]),
      );
}

class _Minor extends StatelessWidget {
  const _Minor(this.label, this.value, this.format, this.onInfo);
  final String label;
  final double value;
  final String Function(double) format;
  final VoidCallback onInfo;

  @override
  Widget build(BuildContext context) => Pressable(
        onTap: onInfo,
        scale: 0.97,
        semanticLabel: '$label ${format(value)}. How is this calculated?',
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          _InfoLabel(label),
          const SizedBox(height: 4),
          AnimatedValue(value, format, style: geist(16, w: 600, height: 1.1, tracking: -0.02, tabular: true)),
        ]),
      );
}

/// "How is this calculated?" for one metric: what it means, the rule, and today's numbers plugged in.
void showMetricWhy(BuildContext context, String key, Map<String, dynamic>? m, Map<String, dynamic>? b) {
  num n(Map? src, String k) => (src?[k] as num?) ?? 0;
  final trees = n(b, 'trees').toInt(), stops = n(b, 'stops').toInt(), roof = n(b, 'roof_m2').toInt();
  final mat = n(b, 'maturity').toDouble();
  final unit = (b?['unit_cost'] as Map?) ?? const {};
  final parts = (b?['cost_parts'] as Map?) ?? const {};
  final matPct = '${(mat * 100).round()}%';

  final (String title, String accent, String what, String rule, List<(String, String)> now) = switch (key) {
    'cooling' => (
        'Cooling',
        'Cooling',
        'How much cooler it gets where people are: averaged over the streets, parks and open ground of the block (10 m cells).',
        'A fully grown tree in every 10 m cell cools the surface by ${n(b, 'tree_cool_c')} °C; each tree\'s share is spread over about ${n(b, 'tree_reach_m')} m around it. '
            'A cool roof makes the roof itself about ${n(b, 'roof_surface_c')} °C cooler (you see that on the map), but only spills '
            'up to ${n(b, 'roof_cool_c')} °C onto the street around it, so it counts little here. '
            'Trees grow into their effect: about 34% by year 5, 57% by year 10 and 81% by year 20. '
            'Piling items in one spot gives less and less: a cell can never cool by more than ${n(b, 'cap_c')} °C.',
        [
          ('Trees · cool roofs', '$trees · ${roof > 0 ? '$roof m²' : '0'}'),
          ('Tree growth (year)', matPct),
          ('Most-cooled street spot', _deg(n(m, 'peak_reduction_c').toDouble(), 2)),
          if (roof > 0) ('Painted roof surfaces (map)', _deg(n(m, 'roof_surface_reduction_c').toDouble(), 1)),
          ('Street cooling, average', _deg(n(m, 'temp_reduction_c').toDouble(), 3)),
        ],
      ),
    'aqi' => (
        'Air quality',
        'Air',
        'The change in the block’s air-quality index from leaves trapping fine dust (PM2.5). Negative is better.',
        'Trees clean air, but slowly: a study of ten US cities found tree cover improved PM2.5 by at most ${n(b, 'nowak_gain_pct')}% '
            '(Atlanta, about ${n(b, 'nowak_canopy_pct').round()}% canopy). We scale that best case to the canopy your plan adds, '
            'counting ${n(b, 'canopy_m2_per_tree')} m² of crown per grown tree. Expect a small number: trees matter more for heat than for AQI.',
        [
          ('Trees × growth', '$trees × $matPct'),
          ('Canopy added to the block', '${n(b, 'added_canopy_pct')}%'),
          ('Cleaner air', '${n(b, 'aq_gain_pct')}%'),
          ('× today’s AQI', '${n(b, 'baseline_aqi')}'),
          ('= AQI change', _aqi(n(m, 'aqi_change').toDouble())),
        ],
      ),
    'co2' => (
        'CO₂ captured',
        'CO₂',
        'Carbon dioxide the trees pull out of the air each year.',
        'A fully grown street tree takes up about ${n(b, 'tree_co2_kg')} kg of CO₂ a year (measured street trees: 4–13 kg; large trees up to 340 kg). '
            'Young trees count in proportion to how grown they are. Roofs and bus stops capture none.',
        [
          ('Trees', '$trees'),
          ('× kg per tree per year', '${n(b, 'tree_co2_kg')}'),
          ('× growth', matPct),
          ('= per year', '${n(m, 'co2_captured_kg_per_year')} kg'),
        ],
      ),
    'exposure' => (
        'Heat exposure',
        'exposure',
        'The share of outdoor space (streets, parks, open ground) that is still dangerously hot.',
        '“Dangerously hot” means hotter than ${n(b, 'hot_threshold_c')} °C, the temperature that the hottest ${100 - n(b, 'hot_percentile')}% of outdoor cells reach today. '
            'A shaded bus stop removes its cell from the count, because people wait in its shade.',
        [
          ('Outdoor cells', '${n(b, 'outdoor_cells')}'),
          ('Too hot today', '${n(b, 'exposed_before')}'),
          ('Too hot with the plan', '${n(b, 'exposed_after')}'),
          ('= still exposed', '${n(m, 'heat_exposure_pct')}%'),
        ],
      ),
    'cost' => (
        'Cost',
        'Cost',
        'What the plan would cost to build, before vendor quotes.',
        'Trees ${inr(n(unit, 'tree'))} each (sapling, planting and 3 years of care). Cool-roof coating ${inr(n(unit, 'cool_roof'))} per m² of roof. '
            'Shaded bus stop ${inr(n(unit, 'shade_stop'))} each.',
        [
          ('$trees trees', inr(n(parts, 'tree'))),
          ('$roof m² of roof', inr(n(parts, 'cool_roof'))),
          ('$stops bus stops', inr(n(parts, 'shade_stop'))),
          ('= total', inr(n(m, 'total_cost_inr'))),
        ],
      ),
    _ => (
        '₹ per °C',
        '°C',
        'Value for money: how many rupees buy one degree of street-level cooling. Lower is better.',
        'Total cost divided by the average street cooling.',
        [
          ('Total cost', inr(n(m, 'total_cost_inr'))),
          ('÷ street cooling', '${n(m, 'temp_reduction_c')} °C'),
          ('= per °C', m?['cost_per_degree_inr'] == null ? '—' : inr(n(m, 'cost_per_degree_inr'))),
        ],
      ),
  };

  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    constraints: BoxConstraints(maxWidth: 640, maxHeight: MediaQuery.sizeOf(context).height * 0.88),
    builder: (ctx) => SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(Leaf.gutter + 4, 0, Leaf.gutter + 4, 28 + MediaQuery.paddingOf(ctx).bottom),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SectionHead(kicker: 'How is this calculated?', title: '$title.', accent: accent, sub: what, size: 32),
        const SizedBox(height: 20),
        Reveal(delay: const Duration(milliseconds: 150), child: Text(rule, style: geist(15, color: Leaf.inkSoft, height: 1.55))),
        const SizedBox(height: 22),
        Text('YOUR PLAN, RIGHT NOW', style: mono(11)),
        const SizedBox(height: 6),
        for (final (i, (k, v)) in now.indexed)
          Reveal(
            delay: Reveal.step(i, start: 220, ms: 70),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Leaf.rule))),
              child: Row(children: [
                Expanded(child: Text(k, style: geist(14.5, color: i == now.length - 1 ? Leaf.ink : Leaf.inkSoft))),
                Text(v, style: mono(13, color: i == now.length - 1 ? Leaf.accent : Leaf.ink, w: i == now.length - 1 ? 600 : 400)),
              ]),
            ),
          ),
        const SizedBox(height: 18),
        Text('Estimates from the LeafIt grid model. Each coefficient is sourced or marked as a modelling choice; tap below to see them.',
            style: mono(11)),
        const SizedBox(height: 14),
        Align(
          alignment: Alignment.centerLeft,
          child: Pill('All assumptions', icon: Icons.arrow_forward, kind: PillKind.outline, dense: true, onTap: () {
            Navigator.pop(ctx);
            Navigator.push(context, MaterialPageRoute(builder: (_) => const AssumptionsScreen()));
          }),
        ),
      ]),
    ),
  );
}

/// "BUDGET ▬▬▬▬──── ₹3 L / ₹20 L" with an animated fill that turns warn when over.
class BudgetLine extends StatelessWidget {
  const BudgetLine({super.key, required this.cost, required this.budget});
  final double cost, budget;

  @override
  Widget build(BuildContext context) {
    final over = cost > budget;
    final color = over ? Leaf.warn : Leaf.accent;
    return Semantics(
      label: 'Budget used: ${inr(cost)} of ${inr(budget)}${over ? ', over budget' : ''}',
      child: ExcludeSemantics(
        child: Row(children: [
          Text('BUDGET', style: mono(11)),
          const SizedBox(width: 12),
          Expanded(
            child: TweenAnimationBuilder<double>(
              tween: Tween(end: budget == 0 ? 0 : (cost / budget).clamp(0.0, 1.0)),
              duration: Motion.reduced(context) ? Duration.zero : const Duration(milliseconds: 650),
              curve: Motion.ease,
              builder: (_, v, _) => Stack(children: [
                Container(height: 4, decoration: BoxDecoration(color: Leaf.rule, borderRadius: BorderRadius.circular(2))),
                FractionallySizedBox(
                  widthFactor: v,
                  child: AnimatedContainer(
                    duration: Motion.fast,
                    height: 4,
                    decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2)),
                  ),
                ),
              ]),
            ),
          ),
          const SizedBox(width: 12),
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 118), // room for "₹20.5 L / ₹20 L" so the bar never jumps
            child: AnimatedDefaultTextStyle(
              duration: Motion.fast,
              style: mono(11, color: over ? Leaf.warn : Leaf.ink),
              child: Text('${inr(cost)} / ${inr(budget)}', textAlign: TextAlign.right),
            ),
          ),
        ]),
      ),
    );
  }
}
