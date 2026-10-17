import { RotateCcw, RotateCw, Locate } from 'lucide-react';
import { CircleBtn, Glass } from '../../../shared/ui';
import { HEAT_STOPS } from '../../../shared/heatmap/draw.js';

/** What the heat colours mean: the area's own surface-temperature range (hot-season satellite baseline). */
export function HeatLegend({ lo, hi }) {
  const bar = `linear-gradient(to right, ${HEAT_STOPS.map(([r, g, b]) => `rgb(${r},${g},${b})`).join(',')})`;
  return (
    <div style={{ position: 'absolute', left: 12, top: 10, pointerEvents: 'none' }}>
      <Glass radius={14} padding="9px 12px">
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--muted)', marginBottom: 6 }}>SURFACE HEAT · HOT SEASON</div>
        <div style={{ width: 170, height: 6, borderRadius: 3, background: bar }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink)', marginTop: 5 }}>
          <span>{lo.toFixed(1)} °C</span><span>{hi.toFixed(1)} °C</span>
        </div>
      </Glass>
    </div>
  );
}

/** Quick quarter turns and a reset; everything else is direct: drag to turn and tilt, right-drag to move, scroll to zoom. */
export function TurnControl({ azimuth, onTurn, onReset }) {
  return (
    <div style={{ position: 'absolute', right: 12, bottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
      <CircleBtn icon={RotateCcw} tooltip="Turn left" onClick={() => onTurn(azimuth - Math.PI / 4)} />
      <CircleBtn icon={RotateCw} tooltip="Turn right" onClick={() => onTurn(azimuth + Math.PI / 4)} />
      <CircleBtn icon={Locate} tooltip="Reset view" onClick={onReset} />
    </div>
  );
}
