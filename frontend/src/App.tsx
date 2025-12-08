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

type DemoStage = 'client' | 'pp' | 'prep' | 'commit' | 'reply'

type Snapshot = {
  state: typeof initialState
  simTime: number
  demo: { seq: number; stage: DemoStage; r: number }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [highlightType, setHighlightType] = useState<
    null | 'commit' | 'prepare' | 'preprepare' | 'reply'
  >(null)
  const [mode, setMode] = useState<'demo' | 'live'>('demo')
  const [url, setUrl] = useState('http://localhost:8002/stream')
  
  const [demoRunning, setDemoRunning] = useState(false)
  const [demoEps, setDemoEps] = useState(3)
  const [nInput, setNInput] = useState<number>(initialState.n)
  const [fInput, setFInput] = useState<number>(initialState.f)
  const [faultyInput, setFaultyInput] = useState<string>('')
  const [layout, setLayout] = useState<LayoutMode>('ring')
  const [numReplicas, setNumReplicas] = useState(4)
  const [liveMessage, setLiveMessage] = useState<string>('')
  const [liveRounds, setLiveRounds] = useState<number>(1)
  const [paused, setPaused] = useState(false)
  const [liveSendStatus, setLiveSendStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [zoom, setZoom] = useState(1)
  const lastEidRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const faultySetRef = useRef<Set<number>>(new Set())
  const [canvasViewportHeight, setCanvasViewportHeight] = useState(0)
  const markerRef = useRef<MessageMarker[]>([])
  const [hoverInfo, setHoverInfo] = useState<MessageMarker | null>(null)
  const simTimeRef = useRef<number>(0)
  const lastRealTimeRef = useRef<number | null>(null)
  const liveQueueRef = useRef<Envelope[]>([])
  const animUntilRef = useRef<number | null>(null)
  const historyRef = useRef<Snapshot[]>([])

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

  const pushSnapshot = useCallback(() => {
    const snap: Snapshot = {
      state: {
        ...state,
        prepares: new Set(state.prepares),
        commits: new Set(state.commits),
        nodePhase: new Map(state.nodePhase),
        messages: [...state.messages],
        eventLog: [...state.eventLog],
      },
      simTime: simTimeRef.current,
      demo: { ...demoRef.current },
    }
    const buf = historyRef.current
    const next = [...buf, snap]
    // keep last 80 steps
    historyRef.current = next.length > 80 ? next.slice(next.length - 80) : next
  }, [state])

  // SSE handler: just buffer raw envelopes, playback is controlled by speed slider
  const onEvent = useCallback((env: Envelope) => {
    liveQueueRef.current.push(env)
  }, [])

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
      const now = performance.now()
      if (lastRealTimeRef.current == null) {
        lastRealTimeRef.current = now
      }
      const delta = now - lastRealTimeRef.current
      lastRealTimeRef.current = now
      const canAdvance =
        !paused ||
        (animUntilRef.current != null && simTimeRef.current < animUntilRef.current)
      if (canAdvance) {
        simTimeRef.current += delta
        if (animUntilRef.current != null && simTimeRef.current >= animUntilRef.current) {
          animUntilRef.current = null
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      lastRealTimeRef.current = null
    }
  }, [paused])

  useEffect(() => {
    setNInput(state.n)
    setFInput(state.f)
  }, [state.n, state.f])

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

  // Shared tick length (ms) derived from speed slider, used by demo + live.
  // Interpret slider value as ~events per 10 seconds, so 10 -> ~1 ev/s.
  const tickMs = useMemo(
    () => Math.max(1, Math.floor(10000 / Math.max(1, demoEps))),
    [demoEps],
  )
  // Message flight time: slightly shorter than one tick so diamonds arrive before next event.
  const flightMs = useMemo(
    () => Math.max(200, Math.floor(tickMs * 0.8)),
    [tickMs],
  )

  useCanvasRenderer(state, 0, canvasRef, faultySetRef.current, layout, markerRef, simTimeRef, flightMs, paused)

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

  const quorumThreshold = useMemo(() => 2 * state.f + 1, [state.f])
  const quorumProgress = useMemo(() => {
    const v = quorumThreshold ? state.commits.size / quorumThreshold : 0
    return Math.max(0, Math.min(1, v))
  }, [state.commits.size, quorumThreshold])

  const demoTimerRef = useRef<number | null>(null)
  const localEidRef = useRef<number>(0)
  const demoRef = useRef({ seq: 1, stage: 'client' as 'client' | 'pp' | 'prep' | 'commit' | 'reply', r: 0 })
  const manualInitializedRef = useRef<boolean>(false)
  const demoInitializedRef = useRef<boolean>(false)

  // Initialize demo session once when demo starts
  useEffect(() => {
    if (demoRunning && !demoInitializedRef.current) {
      dispatch({ kind: 'sessionStart', n: state.n, f: state.f })
      localEidRef.current = 0
      demoRef.current = { seq: 1, stage: 'client', r: 0 }
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
      demoInitializedRef.current = true
    }
    if (!demoRunning) {
      demoInitializedRef.current = false
    }
  }, [demoRunning, state.n, state.f, faultyInput, dispatch])

  // Live mode playback: consume buffered SSE events at configurable rate
  useEffect(() => {
    if (mode !== 'live') return
    const timer = window.setInterval(() => {
      if (paused) return
      const env = liveQueueRef.current.shift()
      if (!env) return
      const t = simTimeRef.current
      if (env.type === 'SessionStart') {
        pushSnapshot()
        dispatch({ kind: 'sessionStart', n: env.data?.n ?? state.n, f: env.data?.f ?? state.f })
        return
      }
      if (env.type === 'PrimaryElected') {
        pushSnapshot()
        dispatch({ kind: 'primaryElected' })
        return
      }
      if (env.type === 'ClientRequest') {
        pushSnapshot()
        dispatch({ kind: 'client', to: 0, t, eid: env.eid })
        return
      }
      if (env.type === 'PrePrepare') {
        pushSnapshot()
        setHighlightType('preprepare')
        dispatch({ kind: 'prePrepare', seq: env.seq, from: env.from, to: env.to, t, eid: env.eid })
        return
      }
      if (env.type === 'Prepare') {
        pushSnapshot()
        setHighlightType('prepare') 
        dispatch({ kind: 'prepare', from: env.from, to: env.to, t, eid: env.eid })
        return
      }
      if (env.type === 'Commit') {
        pushSnapshot()
        setHighlightType('commit')
        dispatch({ kind: 'commit', from: env.from, to: env.to, t, eid: env.eid })
        return
      }
      if (env.type === 'Reply') {
        pushSnapshot()
        setHighlightType('reply') 
        dispatch({ kind: 'reply', from: env.from, t, eid: env.eid })
        return
      }
    }, tickMs)
    return () => window.clearInterval(timer)
  }, [mode, tickMs, paused, dispatch, state.n, state.f, pushSnapshot])

  // Demo tick loop, speed-controlled and pause-aware
  useEffect(() => {
    if (!demoRunning) {
      if (demoTimerRef.current) {
        clearInterval(demoTimerRef.current)
        demoTimerRef.current = null
      }
      return
    }
    const tick = () => {
      if (paused) return
      const t = simTimeRef.current
      const { seq, stage, r } = demoRef.current
      const n = state.n
      const bump = () => {
        localEidRef.current += 1
        return localEidRef.current
      }
      if (stage === 'client') {
        pushSnapshot()
        dispatch({ kind: 'client', to: 0, t, eid: bump() })
        dispatch({ kind: 'stage', label: 'Client Request', seq })
        demoRef.current.stage = 'pp'
        return
      }
      if (stage === 'pp') {
        const to = Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 1)
        pushSnapshot()
        dispatch({ kind: 'prePrepare', seq, from: 0, to, t, eid: bump() })
        dispatch({ kind: 'stage', label: 'PrePrepare', seq })
        demoRef.current.stage = 'prep'
        demoRef.current.r = 0
        return
      }
      if (stage === 'prep') {
        // Skip primary and faulty replicas so every tick with this stage produces a visible event.
        let nextR = r
        while (nextR < n && (nextR === 0 || faultySetRef.current.has(nextR))) {
          nextR += 1
        }
        if (nextR < n) {
          pushSnapshot()
          dispatch({ kind: 'prepare', from: nextR, t, eid: bump() })
          dispatch({ kind: 'stage', label: 'Prepare', seq })
          // Decide what the *next* step should be. If there is no further
          // replica that needs to send Prepare, advance to Commit now so
          // there is no extra empty tick after the last message.
          let probe = nextR + 1
          while (probe < n && (probe === 0 || faultySetRef.current.has(probe))) {
            probe += 1
          }
          if (probe >= n) {
            demoRef.current.stage = 'commit'
            demoRef.current.r = 0
          } else {
            demoRef.current.r = probe
          }
        } else {
          demoRef.current.stage = 'commit'
          demoRef.current.r = 0
        }
        return
      }
      if (stage === 'commit') {
        // Skip faulty replicas; each tick should correspond to one visible Commit.
        let nextR = r
        while (nextR < n && faultySetRef.current.has(nextR)) {
          nextR += 1
        }
        if (nextR < n) {
          pushSnapshot()
          dispatch({ kind: 'commit', from: nextR, t, eid: bump() })
          dispatch({ kind: 'stage', label: 'Commit', seq })
          let probe = nextR + 1
          while (probe < n && faultySetRef.current.has(probe)) {
            probe += 1
          }
          if (probe >= n) {
            demoRef.current.stage = 'reply'
            demoRef.current.r = 0
          } else {
            demoRef.current.r = probe
          }
        } else {
          demoRef.current.stage = 'reply'
          demoRef.current.r = 0
        }
        return
      }
      if (stage === 'reply') {
        if (r < n) {
          if (!faultySetRef.current.has(r)) {
            dispatch({ kind: 'reply', from: r, t, eid: bump() })
          }
          dispatch({ kind: 'stage', label: 'Reply', seq })
          demoRef.current.r = r + 1
        } else {
          demoRef.current.stage = 'client'
          demoRef.current.r = 0
          demoRef.current.seq = seq + 1
        }
      }
    }

    demoTimerRef.current = window.setInterval(tick, tickMs)
    return () => {
      if (demoTimerRef.current) clearInterval(demoTimerRef.current)
      demoTimerRef.current = null
    }
  }, [demoRunning, tickMs, state.n, paused])

  const initDemoManual = useCallback(() => {
    pushSnapshot()
    dispatch({ kind: 'sessionStart', n: state.n, f: state.f })
    localEidRef.current = 0
    demoRef.current = { seq: 1, stage: 'client', r: 0 }
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
  }, [dispatch, state.n, state.f, faultyInput, pushSnapshot])

  const manualTick = useCallback(() => {
    const t = simTimeRef.current
    const { seq, stage, r } = demoRef.current
    const n = state.n
    const bump = () => {
      localEidRef.current += 1
      return localEidRef.current
    }
    if (stage === 'client') {
      pushSnapshot()
      dispatch({ kind: 'client', to: 0, t, eid: bump() })
      dispatch({ kind: 'stage', label: 'Client Request', seq })
      demoRef.current.stage = 'pp'
      if (paused) animUntilRef.current = simTimeRef.current + flightMs
      return
    }
    if (stage === 'pp') {
      const to = Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 1)
      pushSnapshot()
      dispatch({ kind: 'prePrepare', seq, from: 0, to, t, eid: bump() })
      dispatch({ kind: 'stage', label: 'PrePrepare', seq })
      demoRef.current.stage = 'prep'
      demoRef.current.r = 0
      if (paused) animUntilRef.current = simTimeRef.current + flightMs
      return
    }
    if (stage === 'prep') {
      // Find the next non-primary, non-faulty replica that should send Prepare.
      let nextR = r
      while (nextR < n && (nextR === 0 || faultySetRef.current.has(nextR))) {
        nextR += 1
      }
      if (nextR < n) {
        pushSnapshot()
        dispatch({ kind: 'prepare', from: nextR, t, eid: bump() })
        dispatch({ kind: 'stage', label: 'Prepare', seq })
        // After sending, decide whether there is another replica left.
        let probe = nextR + 1
        while (probe < n && (probe === 0 || faultySetRef.current.has(probe))) {
          probe += 1
        }
        if (probe >= n) {
          demoRef.current.stage = 'commit'
          demoRef.current.r = 0
        } else {
          demoRef.current.r = probe
        }
        if (paused) animUntilRef.current = simTimeRef.current + flightMs
      } else {
        demoRef.current.stage = 'commit'
        demoRef.current.r = 0
      }
      return
    }
    if (stage === 'commit') {
      // Find the next non-faulty replica that should send Commit.
      let nextR = r
      while (nextR < n && faultySetRef.current.has(nextR)) {
        nextR += 1
      }
      if (nextR < n) {
        pushSnapshot()
        dispatch({ kind: 'commit', from: nextR, t, eid: bump() })
        dispatch({ kind: 'stage', label: 'Commit', seq })
        let probe = nextR + 1
        while (probe < n && faultySetRef.current.has(probe)) {
          probe += 1
        }
        if (probe >= n) {
          demoRef.current.stage = 'reply'
          demoRef.current.r = 0
        } else {
          demoRef.current.r = probe
        }
        if (paused) animUntilRef.current = simTimeRef.current + flightMs
      } else {
        demoRef.current.stage = 'reply'
        demoRef.current.r = 0
      }
      return
    }
    if (stage === 'reply') {
      if (r < n) {
        if (!faultySetRef.current.has(r)) {
          pushSnapshot()
          dispatch({ kind: 'reply', from: r, t, eid: bump() })
        }
        dispatch({ kind: 'stage', label: 'Reply', seq })
        demoRef.current.r = r + 1
      } else {
        demoRef.current.stage = 'client'
        demoRef.current.r = 0
        demoRef.current.seq = seq + 1
      }
      if (paused) animUntilRef.current = simTimeRef.current + flightMs
      return
    }
  }, [dispatch, state.n, paused, flightMs, pushSnapshot])

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
    // Cancel any in-flight mini animation and immediately run the next step.
    animUntilRef.current = null
    // If we haven't initialized any demo state yet (no auto demo, no manual),
    // run a one-time sessionStart. If auto demo already initialized, reuse that.
    if (!manualInitializedRef.current && !demoInitializedRef.current) {
      initDemoManual()
    }
    manualTick()
  }, [initDemoManual, manualTick])

  const handleStartDemo = useCallback(() => {
    setPaused(false)
    setDemoRunning(true)
  }, [])
  const handleStopDemo = useCallback(() => {
    setDemoRunning(false)
    setPaused(false)
  }, [])

  const handleSendLiveMessage = useCallback(async () => {
    if (!liveMessage.trim()) return
    setLiveSendStatus('sending')
    try {
      const body = new URLSearchParams()
      body.append('message', liveMessage)
      body.append('rounds', String(Math.max(1, Math.floor(liveRounds))))
      const res = await fetch('http://localhost:8002/start_run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })
      setLiveSendStatus(res.ok ? 'ok' : 'error')
    } catch (e) {
      console.error('Failed to send live request', e)
      setLiveSendStatus('error')
    }
  }, [liveMessage, liveRounds])

  const statusLabel = mode === 'demo' ? (demoRunning ? 'demo' : 'idle') : status
  const statusClass = mode === 'demo' && demoRunning ? 'connected' : status

  const handleTogglePause = useCallback(() => {
    setPaused((p) => !p)
  }, [])

  const handlePrevStep = useCallback(() => {
    const buf = historyRef.current
    if (!buf.length) return
    const snap = buf[buf.length - 1]
    historyRef.current = buf.slice(0, buf.length - 1)
    // Cancel any current animation and restore snapshot,
    // but retime message timestamps so they animate again from "now".
    animUntilRef.current = null
    const baseTime = simTimeRef.current
    simTimeRef.current = baseTime
    demoRef.current = { ...snap.demo }
    const retimedState = {
      ...snap.state,
      messages: snap.state.messages.map((m) => ({ ...m, t: baseTime })),
    }
    dispatch({ kind: 'restore', snapshot: retimedState as any })
    // Always animate the restored step once, regardless of paused flag.
    animUntilRef.current = simTimeRef.current + flightMs
  }, [dispatch, flightMs])

  const handleApplyReplicas = useCallback(() => {
  dispatch({ kind: 'sessionStart', n: numReplicas, f: state.f })
}, [dispatch, numReplicas, state.f])


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
        liveRounds={liveRounds}
        onLiveRoundsChange={setLiveRounds}
        onSendLiveMessage={handleSendLiveMessage}
        liveSendStatus={liveSendStatus}
        demoRunning={demoRunning}
        onStartDemo={handleStartDemo}
        onStopDemo={handleStopDemo}
        onNextStep={handleNextStep}
        onPrevStep={handlePrevStep}
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
        numReplicas={numReplicas}
        onNumReplicasChange={setNumReplicas}
        onApplyReplicas={handleApplyReplicas}
        
        

      />
      <div className="content">
        <Sidebar
          n={state.n}
          f={state.f}
          view={state.view}
          seq={state.seq}
          commits={state.commits.size}
          quorumThreshold={quorumThreshold}
          eventLog={state.eventLog}
          stageLabel={state.stageLabel}
          stageSeq={state.stageSeq}
          highlightType={highlightType}
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
          zoom={zoom}
          onZoomChange={setZoom}
        />
      </div>
    </div>
  )
}
