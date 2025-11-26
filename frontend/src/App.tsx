import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import CanvasPanel, { LaneScrollMetrics } from './components/CanvasPanel'
import { useNDJSONSocket } from './hooks/useNDJSONSocket'
import {
  useCanvasRenderer,
  LANE_BOTTOM_MARGIN,
  LANE_MIN_SPACING,
  LANE_PREFERRED_SPACING,
  LANE_SCROLL_FALLBACK_THRESHOLD,
  LANE_TOP_OFFSET,
  MessageMarker,
} from './hooks/useCanvasRenderer'
import { initialState, reducer } from './state'
import type { Envelope, LayoutMode } from './types'

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [mode, setMode] = useState<'demo' | 'live'>('demo')
  const [url, setUrl] = useState('http://localhost:8002/stream')
  const [demoRunning, setDemoRunning] = useState(false)
  const [demoEps, setDemoEps] = useState(3)
  const [nInput, setNInput] = useState<number>(initialState.n)
  const [fInput, setFInput] = useState<number>(initialState.f)
  const [faultyInput, setFaultyInput] = useState<string>('')
  const [layout, setLayout] = useState<LayoutMode>('ring')
  const [liveMessage, setLiveMessage] = useState<string>('')
  const [paused, setPaused] = useState(false)
  const lastEidRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const faultySetRef = useRef<Set<number>>(new Set())
  const [canvasViewportHeight, setCanvasViewportHeight] = useState(0)
  const markerRef = useRef<MessageMarker[]>([])
  const [hoverInfo, setHoverInfo] = useState<MessageMarker | null>(null)
  const logicalTimeRef = useRef<number | null>(null)

  useEffect(() => {
    lastEidRef.current = state.lastEid
  }, [state.lastEid])

  useLayoutEffect(() => {
    const host = canvasWrapRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { height } = entry.contentRect
      setCanvasViewportHeight(Math.round(height))
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const onEvent = useCallback((env: Envelope) => {
    const t = logicalTimeRef.current ?? performance.now()
    if (env.type === 'SessionStart') {
      dispatch({ kind: 'sessionStart', n: env.data?.n ?? state.n, f: env.data?.f ?? state.f })
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
  }, [state.n, state.f])

  const { status, connect, disconnect } = useNDJSONSocket(url, onEvent, lastEidRef)

  useEffect(() => {
    dispatch({ kind: 'connected', value: status === 'connected' })
    if (status === 'connected' && demoRunning) {
      setDemoRunning(false)
    }
  }, [status, demoRunning])

  useEffect(() => {
    let raf = 0
    const loop = () => {
      if (!paused) {
        logicalTimeRef.current = performance.now()
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [paused])

  useEffect(() => {
    setNInput(state.n)
    setFInput(state.f)
  }, [state.n, state.f])

  useCanvasRenderer(state, 0, canvasRef, faultySetRef.current, layout, markerRef, logicalTimeRef)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handleMove = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = ev.clientX - rect.left
      const y = ev.clientY - rect.top
      let best: MessageMarker | null = null
      let bestDist = 14
      for (const m of markerRef.current) {
        const dx = m.x - x
        const dy = m.y - y
        const d2 = Math.sqrt(dx * dx + dy * dy)
        if (d2 < bestDist) {
          best = m
          bestDist = d2
        }
      }
      setHoverInfo(best)
    }
    const handleLeave = () => setHoverInfo(null)
    canvas.addEventListener('mousemove', handleMove)
    canvas.addEventListener('mouseleave', handleLeave)
    return () => {
      canvas.removeEventListener('mousemove', handleMove)
      canvas.removeEventListener('mouseleave', handleLeave)
    }
  }, [])

  const laneScrollMetrics = useMemo<LaneScrollMetrics>(() => {
    if (layout !== 'lanes') return { needScroll: false, virtualHeight: undefined }
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

  const demoTimerRef = useRef<number | null>(null)
  const localEidRef = useRef<number>(0)
  const demoRef = useRef({ seq: 1, stage: 'client' as 'client' | 'pp' | 'prep' | 'commit', r: 0, pauseUntil: 0 })
  const manualInitializedRef = useRef<boolean>(false)

  useEffect(() => {
    if (!demoRunning) {
      if (demoTimerRef.current) {
        clearInterval(demoTimerRef.current)
        demoTimerRef.current = null
      }
      return
    }
    dispatch({ kind: 'sessionStart', n: state.n, f: state.f })
    localEidRef.current = 0
    demoRef.current = { seq: 1, stage: 'client', r: 0, pauseUntil: 0 }
    const parsed = new Set<number>()
    const fi = typeof faultyInput === 'string' ? faultyInput : ''
    fi
      .split(',')
      .map((s) => String(s).trim())
      .filter(Boolean)
      .forEach((s) => {
        const v = parseInt(s, 10)
        if (!isNaN(v)) parsed.add(v)
      })
    faultySetRef.current = parsed

    const tick = () => {
      if (paused) return
      const t = logicalTimeRef.current ?? performance.now()
      const { seq, stage, r } = demoRef.current
      const n = state.n
      const bump = () => {
        localEidRef.current += 1
        return localEidRef.current
      }
      if (t < (demoRef.current as any).pauseUntil) return
      const pause = (ms: number) => {
        ;(demoRef.current as any).pauseUntil = t + ms
      }
      if (stage === 'client') {
        dispatch({ kind: 'client', to: 0, t, eid: bump() })
        dispatch({ kind: 'stage', label: 'Client Request', seq })
        demoRef.current.stage = 'pp'
        pause(350)
        return
      }
      if (stage === 'pp') {
        const to = Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 1)
        dispatch({ kind: 'prePrepare', seq, from: 0, to, t, eid: bump() })
        dispatch({ kind: 'stage', label: 'PrePrepare', seq })
        demoRef.current.stage = 'prep'
        demoRef.current.r = 0
        pause(350)
        return
      }
      if (stage === 'prep') {
        if (r < n) {
          if (!faultySetRef.current.has(r)) {
            dispatch({ kind: 'prepare', from: r, t, eid: bump() })
          }
          dispatch({ kind: 'stage', label: 'Prepare', seq })
          demoRef.current.r = r + 1
          pause(180)
        } else {
          demoRef.current.stage = 'commit'
          demoRef.current.r = 0
          pause(250)
        }
        return
      }
      if (stage === 'commit') {
        if (r < n) {
          if (!faultySetRef.current.has(r)) {
            dispatch({ kind: 'commit', from: r, t, eid: bump() })
          }
          dispatch({ kind: 'stage', label: 'Commit', seq })
          demoRef.current.r = r + 1
          pause(180)
        } else {
          ;(demoRef.current as any).stage = 'reply'
          demoRef.current.r = 0
          pause(250)
        }
        return
      }
      if ((demoRef.current as any).stage === 'reply') {
        if (r < n) {
          if (!faultySetRef.current.has(r)) {
            dispatch({ kind: 'reply', from: r, t, eid: bump() })
          }
          dispatch({ kind: 'stage', label: 'Reply', seq })
          demoRef.current.r = r + 1
          pause(140)
        } else {
          demoRef.current.stage = 'client'
          demoRef.current.r = 0
          demoRef.current.seq = seq + 1
          pause(400)
        }
        return
      }
    }

    const intervalMs = Math.max(1, Math.floor(1000 / Math.max(1, demoEps)))
    demoTimerRef.current = window.setInterval(tick, intervalMs)
    return () => {
      if (demoTimerRef.current) clearInterval(demoTimerRef.current)
      demoTimerRef.current = null
    }
  }, [demoRunning, demoEps, state.n, state.f, faultyInput, dispatch, paused])

  const initDemoManual = useCallback(() => {
    dispatch({ kind: 'sessionStart', n: state.n, f: state.f })
    localEidRef.current = 0
    demoRef.current = { seq: 1, stage: 'client', r: 0, pauseUntil: 0 }
    const parsed = new Set<number>()
    const fi = typeof faultyInput === 'string' ? faultyInput : ''
    fi
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => {
        const v = parseInt(s, 10)
        if (!isNaN(v)) parsed.add(v)
      })
    faultySetRef.current = parsed
    manualInitializedRef.current = true
  }, [dispatch, state.n, state.f, faultyInput])

  const manualTick = useCallback(() => {
    const t = logicalTimeRef.current ?? performance.now()
    const { seq, stage, r } = demoRef.current
    const n = state.n
    const bump = () => {
      localEidRef.current += 1
      return localEidRef.current
    }
    if (stage === 'client') {
      dispatch({ kind: 'client', to: 0, t, eid: bump() })
      dispatch({ kind: 'stage', label: 'Client Request', seq })
      demoRef.current.stage = 'pp'
      return
    }
    if (stage === 'pp') {
      const to = Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 1)
      dispatch({ kind: 'prePrepare', seq, from: 0, to, t, eid: bump() })
      dispatch({ kind: 'stage', label: 'PrePrepare', seq })
      demoRef.current.stage = 'prep'
      demoRef.current.r = 0
      return
    }
    if (stage === 'prep') {
      if (r < n) {
        if (!faultySetRef.current.has(r)) {
          dispatch({ kind: 'prepare', from: r, t, eid: bump() })
        }
        dispatch({ kind: 'stage', label: 'Prepare', seq })
        demoRef.current.r = r + 1
      } else {
        demoRef.current.stage = 'commit'
        demoRef.current.r = 0
      }
      return
    }
    if (stage === 'commit') {
      if (r < n) {
        if (!faultySetRef.current.has(r)) {
          dispatch({ kind: 'commit', from: r, t, eid: bump() })
        }
        dispatch({ kind: 'stage', label: 'Commit', seq })
        demoRef.current.r = r + 1
      } else {
        demoRef.current.stage = 'client'
        demoRef.current.r = 0
        demoRef.current.seq = seq + 1
      }
      return
    }
  }, [dispatch, state.n])

  const handleConnect = useCallback(() => {
    if (demoRunning) setDemoRunning(false)
    connect()
  }, [connect, demoRunning])

  const handleToggleMode = useCallback(() => {
    if (mode === 'demo') {
      setDemoRunning(false)
      setMode('live')
    } else {
      disconnect()
      setMode('demo')
    }
  }, [mode, disconnect])

  const handleApplyConfig = useCallback(() => {
    const nVal = Math.max(1, Math.floor(nInput))
    const maxF = Math.floor((nVal - 1) / 3)
    const fVal = Math.max(0, Math.min(maxF, Math.floor(fInput)))
    dispatch({ kind: 'sessionStart', n: nVal, f: fVal })
  }, [dispatch, nInput, fInput])

  const handleNextStep = useCallback(() => {
    if (demoRunning) setDemoRunning(false)
    if (!manualInitializedRef.current) initDemoManual()
    manualTick()
  }, [demoRunning, initDemoManual, manualTick])

  const handleStartDemo = useCallback(() => {
    setPaused(false)
    setDemoRunning(true)
  }, [])
  const handleStopDemo = useCallback(() => {
    setDemoRunning(false)
    setPaused(false)
  }, [])

  const handleSendLiveMessage = useCallback(() => {
    // TODO: hook into backend send endpoint when available
    console.log('Live message send requested:', liveMessage)
  }, [liveMessage])

  const statusLabel = mode === 'demo' ? (demoRunning ? 'demo' : 'idle') : status
  const statusClass = mode === 'demo' && demoRunning ? 'connected' : status

  const handleTogglePause = useCallback(() => {
    setPaused((p) => !p)
  }, [])

  return (
    <div className="app">
      <TopBar
        mode={mode}
        onToggleMode={handleToggleMode}
        url={url}
        connectionStatus={status}
        statusClass={statusClass}
        statusLabel={statusLabel}
        lastEid={state.lastEid}
        onUrlChange={setUrl}
        onConnect={handleConnect}
        onDisconnect={disconnect}
        liveMessage={liveMessage}
        onLiveMessageChange={setLiveMessage}
        onSendLiveMessage={handleSendLiveMessage}
        demoRunning={demoRunning}
        onStartDemo={handleStartDemo}
        onStopDemo={handleStopDemo}
        onNextStep={handleNextStep}
        onContinue={handleStartDemo}
        demoEps={demoEps}
        onDemoEpsChange={setDemoEps}
        nInput={nInput}
        onNInputChange={setNInput}
        fInput={fInput}
        onFInputChange={setFInput}
        faultyInput={faultyInput}
        onFaultyInputChange={setFaultyInput}
        onApplyConfig={handleApplyConfig}
        layout={layout}
        onLayoutChange={setLayout}
        paused={paused}
        onTogglePause={handleTogglePause}
      />
      <div className="content">
        <Sidebar
          n={state.n}
          f={state.f}
          view={state.view}
          seq={state.seq}
          commits={state.commits.size}
          quorumThreshold={quorumThreshold}
        />
        <CanvasPanel
          canvasRef={canvasRef}
          canvasWrapRef={canvasWrapRef}
          laneScroll={laneScrollMetrics}
          stageLabel={state.stageLabel}
          stageSeq={state.stageSeq}
          quorumProgress={quorumProgress}
          commitCount={state.commits.size}
          quorumThreshold={quorumThreshold}
          hoverInfo={hoverInfo}
        />
      </div>
    </div>
  )
}
