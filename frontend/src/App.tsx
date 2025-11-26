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
} from './hooks/useCanvasRenderer'
import { initialState, reducer } from './state'
import type { Envelope, LayoutMode } from './types'

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [url, setUrl] = useState('ws://localhost:8080/ws/events')
  const [demoRunning, setDemoRunning] = useState(false)
  const [demoEps, setDemoEps] = useState(3)
  const [nInput, setNInput] = useState<number>(initialState.n)
  const [fInput, setFInput] = useState<number>(initialState.f)
  const [faultyInput, setFaultyInput] = useState<string>('')
  const [layout, setLayout] = useState<LayoutMode>('ring')
  const lastEidRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const faultySetRef = useRef<Set<number>>(new Set())
  const [canvasViewportHeight, setCanvasViewportHeight] = useState(0)
  const [statusMessage, setStatusMessage] = useState<string>('Waiting for events...')


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
    const t = performance.now()
    if (env.type === 'SessionStart') {
      setStatusMessage('Starting New Session')
      dispatch({ kind: 'sessionStart', n: env.data?.n ?? state.n, f: env.data?.f ?? state.f })
      return
    }
    if (env.type === 'PrimaryElected') {
      setStatusMessage('A Primary has been elected')
      dispatch({ kind: 'primaryElected' })
      return
    }
    if (env.type === 'ClientRequest') {
      setStatusMessage('The client has sent a request to the primary node to execute an operation.')
      dispatch({ kind: 'client', to: 0, t, eid: env.eid })
      return
    }
    if (env.type === 'PrePrepare') {
      setStatusMessage('The primary broadcasts a *Pre-Prepare* message to all replicas, proposing the client’s request.')
      dispatch({ kind: 'prePrepare', seq: env.seq, from: env.from, to: env.to, t, eid: env.eid })
      return
    }
    if (env.type === 'Prepare') {
      setStatusMessage('Replicas have received the proposal and are now broadcasting *Prepare* messages to confirm it matches their log.')
      dispatch({ kind: 'prepare', from: env.from, t, eid: env.eid })
      return
    }
    if (env.type === 'Commit') {
      setStatusMessage('Nodes have collected enough *Prepare* messages and are broadcasting *Commit* messages to finalize the decision.')
      dispatch({ kind: 'commit', from: env.from, t, eid: env.eid })
      return
    }
    if (env.type === 'Reply') {
      setStatusMessage('Enough nodes have committed the request — a *Reply* is sent back to the client confirming execution.')
      dispatch({ kind: 'reply', from: env.from, t, eid: env.eid })
      return
    }
  }, [state.n, state.f])

  const { status, connect, disconnect } = useNDJSONSocket(url, onEvent, lastEidRef)

  useEffect(() => {
    dispatch({ kind: 'connected', value: status === 'connected' })
  }, [status])

  useEffect(() => {
    setNInput(state.n)
    setFInput(state.f)
  }, [state.n, state.f])

  useCanvasRenderer(state, 0, canvasRef, faultySetRef.current, layout)

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
      const t = performance.now()
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
        setStatusMessage("Client sends request to the primary.");
        dispatch({ kind: 'client', to: 0, t, eid: bump() })
        dispatch({ kind: 'stage', label: 'Client Request', seq })
        demoRef.current.stage = 'pp'
        pause(350)
        return
      }
      if (stage === 'pp') {
        setStatusMessage("Primary broadcasts a Pre-Prepare message with the proposed request.");
        const to = Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 1)
        dispatch({ kind: 'prePrepare', seq, from: 0, to, t, eid: bump() })
        dispatch({ kind: 'stage', label: 'PrePrepare', seq })
        demoRef.current.stage = 'prep'
        demoRef.current.r = 0
        pause(350)
        return
      }
      if (stage === 'prep') {
        setStatusMessage("Replicas validate the proposal and send Prepare messages.");
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
        setStatusMessage("Enough Prepare messages collected; nodes broadcast Commit messages.");
        if (r < n) {
          if (!faultySetRef.current.has(r)) {
            dispatch({ kind: 'commit', from: r, t, eid: bump() })
          }
          dispatch({ kind: 'stage', label: 'Commit', seq })
          demoRef.current.r = r + 1
          pause(180)
        } else {
          setStatusMessage("Replicas send a Reply to the client confirming execution.");
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
  }, [demoRunning, demoEps, state.n, state.f, faultyInput, dispatch])

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
    const t = performance.now()
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

  const handleStartDemo = useCallback(() => setDemoRunning(true), [])
  const handleStopDemo = useCallback(() => setDemoRunning(false), [])

  const statusLabel = demoRunning ? 'demo' : status
  const statusClass = demoRunning ? 'connected' : status

  return (
    <div className="app">
      <TopBar
        url={url}
        connectionStatus={status}
        statusClass={statusClass}
        statusLabel={statusLabel}
        lastEid={state.lastEid}
        onUrlChange={setUrl}
        onConnect={connect}
        onDisconnect={disconnect}
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
      />
      <div className="content">
        <Sidebar
          n={state.n}
          f={state.f}
          view={state.view}
          seq={state.seq}
          commits={state.commits.size}
          quorumThreshold={quorumThreshold}
          statusMessage={statusMessage}
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
        />
      </div>
    </div>
  )
}
