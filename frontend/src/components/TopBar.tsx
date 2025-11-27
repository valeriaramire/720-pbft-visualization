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
  onUrlChange: (value: string) => void
  onConnect: () => void
  onDisconnect: () => void
  liveMessage: string
  onLiveMessageChange: (value: string) => void
  onSendLiveMessage: () => void
  liveSendStatus: 'idle' | 'sending' | 'ok' | 'error'
  demoRunning: boolean
  onStartDemo: () => void
  onStopDemo: () => void
  onNextStep: () => void
  onContinue: () => void
  demoEps: number
  onDemoEpsChange: (value: number) => void
  nInput: number
  onNInputChange: (value: number) => void
  fInput: number
  onFInputChange: (value: number) => void
  faultyInput: string
  onFaultyInputChange: (value: string) => void
  onApplyConfig: () => void
  layout: LayoutMode
  onLayoutChange: (mode: LayoutMode) => void
  paused: boolean
  onTogglePause: () => void
}

export default function TopBar({
  url,
  connectionStatus,
  statusClass,
  statusLabel,
  onUrlChange,
  onConnect,
  onDisconnect,
  demoRunning,
  onStartDemo,
  onStopDemo,
  onNextStep,
  onContinue,
  demoEps,
  onDemoEpsChange,
  nInput,
  onNInputChange,
  fInput,
  onFInputChange,
  faultyInput,
  onFaultyInputChange,
  onApplyConfig,
  layout,
  onLayoutChange,
  lastEid,
  mode,
  onToggleMode,
  liveMessage,
  onLiveMessageChange,
  onSendLiveMessage,
  paused,
  onTogglePause,
  liveSendStatus,
}: TopBarProps) {
  const isLive = mode === 'live'
  return (
    <div className="topbar">
      <div className="left">
        <button className="btn modebtn" onClick={onToggleMode}>Mode: {mode === 'demo' ? 'Demo' : 'Live'}</button>
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
        <span style={{ opacity: 0.8, fontSize: 12, marginLeft: 6 }}>{demoEps} speed</span>
        {isLive && (
          <>
            <input className="urlinput" value={url} onChange={(e) => onUrlChange(e.target.value)} spellCheck={false} />
            {connectionStatus !== 'connected' ? (
              <button className="btn" onClick={onConnect}>Connect</button>
            ) : (
              <button className="btn" onClick={onDisconnect}>Disconnect</button>
            )}
            <input
              className="urlinput"
              placeholder="Message to send"
              value={liveMessage}
              onChange={(e) => onLiveMessageChange(e.target.value)}
              spellCheck={false}
            />
            <button className="btn" onClick={onSendLiveMessage} disabled={connectionStatus !== 'connected'}>
              Send
            </button>
            <span className={`send-status send-${liveSendStatus}`}>
              {liveSendStatus === 'idle' && 'req: idle'}
              {liveSendStatus === 'sending' && 'req: sending'}
              {liveSendStatus === 'ok' && 'req: ok'}
              {liveSendStatus === 'error' && 'req: error'}
            </span>
          </>
        )}
        {!isLive && (
          <>
            {!demoRunning ? (
              <button className="btn" onClick={onStartDemo}>Start Demo</button>
            ) : (
              <>
                <button className="btn" onClick={onTogglePause}>{paused ? 'Continue' : 'Pause'}</button>
                <button className="btn" onClick={onStopDemo}>Stop</button>
                {paused && (
                  <button className="btn" onClick={onNextStep}>Next Step</button>
                )}
              </>
            )}
            <span style={{ marginLeft: 8, opacity: 0.8 }}>n</span>
            <input
              className="smallinput"
              type="number"
              min={1}
              max={64}
              value={nInput}
              onChange={(e) => onNInputChange(parseInt(e.target.value || '1', 10) || 1)}
            />
            <span style={{ marginLeft: 6, opacity: 0.8 }}>f</span>
            <input
              className="smallinput"
              type="number"
              min={0}
              max={20}
              value={fInput}
              onChange={(e) => onFInputChange(parseInt(e.target.value || '0', 10) || 0)}
            />
            <span style={{ marginLeft: 6, opacity: 0.8 }}>faulty</span>
            <input
              className="smallinput"
              placeholder="e.g. 2,5"
              value={faultyInput}
              onChange={(e) => onFaultyInputChange(e.target.value)}
            />
            <button className="btn" onClick={onApplyConfig}>Apply</button>
          </>
        )}
        <span style={{ marginLeft: 8, opacity: 0.8 }}>Layout</span>
        <button className="btn" onClick={() => onLayoutChange('ring')} disabled={layout === 'ring'}>
          Ring
        </button>
        <button className="btn" onClick={() => onLayoutChange('lanes')} disabled={layout === 'lanes'}>
          Lanes
        </button>
      </div>
      <div className="right">
        <span className={`status ${statusClass}`}>Status: {statusLabel}</span>
        <span className="eid">last eid: {lastEid ?? '-'}</span>
      </div>
    </div>
  )
}
