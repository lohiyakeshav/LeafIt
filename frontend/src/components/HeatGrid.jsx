import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { drawHeatGrid, drawPlacements, drawLandmarks, HEAT_STOPS } from '../utils/heatGrid.js';
import { Glass } from './UI.jsx';
import { ZoomIn, ZoomOut, Maximize, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const HEAT_CSS = `linear-gradient(to right, ${HEAT_STOPS.map(([r,g,b]) => `rgb(${r},${g},${b})`).join(',')})`;

/**
 * HeatGrid — full digital twin canvas, mirroring the Flutter HeatGrid widget.
 * Four layered canvases: heat image | placements | landmarks | ripple
 */
export default function HeatGrid({ block, placements = [], cooling, showAfter = true, onTap, onLongPress, readOnly = false }) {
  const navigate = useNavigate();
  const containerRef = useRef();
  const heatRef    = useRef();
  const itemsRef   = useRef();
  const landRef    = useRef();
  const rippleRef  = useRef();

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const longPressTimer = useRef();
  const rippleAnim = useRef();

  const size = { width: block?.cols ?? 60, height: block?.rows ?? 60 };
  const aspect = size.width / size.height;

  // Render heat layer whenever cooling/showAfter changes
  useEffect(() => {
    if (!block || !heatRef.current) return;
    const canvas = heatRef.current;
    drawHeatGrid(canvas, block, cooling, showAfter);
  }, [block, cooling, showAfter]);

  // Render placements layer
  useEffect(() => {
    if (!block || !itemsRef.current) return;
    drawPlacements(itemsRef.current, block, showAfter ? placements : []);
  }, [block, placements, showAfter]);

  // Render landmark labels
  useEffect(() => {
    if (!block || !landRef.current) return;
    drawLandmarks(landRef.current, block, zoom);
  }, [block, zoom]);

  // Ripple animation on placement
  const lastPlacement = placements[placements.length - 1];
  const [lastCell, setLastCell] = useState(null);
  const [ripplePct, setRipplePct] = useState(0);

  const playRipple = useCallback((row, col) => {
    setLastCell({ row, col });
    setRipplePct(0);
    const start = performance.now();
    const dur = 700;
    function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      setRipplePct(t);
      if (t < 1) rippleAnim.current = requestAnimationFrame(tick);
    }
    cancelAnimationFrame(rippleAnim.current);
    rippleAnim.current = requestAnimationFrame(tick);
  }, []);

  // Draw ripple canvas
  useEffect(() => {
    const canvas = rippleRef.current;
    if (!canvas || !block || !lastCell) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (ripplePct <= 0 || ripplePct >= 1) return;
    const cw = canvas.width / block.cols, ch = canvas.height / block.rows;
    const unit = Math.min(cw, ch);
    ctx.beginPath();
    ctx.arc(
      (lastCell.col + 0.5) * cw,
      (lastCell.row + 0.5) * ch,
      unit * 5 * ripplePct, 0, Math.PI * 2,
    );
    ctx.strokeStyle = `rgba(158,227,95,${1 - ripplePct})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [ripplePct, lastCell, block]);

  // Hit test: map pointer position to (row, col) accounting for zoom/pan
  function hitTest(e) {
    const canvas = heatRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    if (x < 0 || y < 0 || x > canvas.width / zoom || y > canvas.height / zoom) return null;
    const col = Math.floor(x / (canvas.width / zoom) * block.cols);
    const row = Math.floor(y / (canvas.height / zoom) * block.rows);
    if (col < 0 || row < 0 || col >= block.cols || row >= block.rows) return null;
    return { row, col };
  }

  function handlePointerDown(e) {
    if (readOnly) return;
    dragging.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };

    longPressTimer.current = setTimeout(() => {
      const cell = hitTest(e);
      if (cell) onLongPress?.(cell.row, cell.col);
    }, 500);
  }

  function handlePointerMove(e) {
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      dragging.current = true;
      clearTimeout(longPressTimer.current);
    }
  }

  function handlePointerUp(e) {
    clearTimeout(longPressTimer.current);
    if (!dragging.current && !readOnly) {
      const cell = hitTest(e);
      if (cell) {
        const result = onTap?.(cell.row, cell.col);
        if (result !== false) playRipple(cell.row, cell.col);
      }
    }
    dragging.current = false;
  }

  function handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom(z => Math.min(6, Math.max(1, z * delta)));
  }

  function doZoom(factor) {
    if (factor === 0) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    setZoom(z => Math.min(6, Math.max(1, z * factor)));
  }

  const canvasStyle = {
    position: 'absolute', inset: 0, width: '100%', height: '100%',
    imageRendering: 'pixelated',
  };

  const canvasW = 600, canvasH = Math.round(600 / aspect);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', paddingBottom: `${100 / aspect}%`, background: 'var(--sunk)', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--rule)' }}
    >
      <div
        style={{ position: 'absolute', inset: 0, cursor: readOnly ? 'default' : 'crosshair', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        <div style={{ position: 'absolute', inset: 0, transform: `scale(${zoom})`, transformOrigin: 'top left', transition: zoom === 1 ? 'transform 0.3s' : undefined }}>
          <canvas ref={heatRef}   width={canvasW} height={canvasH} style={canvasStyle} />
          <canvas ref={itemsRef}  width={canvasW} height={canvasH} style={canvasStyle} />
          <canvas ref={landRef}   width={canvasW} height={canvasH} style={canvasStyle} />
          <canvas ref={rippleRef} width={canvasW} height={canvasH} style={canvasStyle} />
        </div>
      </div>

      {/* Zoom controls */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
        <Glass radius={22} padding="4px 0">
          {[
            { icon: ZoomIn, label: 'Zoom in', action: () => doZoom(1.6) },
            { icon: ZoomOut, label: 'Zoom out', action: () => doZoom(1 / 1.6) },
            { icon: Maximize, label: 'Fit', action: () => doZoom(0) },
          ].map(({ icon: Icon, label, action }, i, arr) => (
            <div key={label}>
              <button
                title={label}
                onClick={action}
                style={{ width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--ink)' }}
              >
                <Icon size={19} />
              </button>
              {i < arr.length - 1 && <div style={{ height: 1, background: 'var(--rule)' }} />}
            </div>
          ))}
        </Glass>
      </div>

      {/* Heat legend + Estimates badge */}
      <div style={{ position: 'absolute', bottom: 10, left: 10, right: 10, display: 'flex', gap: 8, alignItems: 'center', zIndex: 10 }}>
        {block && (
          <Glass padding="8px 12px" style={{ flex: 1, maxWidth: 280 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)' }}>{Math.round(block.minT)}°</span>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: HEAT_CSS }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{Math.round(block.maxT)}° surface</span>
            </div>
          </Glass>
        )}
        <Glass
          padding="8px 12px"
          onClick={() => navigate('/assumptions')}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Info size={13} color="var(--ink)" />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)' }}>ESTIMATES</span>
        </Glass>
      </div>
    </div>
  );
}
