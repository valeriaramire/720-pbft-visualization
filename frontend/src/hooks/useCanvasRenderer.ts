import { useCallback, useEffect } from 'react'
import type { LayoutMode, State } from '../types'

export const LANE_HEADER_BAND = 56
export const LANE_TITLE_Y = 16
export const LANE_TOP_OFFSET = LANE_HEADER_BAND + 20
export const LANE_BOTTOM_MARGIN = 140
export const LANE_MIN_SPACING = 32
export const LANE_PREFERRED_SPACING = 54
export const LANE_SCROLL_FALLBACK_THRESHOLD = 18
const MIN_NODE_RADIUS = 6
const MAX_NODE_RADIUS = 22
const RING_NODE_MIN_GAP = 6

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function computeRingNodeRadius(width: number, height: number, orbitRadius: number, n: number) {
  const viewportBased = Math.min(width, height) * 0.03
  if (n <= 1) return clamp(viewportBased, MIN_NODE_RADIUS, MAX_NODE_RADIUS)
  const circumference = 2 * Math.PI * Math.max(orbitRadius, 1)
  const spacing = circumference / n
  const spacingLimited = (spacing - RING_NODE_MIN_GAP) / 2
  const target = Math.min(viewportBased, spacingLimited)
  return clamp(target, MIN_NODE_RADIUS, MAX_NODE_RADIUS)
}

export function useCanvasRenderer(
  state: State,
  primaryId: number,
  canvasRef: React.RefObject<HTMLCanvasElement>,
  faultySet?: Set<number>,
  mode: LayoutMode = 'ring',
) {
  const colors = {
    bg: '#0f1424',
    panel: '#1b2140',
    idle: '#2c3759',
    preprepare: '#4ea3ff',
    prepare: '#ff9e57',
    commit: '#66d08b',
    text: '#e6ebff',
    primaryRing: '#ffd94a',
    pulse: '#7bb7ff',
    client: '#86e0ff',
    reply: '#ffd94a',
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.floor(rect.width * dpr)
    canvas.height = Math.floor(rect.height * dpr)
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, rect.width, rect.height)

    const W = rect.width
    const H = rect.height
    const cx = W / 2
    const cy = H / 2
    const radius = Math.max(60, Math.min(W, H) * 0.35)

    const positions: { x: number; y: number }[] = []
    const n = state.n
    const nodeR = computeRingNodeRadius(W, H, radius, n)
    if (mode === 'ring') {
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2
        positions.push({ x: cx + Math.cos(ang) * radius, y: cy + Math.sin(ang) * radius })
      }
    } else {
      const top = LANE_TOP_OFFSET
      const bottom = H - LANE_BOTTOM_MARGIN
      const lanes = n + 1
      for (let i = 0; i < n; i++) {
        const row = i + 1
        const y = top + ((bottom - top) * row) / (lanes - 1)
        positions.push({ x: 0, y })
      }
      const reqX = W * 0.18
      const ppX = W * 0.36
      const prepX = W * 0.56
      const comX = W * 0.72
      const comFanX = W * 0.84
      const repX = W * 0.94
      const stageXs = [reqX, ppX, prepX, comX, comFanX, repX]
      ctx.strokeStyle = 'rgba(230,235,255,0.2)'
      ctx.setLineDash([6, 6])
      for (const x of stageXs) {
        ctx.beginPath()
        ctx.moveTo(x, top - 20)
        ctx.lineTo(x, bottom + 20)
        ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.fillStyle = colors.text
      ctx.font = '13px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const mid01 = (reqX + ppX) / 2
      const mid12 = (ppX + prepX) / 2
      const mid23 = (prepX + comX) / 2
      const mid34 = (comX + comFanX) / 2
      const mid45 = (comFanX + repX) / 2
      ctx.fillText('Request', mid01, LANE_TITLE_Y)
      ctx.fillText('PrePrepare', mid12, LANE_TITLE_Y)
      ctx.fillText('Prepare', mid23, LANE_TITLE_Y)
      ctx.fillText('Commit', mid34, LANE_TITLE_Y)
      ctx.fillText('Reply', mid45, LANE_TITLE_Y)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'

      const clientY = top + ((bottom - top) * 0) / (lanes - 1)
      ctx.fillText('Client', 12, clientY + 4)
      for (let i = 0; i < n; i++) {
        const row = i + 1
        const y = top + ((bottom - top) * row) / (lanes - 1)
        ctx.fillText(`Replica ${i}`, 12, y + 4)
      }

      const now = performance.now()
      const PULSE_MS = 1800
      const messages = state.messages.filter((m) => now - m.t < PULSE_MS)
      const laneY = (idx: number) => top + ((bottom - top) * (idx + 1)) / (lanes - 1)

      for (const m of messages) {
        const age = now - m.t
        const alpha = 1 - Math.min(1, age / PULSE_MS)
        if (m.type === 'Client') {
          ctx.strokeStyle = `rgba(134, 224, 255, ${alpha.toFixed(3)})`
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(reqX, clientY)
          ctx.lineTo(ppX, laneY(0))
          ctx.stroke()
          continue
        }
        if (m.type === 'PrePrepare' && m.to && m.to.length) {
          ctx.strokeStyle = `rgba(126,183,255,${alpha.toFixed(3)})`
          for (const j of m.to) {
            ctx.beginPath()
            ctx.moveTo(ppX, laneY(m.from))
            ctx.lineTo(prepX, laneY(j))
            ctx.stroke()
          }
          continue
        }
        if (m.type === 'Prepare' || m.type === 'Commit') {
          const x = m.type === 'Prepare' ? prepX : comX
          const x2 = m.type === 'Prepare' ? comX : comFanX
          const color = m.type === 'Prepare' ? '255,158,87' : '102,208,139'
          ctx.strokeStyle = `rgba(${color},${alpha.toFixed(3)})`
          for (let j = 0; j < n; j++) {
            if (j === m.from) continue
            if (m.type === 'Prepare' && m.from === 0) continue
            ctx.beginPath()
            ctx.moveTo(x, laneY(m.from))
            ctx.lineTo(x2, laneY(j))
            ctx.stroke()
          }
          continue
        }
        if (m.type === 'Reply') {
          ctx.strokeStyle = `rgba(255,217,74,${alpha.toFixed(3)})`
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(comFanX, laneY(m.from))
          ctx.lineTo(repX, clientY)
          ctx.stroke()
          continue
        }
      }
      for (let i = 0; i < n; i++) {
        const y = laneY(i)
        ctx.fillStyle = colors.preprepare
        ctx.beginPath()
        ctx.arc(ppX, y, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'
        ctx.lineWidth = 1
        ctx.stroke()

        ctx.fillStyle = colors.prepare
        ctx.beginPath()
        ctx.arc(prepX, y, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'
        ctx.lineWidth = 1
        ctx.stroke()

        ctx.fillStyle = colors.commit
        ctx.beginPath()
        ctx.arc(comX, y, 7.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.lineWidth = 2
        ctx.stroke()

        ctx.fillStyle = colors.commit
        ctx.beginPath()
        ctx.arc(comFanX, y, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'
        ctx.lineWidth = 1.5
        ctx.stroke()

        if (i === primaryId) {
          ctx.strokeStyle = colors.primaryRing
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(ppX, y, 9, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      return
    }

    const now = performance.now()
    const PULSE_MS = 1800
    const messages = state.messages.filter((m) => now - m.t < PULSE_MS)

    const clientPos = { x: cx, y: cy - (radius + 160) }
    ctx.fillStyle = colors.client
    ctx.beginPath()
    ctx.arc(clientPos.x, clientPos.y, Math.max(6, nodeR * 0.8), 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = colors.text
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Client', clientPos.x, clientPos.y - 10)
    for (const m of messages) {
      const age = now - m.t
      const alpha = 1 - Math.min(1, age / PULSE_MS)
      if (m.type === 'Client' && m.to && m.to.length) {
        const q = positions[primaryId]
        ctx.strokeStyle = `rgba(134, 224, 255, ${alpha.toFixed(3)})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(clientPos.x, clientPos.y)
        ctx.lineTo(q.x, q.y)
        ctx.stroke()
        continue
      }
      if (m.type === 'PrePrepare' && m.to && m.to.length > 0) {
        const p = positions[m.from]
        for (const j of m.to) {
          const q = positions[j]
          ctx.strokeStyle = `rgba(126, 183, 255, ${alpha.toFixed(3)})`
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(q.x, q.y)
          ctx.stroke()
        }
      }
      if (m.type === 'Prepare' || m.type === 'Commit') {
        const p = positions[m.from]
        for (let j = 0; j < positions.length; j++) {
          if (j === m.from) continue
          const q = positions[j]
          const color = m.type === 'Prepare' ? '255, 158, 87' : '102, 208, 139'
          ctx.strokeStyle = `rgba(${color}, ${alpha.toFixed(3)})`
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(q.x, q.y)
          ctx.stroke()
        }
      }
      if (m.type === 'Reply') {
        const q = clientPos
        const p = positions[m.from]
        ctx.strokeStyle = `rgba(255, 217, 74, ${alpha.toFixed(3)})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(q.x, q.y)
        ctx.stroke()
      }
    }

    for (let i = 0; i < n; i++) {
      const pos = positions[i]
      const phase = state.nodePhase.get(i) || 'idle'
      const fill =
        phase === 'idle'
          ? colors.idle
          : phase === 'preprepare'
            ? colors.preprepare
            : phase === 'prepare'
              ? colors.prepare
              : colors.commit
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, nodeR, 0, Math.PI * 2)
      ctx.fill()

      if (i === primaryId) {
        ctx.strokeStyle = colors.primaryRing
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, nodeR + 4, 0, Math.PI * 2)
        ctx.stroke()
      }
      if (faultySet && faultySet.has(i)) {
        ctx.strokeStyle = '#ff5c5c'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, nodeR + 7, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cx, cy, radius + 24, 0, Math.PI * 2)
    ctx.stroke()

    for (const m of messages) {
      const pos = positions[m.from] ?? clientPos
      const age = now - m.t
      const t = Math.min(1, age / PULSE_MS)
      const r = nodeR + 4 + t * 16
      const alpha = 1 - t
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
      ctx.stroke()
    }
  }, [canvasRef, state.messages, state.n, state.nodePhase, faultySet, mode])

  useEffect(() => {
    let raf = 0
    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draw])
}
