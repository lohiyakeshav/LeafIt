import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Dialog, Pill } from '../ui';
import { inr } from '../lib/format.js';

/** How each metric is calculated, with this plan's live numbers. */
export function MetricWhyModal({ metricKey, metrics: m, breakdown: b, onClose }) {
  const navigate = useNavigate();
  if (!metricKey) return null;
  const nb = (k) => Number(b?.[k] ?? 0);
  const nm = (k) => Number(m?.[k] ?? 0);
  const trees = Math.round(nb('trees')), stops = Math.round(nb('stops')), roof = Math.round(nb('roof_m2'));
  const mat = nb('maturity');
  const matPct = `${Math.round(mat * 100)}%`;
  const unitCost = b?.unit_cost ?? {};
  const costParts = b?.cost_parts ?? {};

  const configs = {
    cooling: {
      title: 'Cooling', accent: 'Cooling',
      what: 'How much cooler it gets where people are: averaged over the streets, parks and open ground of the block (10 m cells).',
      rule: `Each tree cools its own cell by up to ${nb('tree_cool_c')} °C when fully grown (bigger-crowned species more, smaller less), fading out over about ${nb('tree_reach_m')} m. Trees already in or around the block (up to 150 m out) are counted first, so new trees add less where shade exists. A cool roof makes the roof itself about ${nb('roof_surface_c')} °C cooler. Trees grow into their effect: a typical tree reaches about 34% by year 5, 57% by year 10 and 81% by year 20; fast-growing species get there sooner, slow ones later.`,
      rows: [
        ['Trees · cool roofs', `${trees} · ${roof > 0 ? `${roof} m²` : '0'}`],
        ['Typical tree’s growth (year)', matPct],
        ['Most-cooled street spot', `${Math.abs(nm('peak_reduction_c')) >= 0.005 ? '−' : ''}${Math.abs(nm('peak_reduction_c')).toFixed(2)}°`],
        ['Street cooling, average', `${Math.abs(nm('temp_reduction_c')) >= 0.0005 ? '−' : ''}${Math.abs(nm('temp_reduction_c')).toFixed(3)}°`],
      ],
    },
    air: {
      title: 'Air cooling', accent: 'Air',
      what: 'How much cooler the air itself gets at head height. This is smaller than the surface figure: air mixes, so only dense canopy moves it much.',
      rule: 'A second, flatter curve with a ceiling of about 1.5 °C (the cooling measured under dense urban canopy in the literature). A line of street trees about 8 m apart lands at roughly 0.4 to 0.8 °C along that street. This is an estimate, not a measurement. Trees already standing in or beside the block count first, so new trees add less where shade already exists.',
      rows: [
        ['Trees · cool roofs', `${trees} · ${roof > 0 ? `${roof} m²` : '0'}`],
        ['Tree growth (year)', matPct],
        ['Air cooling, average', `${Math.abs(nm('air_reduction_c')) >= 0.0005 ? '−' : ''}${Math.abs(nm('air_reduction_c')).toFixed(3)}°`],
      ],
    },
    equity: {
      title: 'For vulnerable residents', accent: 'vulnerable',
      what: 'The average cooling in the most heat-exposed quarter of the block: the places with the most children under 5 and adults over 65 nearby.',
      rule: 'People come from WorldPop (100 m), split onto buildings by floor area, so the pattern is an estimate. Exposure is smoothed over about 100 m. If this number is well below the street average, the plan is cooling places where fewer vulnerable people live.',
      rows: [
        ['Street cooling, average', `${Math.abs(nm('temp_reduction_c')) >= 0.0005 ? '−' : ''}${Math.abs(nm('temp_reduction_c')).toFixed(3)}°`],
        ['Most exposed quarter', m?.equity_cooling_c == null ? 'no data' : `${Math.abs(nm('equity_cooling_c')) >= 0.0005 ? '−' : ''}${Math.abs(nm('equity_cooling_c')).toFixed(3)}°`],
      ],
    },
    aqi: {
      title: 'Air quality', accent: 'Air',
      what: "The change in the block's air-quality index from leaves trapping fine dust (PM2.5). Negative is better.",
      rule: b?.baseline_aqi == null
        ? 'There is no air-quality reading for this area, so no AQI change is claimed.'
        : 'Trees clean air, but slowly. We scale the best-case canopy improvement to your plan, counting each species’ grown crown (about 20 to 110 m² by size class).',
      rows: [
        ['Trees', `${trees}`],
        ['Canopy added', `${nb('added_canopy_pct')}%`],
        ['AQI change', b?.baseline_aqi == null ? 'no reading' : `${Math.abs(nm('aqi_change')).toFixed(2)}`],
      ],
    },
    co2: {
      title: 'CO₂ captured', accent: 'CO₂',
      what: 'Carbon dioxide the trees pull out of the air each year.',
      rule: `A fully grown street tree takes up about ${nb('tree_co2_kg')} kg of CO₂ a year. Young trees count in proportion to how grown they are.`,
      rows: [
        ['Trees', `${trees}`],
        ['kg per tree per year', `${nb('tree_co2_kg')}`],
        ['× growth', matPct],
        ['= per year', `${nm('co2_captured_kg_per_year').toFixed(0)} kg`],
      ],
    },
    exposure: {
      title: 'Heat exposure', accent: 'exposure',
      what: 'The share of outdoor space (streets, parks, open ground) that is still dangerously hot.',
      rule: `"Dangerously hot" means hotter than ${nb('hot_threshold_c')} °C. A shaded bus stop removes its cell from the count.`,
      rows: [
        ['Outdoor cells', `${nb('outdoor_cells')}`],
        ['Too hot today', `${nb('exposed_before')}`],
        ['Too hot with the plan', `${nb('exposed_after')}`],
        ['= still exposed', `${nm('heat_exposure_pct')}%`],
      ],
    },
    cost: {
      title: 'Cost', accent: 'Cost',
      what: 'What the plan would cost to build, before vendor quotes.',
      rule: `Trees ${inr(unitCost.tree ?? 0)} each. Cool-roof coating ${inr(unitCost.cool_roof ?? 0)} per m². Shaded bus stop ${inr(unitCost.shade_stop ?? 0)} each.`,
      rows: [
        [`${trees} trees`, inr(costParts.tree ?? 0)],
        [`${roof} m² of roof`, inr(costParts.cool_roof ?? 0)],
        [`${stops} bus stops`, inr(costParts.shade_stop ?? 0)],
        ['= total', inr(nm('total_cost_inr'))],
      ],
    },
    per_degree: {
      title: 'Cost per °C', accent: '°C',
      what: 'Value for money: how many rupees buy one degree of street-level cooling. Lower is better.',
      rule: 'Total cost divided by the average street cooling.',
      rows: [
        ['Total cost', inr(nm('total_cost_inr'))],
        ['÷ street cooling', `${nm('temp_reduction_c').toFixed(3)} °C`],
        ['= per °C', m?.cost_per_degree_inr == null ? '—' : inr(nm('cost_per_degree_inr'))],
      ],
    },
  };

  const cfg = configs[metricKey] ?? configs.cooling;

  return (
    <Dialog onClose={onClose}>
      <div style={{ padding: '0 4px 28px' }}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>How is this calculated?</span>
          <div style={{ height: 14 }} />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 32, fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1.02 }}>{cfg.title}.</span>
        </div>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--ink-soft)', lineHeight: 1.55, marginBottom: 16 }}>{cfg.what}</p>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: 'var(--ink-soft)', lineHeight: 1.55 }}>{cfg.rule}</p>
        <div style={{ marginTop: 22, marginBottom: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>YOUR PLAN, RIGHT NOW</div>
        {cfg.rows.map(([k, v], i) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14.5, color: i === cfg.rows.length - 1 ? 'var(--ink)' : 'var(--ink-soft)' }}>{k}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: i === cfg.rows.length - 1 ? 'var(--accent)' : 'var(--ink)', fontWeight: i === cfg.rows.length - 1 ? 600 : 400 }}>{v}</span>
          </div>
        ))}
        <div style={{ height: 18 }} />
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          Estimates from the LeafIt grid model. Every coefficient has a source; tap below to see them.
        </p>
        <div style={{ height: 12 }} />
        <Pill
          label="All assumptions"
          icon={ArrowRight}
          kind="outline"
          dense
          onClick={() => {
            onClose?.();
            navigate('/assumptions');
          }}
        />
      </div>
    </Dialog>
  );
}

