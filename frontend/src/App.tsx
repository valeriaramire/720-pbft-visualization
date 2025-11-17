import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
type Phase = 'idle' | 'preprepare' | 'prepare' | 'commit'
type EventType = 'ClientRequest' | 'PrePrepare' | 'Prepare' | 'Commit' | 'Reply' | 'SessionStart' | 'PrimaryElected'

type Envelope = {
  schema_ver: number
  type: EventType
  ts: number // microseconds since session start
  sid: string
  eid: number
  view: number
  seq: number
  from: number
  to: number[]
  data: any
}

type Pulse = {
  type: 'Client' | 'PrePrepare' | 'Prepare' | 'Commit' | 'Reply'
  from: number
  to?: number[]
  t: number // ms
}

type State = {
  n: number
  f: number
  view: number
  seq: number
  prepares: Set<number>
  commits: Set<number>
  nodePhase: Map<number, Phase>
  messages: Pulse[]
  lastEid: number | null
  connected: boolean
  stageLabel: string
  stageSeq: number | null
}

type Action =
  | { kind: 'sessionStart'; n: number; f: number }
  | { kind: 'primaryElected' }
  | { kind: 'prePrepare'; seq: number; from: number; to: number[]; t: number; eid: number }
  | { kind: 'prepare'; from: number; t: number; eid: number }
  | { kind: 'commit'; from: number; t: number; eid: number }
  | { kind: 'connected'; value: boolean }
  | { kind: 'client'; to: number; t: number; eid: number }
  | { kind: 'stage'; label: string; seq: number | null }
  | { kind: 'reply'; from: number; t: number; eid: number }

const LANE_HEADER_BAND = 56
const LANE_TITLE_Y = 16
const LANE_TOP_OFFSET = LANE_HEADER_BAND + 20
const LANE_BOTTOM_MARGIN = 140
const LANE_MIN_SPACING = 32
const LANE_PREFERRED_SPACING = 54
const LANE_SCROLL_FALLBACK_THRESHOLD = 18
const MIN_NODE_RADIUS = 6
const MAX_NODE_RADIUS = 22
const RING_NODE_MIN_GAP = 6
const PLAYBACK_PRESETS_EPS = [8, 4, 2, 1, 0.5]

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

const initialState: State = {
  n: 4,
  f: 1,
  view: 0,
  seq: 0,
  prepares: new Set(),
  commits: new Set(),
  nodePhase: new Map(),
  messages: [],
  lastEid: null,
  connected: false,
  stageLabel: 'Idle',
  stageSeq: null,
}

function reducer(state: State, action: Action): State {
  switch (action.kind) {
    case 'sessionStart': {
      const phases = new Map<number, Phase>()
      for (let i = 0; i < action.n; i++) phases.set(i, 'idle')
      return {
        ...state,
        n: action.n,
        f: action.f,
        view: 0,
        seq: 0,
        prepares: new Set(),
        commits: new Set(),
        nodePhase: phases,
        stageLabel: 'Session Start',
        stageSeq: 0,
      }
    }
    case 'primaryElected': {
      return state
    }
    case 'prePrepare': {
      const phases = new Map(state.nodePhase)
      phases.set(action.from, 'preprepare')
      return {
        ...state,
        seq: action.seq,
        prepares: new Set(),
        commits: new Set(),
        nodePhase: phases,
        messages: [...state.messages, { type: 'PrePrepare', from: action.from, to: action.to, t: action.t }],
        lastEid: action.eid,
        stageLabel: 'PrePrepare',
        stageSeq: action.seq,
      }
    }
    case 'prepare': {
      const prepares = new Set(state.prepares)
      prepares.add(action.from)
      const phases = new Map(state.nodePhase)
      phases.set(action.from, 'prepare')
      return {
        ...state,
        prepares,
        nodePhase: phases,
        messages: [...state.messages, { type: 'Prepare', from: action.from, t: action.t }],
        lastEid: action.eid,
        stageLabel: 'Prepare',
        stageSeq: state.seq,
      }
    }
    case 'commit': {
      const commits = new Set(state.commits)
      commits.add(action.from)
      const phases = new Map(state.nodePhase)
      phases.set(action.from, 'commit')
      return {
        ...state,
        commits,
        nodePhase: phases,
        messages: [...state.messages, { type: 'Commit', from: action.from, t: action.t }],
        lastEid: action.eid,
        stageLabel: 'Commit',
        stageSeq: state.seq,
      }
    }
    case 'reply': {
      return {
        ...state,
        messages: [...state.messages, { type: 'Reply', from: action.from, to: [-1], t: action.t }],
        lastEid: action.eid,
        stageLabel: 'Reply',
        stageSeq: state.seq,
      }
    }
    case 'connected': {
      return { ...state, connected: action.value }
    }
    case 'client': {
      return {
        ...state,
        messages: [...state.messages, { type: 'Client', from: -1, to: [action.to], t: action.t }],
        lastEid: action.eid,
        stageLabel: 'Client Request',
        stageSeq: state.seq ? state.seq + 1 : 1,
      }
    }
    case 'stage': {
      return { ...state, stageLabel: action.label, stageSeq: action.seq }
    }
    default:
      return state
  }
}

function useSSEStream(urlStr: string, onEvent: (env: Envelope) => void, lastEidRef: React.MutableRefObject<number | null>) {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const sourceRef = useRef<EventSource | null>(null)
  const retryRef = useRef<number>(0)
  const baseUrlRef = useRef<string>(urlStr)
  const shouldReconnectRef = useRef<boolean>(false)

  useEffect(() => {
    baseUrlRef.current = urlStr
  }, [urlStr])

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false
    if (sourceRef.current) {
      sourceRef.current.close()
      sourceRef.current = null
    }
    setStatus('disconnected')
  }, [])

  const openSource = useCallback(() => {
    if (!shouldReconnectRef.current) return
    if (sourceRef.current) {
      sourceRef.current.close()
      sourceRef.current = null
    }
    setStatus('connecting')
    let urlToUse = baseUrlRef.current
    const last = lastEidRef.current
    if (last !== null) {
      try {
        const u = new URL(urlToUse)
        u.searchParams.set('from_eid', String(last + 1))
        urlToUse = u.toString()
      } catch {
        // ignore malformed URL; fall back to raw string
      }
    }
    const es = new EventSource(urlToUse)
    sourceRef.current = es
    es.onopen = () => {
      setStatus('connected')
      retryRef.current = 0
    }
    es.onmessage = (event) => {
      if (!event.data) return
      try {
        const obj = JSON.parse(event.data) as Envelope
        onEvent(obj)
      } catch {
        // ignore parse errors
      }
    }
    es.onerror = () => {
      setStatus('disconnected')
      es.close()
      sourceRef.current = null
      if (!shouldReconnectRef.current) return
      const baseDelay = 300
      const attempt = Math.min(6, retryRef.current)
      const delay = baseDelay * Math.pow(2, attempt)
      retryRef.current += 1
      setTimeout(() => {
        if (shouldReconnectRef.current) {
          openSource()
        }
      }, delay)
    }
  }, [lastEidRef, onEvent])

  const connect = useCallback(() => {
    if (status === 'connected') return
    shouldReconnectRef.current = true
    openSource()
  }, [openSource, status])

  useEffect(() => () => disconnect(), [disconnect])

  return { status, connect, disconnect }
}

type LayoutMode = 'ring' | 'lanes'
function useCanvasRenderer(state: State, primaryId: number, canvasRef: React.RefObject<HTMLCanvasElement>, mode: LayoutMode = 'ring') {
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
      // lanes layout: first row client, then replicas 0..n-1 equally spaced
      // dedicate a fixed header band for phase titles
      const top = LANE_TOP_OFFSET
      const bottom = H - LANE_BOTTOM_MARGIN
      const lanes = n + 1
      for (let i = 0; i < n; i++) {
        const row = i + 1 // replicas start after client
        const y = top + ((bottom - top) * row) / (lanes - 1)
        positions.push({ x: 0, y }) // x filled later when drawing nodes
      }
      // draw lane baselines and stage columns
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
        ctx.beginPath(); ctx.moveTo(x, top - 20); ctx.lineTo(x, bottom + 20); ctx.stroke()
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

      // labels on left
      const clientY = top + ((bottom - top) * 0) / (lanes - 1)
      ctx.fillText('Client', 12, clientY + 4)
      for (let i = 0; i < n; i++) {
        const row = i + 1
        const y = top + ((bottom - top) * row) / (lanes - 1)
        ctx.fillText(`Replica ${i}`, 12, y + 4)
      }

      // draw events as lines between columns
      const now = performance.now()
      const PULSE_MS = 1800
      const messages = state.messages.filter(m => now - m.t < PULSE_MS)
      const laneY = (idx: number) => top + ((bottom - top) * (idx + 1)) / (lanes - 1) // replicas index

      for (const m of messages) {
        const age = now - m.t
        const alpha = 1 - Math.min(1, age / PULSE_MS)
        if (m.type === 'Client') {
          // client -> primary at Request column
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
          const x2 = m.type === 'Prepare' ? comX : comFanX // commit spans to separate grid
          const color = m.type === 'Prepare' ? '255,158,87' : '102,208,139'
          ctx.strokeStyle = `rgba(${color},${alpha.toFixed(3)})`
          for (let j = 0; j < n; j++) {
            if (j === m.from) continue
            if (m.type === 'Prepare' && m.from === 0) continue // skip primary in prepare fan-out
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
      // draw nodes as dots on columns (fixed per-phase colors; include comFanX)
      for (let i = 0; i < n; i++) {
        const y = laneY(i)
        // PrePrepare column
        ctx.fillStyle = colors.preprepare
        ctx.beginPath(); ctx.arc(ppX, y, 7, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke()

        // Prepare column
        ctx.fillStyle = colors.prepare
        ctx.beginPath(); ctx.arc(prepX, y, 7, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke()

        // Commit column
        ctx.fillStyle = colors.commit
        ctx.beginPath(); ctx.arc(comX, y, 7.5, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; ctx.stroke()

        // Commit fan-out column (between Commit and Reply)
        ctx.fillStyle = colors.commit
        ctx.beginPath(); ctx.arc(comFanX, y, 7, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5; ctx.stroke()

        // Primary highlight at PrePrepare column only
        if (i === primaryId) {
          ctx.strokeStyle = colors.primaryRing
          ctx.lineWidth = 2
          ctx.beginPath(); ctx.arc(ppX, y, 9, 0, Math.PI * 2); ctx.stroke()
        }
      }
      return
    }

    // Pulses
    const now = performance.now()
    const PULSE_MS = 1800
    const messages = state.messages.filter(m => now - m.t < PULSE_MS)
    
    // Client location and rendering
    const clientPos = { x: cx, y: cy - (radius + 160) }
    // client dot
    ctx.fillStyle = colors.client
    ctx.beginPath()
    ctx.arc(clientPos.x, clientPos.y, Math.max(6, nodeR * 0.8), 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = colors.text
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Client', clientPos.x, clientPos.y - 10)
    // Lines for Client->Primary and PrePrepare/Prepare/Commit/Reply
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
      // Prepare and Commit: show inter-replica lines to all others
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

    // Nodes
    for (let i = 0; i < n; i++) {
      const pos = positions[i]
      const phase = state.nodePhase.get(i) || 'idle'
      const fill = (phase === 'idle') ? colors.idle : (phase === 'preprepare') ? colors.preprepare : (phase === 'prepare') ? colors.prepare : colors.commit
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, nodeR, 0, Math.PI * 2)
      ctx.fill()

      // Primary outline
      if (i === primaryId) {
        ctx.strokeStyle = colors.primaryRing
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, nodeR + 4, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // Node pulse rings for Prepare/Commit
    for (const m of messages) {
      if (m.type === 'PrePrepare') continue
      const pos = positions[m.from]
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
  }, [canvasRef, state.messages, state.n, state.nodePhase, mode])

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

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [url, setUrl] = useState('http://localhost:8002/stream')
  const [layout, setLayout] = useState<'ring'|'lanes'>('ring')
  const [playbackDelay, setPlaybackDelay] = useState(250)
  const [queuedEvents, setQueuedEvents] = useState(0)
  const [playbackPaused, setPlaybackPaused] = useState(false)
  const lastEidRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const pendingEventsRef = useRef<Envelope[]>([])
  const fallbackNFRef = useRef({ n: initialState.n, f: initialState.f })
  const [canvasViewportHeight, setCanvasViewportHeight] = useState(0)

  useEffect(() => {
    lastEidRef.current = state.lastEid
  }, [state.lastEid])

  useLayoutEffect(() => {
    const host = canvasWrapRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const { height } = entry.contentRect
      setCanvasViewportHeight(Math.round(height))
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    fallbackNFRef.current = { n: state.n, f: state.f }
  }, [state.n, state.f])

  const processEnvelope = useCallback((env: Envelope) => {
    const t = performance.now()
    if (env.type === 'SessionStart') {
      const nextN = typeof env.data?.n === 'number' ? env.data.n : fallbackNFRef.current.n
      const nextF = typeof env.data?.f === 'number' ? env.data.f : fallbackNFRef.current.f
      dispatch({ kind: 'sessionStart', n: nextN, f: nextF })
      return
    }
    if (env.type === 'PrimaryElected') {
      dispatch({ kind: 'primaryElected' })
      return
    }
    if (env.type === 'ClientRequest') {
      dispatch({ kind: 'client', to: 0, t, eid: env.eid })
      return
    }
    if (env.type === 'PrePrepare') {
      dispatch({ kind: 'prePrepare', seq: env.seq, from: env.from, to: env.to, t, eid: env.eid })
      return
    }
    if (env.type === 'Prepare') {
      dispatch({ kind: 'prepare', from: env.from, t, eid: env.eid })
      return
    }
    if (env.type === 'Commit') {
      dispatch({ kind: 'commit', from: env.from, t, eid: env.eid })
      return
    }
    if (env.type === 'Reply') {
      dispatch({ kind: 'reply', from: env.from, t, eid: env.eid })
      return
    }
  }, [dispatch])

  const enqueueEvent = useCallback((env: Envelope) => {
    // Temporary diagnostic to inspect incoming SSE payloads in DevTools.
    console.log('[SSE] envelope', env)
    pendingEventsRef.current.push(env)
    setQueuedEvents(pendingEventsRef.current.length)
  }, [])

  const { status, connect, disconnect } = useSSEStream(url, enqueueEvent, lastEidRef)

  useEffect(() => {
    dispatch({ kind: 'connected', value: status === 'connected' })
  }, [status])

  const flushQueue = useCallback(() => {
    pendingEventsRef.current = []
    setQueuedEvents(0)
  }, [])

  useEffect(() => {
    if (status === 'disconnected') {
      flushQueue()
      setPlaybackPaused(false)
    }
  }, [flushQueue, status])

  useEffect(() => {
    let cancelled = false
    let handle: number | null = null
    const minDelay = Math.max(16, playbackDelay)

    const pump = () => {
      if (cancelled) return
      if (!playbackPaused && pendingEventsRef.current.length > 0) {
        const next = pendingEventsRef.current.shift()!
        setQueuedEvents(pendingEventsRef.current.length)
        processEnvelope(next)
      }
      handle = window.setTimeout(pump, minDelay)
    }

    handle = window.setTimeout(pump, minDelay)
    return () => {
      cancelled = true
      if (handle !== null) {
        clearTimeout(handle)
      }
    }
  }, [playbackDelay, playbackPaused, processEnvelope])

  useCanvasRenderer(state, 0, canvasRef, layout)

  const laneScrollMetrics = useMemo(() => {
    if (layout !== 'lanes') return { needScroll: false, virtualHeight: undefined as number | undefined }
    const lanes = state.n + 1
    const steps = Math.max(1, lanes - 1)
    const viewportAllowance = Math.max(0, canvasViewportHeight - (LANE_TOP_OFFSET + LANE_BOTTOM_MARGIN))
    const spacing = viewportAllowance && steps ? viewportAllowance / steps : viewportAllowance
    const hasViewport = canvasViewportHeight > 0
    const needsScrollFromHeight = hasViewport ? spacing < LANE_MIN_SPACING : false
    const fallbackNeed = !hasViewport && state.n >= LANE_SCROLL_FALLBACK_THRESHOLD
    const needScroll = needsScrollFromHeight || fallbackNeed
    if (!needScroll) return { needScroll: false, virtualHeight: undefined }
    const virtualHeight = LANE_TOP_OFFSET + LANE_BOTTOM_MARGIN + steps * LANE_PREFERRED_SPACING
    return { needScroll: true, virtualHeight }
  }, [layout, state.n, canvasViewportHeight])

  const quorumThreshold = useMemo(() => 2 * state.f + 1, [state.f])
  const quorumProgress = useMemo(() => {
    const v = quorumThreshold ? state.commits.size / quorumThreshold : 0
    return Math.max(0, Math.min(1, v))
  }, [state.commits.size, quorumThreshold])

  const buildReplayUrl = useCallback(() => {
    const uniqueGroup = `replay-${Date.now()}`
    try {
      const parsed = new URL(url)
      parsed.searchParams.set('offset', 'earliest')
      parsed.searchParams.set('group', uniqueGroup)
      parsed.searchParams.delete('from_eid')
      return parsed.toString()
    } catch {
      const sep = url.includes('?') ? '&' : '?'
      return `${url}${sep}offset=earliest&group=${uniqueGroup}`
    }
  }, [url])

  const startHistoricalReplay = useCallback(() => {
    const replayUrl = buildReplayUrl()
    setPlaybackPaused(true)
    disconnect()
    flushQueue()
    setUrl(replayUrl)
    window.setTimeout(() => {
      connect()
    }, 60)
  }, [buildReplayUrl, connect, disconnect, flushQueue])

  const togglePlaybackPaused = useCallback(() => {
    setPlaybackPaused((prev) => !prev)
  }, [])

  return (
    <div className="app">
      <div className="topbar">
        <div className="left">
          <input
            className="urlinput"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />
          {status !== 'connected' ? (
            <button className="btn" onClick={connect}>Connect</button>
          ) : (
            <button className="btn" onClick={disconnect}>Disconnect</button>
        )}
          <button className="btn" onClick={startHistoricalReplay}>
            Replay History
          </button>
          <span style={{marginLeft: 8, opacity: 0.8}}>Layout</span>
          <button className="btn" onClick={() => setLayout('ring')} disabled={layout==='ring'}>Ring</button>
          <button className="btn" onClick={() => setLayout('lanes')} disabled={layout==='lanes'}>Lanes</button>
        </div>
        <div className="right">
          <span className={`status ${status}`}>Status: {status}</span>
        </div>
      </div>
      <div className="playbackbar">
        <div className="playback-group">
          <label htmlFor="playbackDelay">Playback speed (events/s)</label>
          <select
            id="playbackDelay"
            className="smallinput"
            value={playbackDelay}
            onChange={(e) => {
              const next = parseInt(e.target.value, 10)
              setPlaybackDelay(Number.isFinite(next) ? next : 250)
            }}
          >
            {PLAYBACK_PRESETS_EPS.map((eps) => {
              const delay = Math.round(1000 / eps)
              return (
                <option key={eps} value={delay}>
                  {eps}
                </option>
              )
            })}
          </select>
        </div>
        <div className="playback-group">
          <span className="eid">Queued events: {queuedEvents}</span>
          <button className="btn" onClick={togglePlaybackPaused}>
            {playbackPaused ? 'Resume' : 'Pause'}
          </button>
          <button className="btn" onClick={flushQueue} disabled={!queuedEvents}>
            Clear queue
          </button>
        </div>
      </div>

      <div className="content">
        <div className="sidebar">
          <div className="kv"><span>n</span><strong>{state.n}</strong></div>
          <div className="kv"><span>f</span><strong>{state.f}</strong></div>
          <div className="kv"><span>view</span><strong>{state.view}</strong></div>
          <div className="kv"><span>seq</span><strong>{state.seq}</strong></div>
          <div className="kv"><span>commits</span><strong>{state.commits.size}</strong></div>
          <div className="kv"><span>quorum</span><strong>{quorumThreshold}</strong></div>
        </div>
        <div className="canvaswrap" ref={canvasWrapRef}>
          <div className={`canvas-scroll${laneScrollMetrics.needScroll ? ' is-scrollable' : ''}`}>
            <canvas
              ref={canvasRef}
              className="canvas"
              style={laneScrollMetrics.virtualHeight ? { height: laneScrollMetrics.virtualHeight } : undefined}
            />
          </div>
          <div className="stagehud">
            <div className="stagetext">Stage: {state.stageLabel} - seq: {state.stageSeq ?? '-'}</div>
          </div>
          <div className="quorum">
            <div className="meter">
              <div className="fill" style={{ width: `${quorumProgress * 100}%` }} />
            </div>
            <div className="label">Commit quorum: {state.commits.size} / {quorumThreshold}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
