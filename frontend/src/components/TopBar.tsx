import React from 'react'
import type { LayoutMode } from '../types'

type TopBarProps = {
  mode: 'demo' | 'live'
  onToggleMode: () => void
  url: string
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  statusClass: string
  statusLabel: string
  lastEid: number | null
  onConnect: () => void
  onDisconnect: () => void
  liveMessage: string
  onLiveMessageChange: (value: string) => void
  liveRounds: number
  onLiveRoundsChange: (value: number) => void
  onSendLiveMessage: () => void
  liveSendStatus: 'idle' | 'sending' | 'ok' | 'error'
  sseLogCount: number
  liveQueued: number
  lastLiveType: string | null
  onExportSseLog: () => void
  onClearSseLog: () => void
  numReplicas: number
  onNumReplicasChange: (value: number) => void
  onApplyReplicas: () => void
  replicaStatus: 'idle' | 'pending' | 'ok' | 'error'
  demoRunning: boolean
  onStartDemo: () => void
  onStopDemo: () => void
  onNextStep: () => void
  onPrevStep: () => void
  onContinue: () => void
  demoEps: number
  onDemoEpsChange: (value: number) => void
  nInput: number
  onNInputChange: (value: number) => void
  faultyInput: string
  onFaultyInputChange: (value: string) => void
  onApplyConfig: () => void
  layout: LayoutMode
  onLayoutChange: (mode: LayoutMode) => void
  paused: boolean
  onTogglePause: () => void
}

export default function TopBar({
  mode,
  onToggleMode,
  url,
  connectionStatus,
  statusClass,
  statusLabel,
  lastEid,
  onConnect,
  onDisconnect,
  liveMessage,
  onLiveMessageChange,
  liveRounds,
  onLiveRoundsChange,
  onSendLiveMessage,
  liveSendStatus,
  sseLogCount,
  liveQueued,
  lastLiveType,
  onExportSseLog,
  onClearSseLog,
  numReplicas,
  onNumReplicasChange,
  onApplyReplicas,
  replicaStatus,
  demoRunning,
  onStartDemo,
  onStopDemo,
  onNextStep,
  onPrevStep,
  onContinue: _unusedOnContinue,
  demoEps,
  onDemoEpsChange,
  nInput,
  onNInputChange,
  faultyInput,
  onFaultyInputChange,
  onApplyConfig,
  layout,
  onLayoutChange,
  paused,
  onTogglePause,
}: TopBarProps) {
  const isLive = mode === 'live'
  const connected = connectionStatus === 'connected'
  const eventsPerSec = demoEps / 10

  const connectButton =
    connectionStatus !== 'connected' ? (
      <button
        className={`btn connect-btn${connectionStatus === 'connecting' ? ' is-pending' : ''}`}
        onClick={onConnect}
        disabled={connectionStatus === 'connecting'}
      >
        {connectionStatus === 'connecting' && <span className="btn-indicator" aria-hidden="true" />}
        Connect
      </button>
    ) : (
      <button className="btn disconnect-btn" onClick={onDisconnect}>Disconnect</button>
    )

  return (
    <div className="topbar">
      <div className="topbar-grid">
        <div className="topbar-card card-mode">
          <div className="topbar-section-title">Mode &amp; Layout</div>
          <div className="card-content">
            <div className="card-row mode-row">
              <button className="btn modebtn" onClick={onToggleMode}>Mode: {mode === 'demo' ? 'Demo' : 'Live'}</button>
              <div className="layout-toggle">
                <span className="field-label">Layout</span>
                <button className="btn" onClick={() => onLayoutChange('ring')} disabled={layout === 'ring'}>
                  Ring
                </button>
                <button className="btn" onClick={() => onLayoutChange('lanes')} disabled={layout === 'lanes'}>
                  Lanes
                </button>
              </div>
            </div>
            <div className="card-row">
              <label className="field-label">Speed</label>
              <input
                className="smallinput"
                type="number"
                min={1}
                max={240}
                value={demoEps}
                onChange={(e) => onDemoEpsChange(parseInt(e.target.value || '60', 10) || 60)}
              />
              <input
                type="range"
                min={1}
                max={240}
                value={demoEps}
                onChange={(e) => onDemoEpsChange(parseInt(e.target.value || '60', 10) || 60)}
              />
              <span className="field-note">{eventsPerSec.toFixed(1)} ev/s</span>
            </div>
          </div>
        </div>
        <div className="topbar-card card-status">
          <div className="topbar-section-title">Connection</div>
          <div className="card-content">
            <div className="card-row">
              <span className={`status ${statusClass}`}>Status: {statusLabel}</span>
              <span className="eid">last eid: {lastEid ?? '-'}</span>
            </div>
          </div>
        </div>
        {isLive ? (
          <>
            <div className="topbar-card">
              <div className="topbar-section-title">Stream</div>
              <div className="card-content">
                <span className="readonly-url">{url}</span>
                {connectButton}
              </div>
            </div>
            <div className="topbar-card">
              <div className="topbar-section-title">Playback</div>
              <div className="card-content">
                <div className="card-row">
                  <button className="btn" onClick={onTogglePause} disabled={!connected}>
                    {paused ? 'Continue' : 'Pause'}
                  </button>
                  <button className="btn" onClick={onNextStep} disabled={!paused || !connected}>Next</button>
                  <button className="btn" onClick={onPrevStep} disabled={!paused || !connected}>Back</button>
                </div>
              </div>
            </div>
            <div className="topbar-card">
              <div className="topbar-section-title">Replicas</div>
              <div className="card-content">
                <div className="card-row replica-control">
                  <button className="arrow-btn" onClick={() => onNumReplicasChange(Math.max(2, numReplicas - 1))}>◀</button>
                  <span className="replica-count">{numReplicas}</span>
                  <button className="arrow-btn" onClick={() => onNumReplicasChange(Math.min(10, numReplicas + 1))}>▶</button>
                  <button
                    className={`btn replica-apply-btn${replicaStatus === 'pending' ? ' is-pending' : ''}`}
                    onClick={onApplyReplicas}
                    disabled={replicaStatus === 'pending'}
                  >
                    {replicaStatus === 'pending' && <span className="btn-indicator" aria-hidden="true" />}
                    Apply
                  </button>
                  {replicaStatus !== 'idle' && (
                    <span className={`replica-status badge-${replicaStatus}`}>
                      {replicaStatus === 'pending' ? 'Applying…' : replicaStatus === 'ok' ? 'Applied' : 'Error'}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="topbar-card card-client">
              <div className="topbar-section-title">Client Request</div>
              <div className="card-content">
                <div className="card-row">
                  <input
                    className="urlinput"
                    placeholder="Message to send"
                    value={liveMessage}
                    onChange={(e) => onLiveMessageChange(e.target.value)}
                    spellCheck={false}
                  />
                  <input
                    className="smallinput"
                    type="number"
                    min={1}
                    max={20}
                    value={liveRounds}
                    onChange={(e) => onLiveRoundsChange(Math.max(1, parseInt(e.target.value || '1', 10) || 1))}
                    title="Rounds"
                  />
                  <button className="btn" onClick={onSendLiveMessage} disabled={!connected}>Send</button>
                </div>
                <div className="card-row">
                  <span className={`send-status send-${liveSendStatus}`}>
                    {liveSendStatus === 'idle' && 'req: idle'}
                    {liveSendStatus === 'sending' && 'req: sending'}
                    {liveSendStatus === 'ok' && 'req: ok'}
                    {liveSendStatus === 'error' && 'req: error'}
                  </span>
                </div>
              </div>
            </div>
            <div className="topbar-card card-log">
              <div className="topbar-section-title">SSE Log</div>
              <div className="card-content">
                <div className="sse-stats">
                  <span>recv: {sseLogCount}</span>
                  <span>queue: {liveQueued}</span>
                  <span>last: {lastLiveType ?? '-'}</span>
                </div>
                <div className="card-row">
                  <button className="btn" onClick={onExportSseLog} disabled={!sseLogCount}>Export</button>
                  <button className="btn" onClick={onClearSseLog} disabled={!sseLogCount}>Clear</button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="topbar-card">
              <div className="topbar-section-title">Demo Playback</div>
              <div className="card-content">
                <div className="card-row">
                  {!demoRunning ? (
                    <button className="btn" onClick={onStartDemo}>Start Demo</button>
                  ) : (
                    <>
                      <button className="btn" onClick={onTogglePause}>{paused ? 'Continue' : 'Pause'}</button>
                      <button className="btn" onClick={onStopDemo}>Stop</button>
                      {paused && (
                        <>
                          <button className="btn" onClick={onPrevStep}>Back</button>
                          <button className="btn" onClick={onNextStep}>Next</button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="topbar-card">
              <div className="topbar-section-title">Replica Config</div>
              <div className="card-content">
                <div className="demo-config-fields">
                  <div className="demo-config-field">
                    <label className="field-label">n</label>
                    <input
                      className="smallinput"
                      type="number"
                      min={1}
                      max={64}
                      value={nInput}
                      onChange={(e) => onNInputChange(parseInt(e.target.value || '1', 10) || 1)}
                    />
                  </div>
                  <div className="demo-config-field">
                    <label className="field-label">faulty ids</label>
                    <input
                      className="smallinput"
                      placeholder="e.g. 2,5"
                      value={faultyInput}
                      onChange={(e) => onFaultyInputChange(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                </div>
                <button className="btn" onClick={onApplyConfig}>Apply</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
