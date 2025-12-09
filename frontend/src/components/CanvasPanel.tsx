import React from 'react'

export type LaneScrollMetrics = {
  needScroll: boolean
  virtualHeight?: number
}

export type HoverInfo = {
  x: number
  y: number
  label: string
}

type CanvasPanelProps = {
  canvasRef: React.RefObject<HTMLCanvasElement>
  canvasWrapRef: React.RefObject<HTMLDivElement>
  laneScroll: LaneScrollMetrics
  stageLabel: string
  stageSeq: number | null
  hoverInfo: HoverInfo | null
  zoom: number
  onZoomChange: (value: number) => void
}

export default function CanvasPanel({
  canvasRef,
  canvasWrapRef,
  laneScroll,
  stageLabel,
  stageSeq,
  hoverInfo,
  zoom,
  onZoomChange,
}: CanvasPanelProps) {
  const scrollClass = `canvas-scroll${laneScroll.needScroll ? ' is-scrollable' : ''}`
  const BASE_W = 1200
  const BASE_H = (laneScroll.virtualHeight ?? 1200) + 200
  const zoomStyle: React.CSSProperties = {
    width: `${BASE_W}px`,
    height: `${BASE_H}px`,
    minWidth: '100%',
    minHeight: BASE_H,
    position: 'relative',
  }
  const canvasStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'block',
    transform: `scale(${zoom})`,
    transformOrigin: 'top left',
  }
  return (
    <div className="canvaswrap" ref={canvasWrapRef}>
      <div className={scrollClass}>
        <div className="canvas-zoom" style={zoomStyle}>
          <canvas ref={canvasRef} className="canvas" style={canvasStyle} />
        </div>
      </div>
      <div className="zoom-controls">
        <button className="zoom-btn" onClick={() => onZoomChange(Math.max(0.5, zoom - 0.1))}>−</button>
        <div className="zoom-readout">{Math.round(zoom * 100)}%</div>
        <button className="zoom-btn" onClick={() => onZoomChange(Math.min(2, zoom + 0.1))}>＋</button>
      </div>
      <div className="stagehud">
        <div className="stagetext">Stage: {stageLabel} · seq: {stageSeq ?? '-'}</div>
      </div>
      {hoverInfo && (
        <div className="hovercard" style={{ left: hoverInfo.x + 12, top: hoverInfo.y + 12 }}>
          {hoverInfo.label}
        </div>
      )}
    </div>
  )
}
