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
  quorumProgress: number
  commitCount: number
  quorumThreshold: number
  hoverInfo: HoverInfo | null
}

export default function CanvasPanel({
  canvasRef,
  canvasWrapRef,
  laneScroll,
  stageLabel,
  stageSeq,
  quorumProgress,
  commitCount,
  quorumThreshold,
  hoverInfo,
}: CanvasPanelProps) {
  const scrollClass = `canvas-scroll${laneScroll.needScroll ? ' is-scrollable' : ''}`
  const canvasStyle = laneScroll.virtualHeight ? { height: laneScroll.virtualHeight } : undefined
  return (
    <div className="canvaswrap" ref={canvasWrapRef}>
      <div className={scrollClass}>
        <canvas ref={canvasRef} className="canvas" style={canvasStyle} />
      </div>
      <div className="stagehud">
        <div className="stagetext">Stage: {stageLabel} · seq: {stageSeq ?? '-'}</div>
      </div>
      <div className="quorum">
        <div className="meter">
          <div className="fill" style={{ width: `${quorumProgress * 100}%` }} />
        </div>
        <div className="label">Commit quorum: {commitCount} / {quorumThreshold}</div>
      </div>
      {hoverInfo && (
        <div className="hovercard" style={{ left: hoverInfo.x + 12, top: hoverInfo.y + 12 }}>
          {hoverInfo.label}
        </div>
      )}
    </div>
  )
}
