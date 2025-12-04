import React, { useState, useEffect } from 'react'

type SidebarProps = {
  n: number
  f: number
  view: number
  seq: number
  commits: number
  quorumThreshold: number
  eventLog: string[]
  stageLabel: string
  stageSeq: number | null
  highlightType?: 'commit' | 'prepare' | 'preprepare' | 'reply' | null
}

export default function Sidebar({
  n, f, view, seq, commits, quorumThreshold,
  eventLog, stageLabel, stageSeq,
  highlightType
}: SidebarProps) {


  const [showEvents, setShowEvents] = useState(true)
  const [showExplanation, setShowExplanation] = useState(true)
  const [showLegend, setShowLegend] = useState(true)
  const [showTutorial, setShowTutorial] = useState(false)

 
  const [pulseClass, setPulseClass] = useState('')

  useEffect(() => {
    setPulseClass('pulse-stage')
    const timer = setTimeout(() => setPulseClass(''), 400)
    return () => clearTimeout(timer)
  }, [stageLabel])

  
  const [legendFlash, setLegendFlash] = useState<string | null>(null)

  useEffect(() => {
    if (!highlightType) return
    setLegendFlash(highlightType)
    const timer = setTimeout(() => setLegendFlash(null), 300)
    return () => clearTimeout(timer)
  }, [highlightType])

  const explain = (() => {
    switch (stageLabel) {
      case 'Client Request':
        return 'Client sends a request to the primary replica (0).'
      case 'PrePrepare':
        return 'The primary proposes a request and forwards it to replicas.'
      case 'Prepare':
        return `Replicas echo the proposal. ${commits}/${quorumThreshold} commits.`
      case 'Commit':
        return `Replicas commit the request. Quorum = ${quorumThreshold}.`
      case 'Reply':
        return 'Replicas reply to the client after committing the request.'
      case 'Session Start':
        return 'System initializes and waits for requests.'
      default:
        return 'Waiting for the next PBFT event.'
    }
  })()

  return (
    <div className="sidebar">

     
      <div className="kv"><span>n</span><strong>{n}</strong></div>
      <div className="kv"><span>f</span><strong>{f}</strong></div>
      <div className="kv"><span>view</span><strong>{view}</strong></div>
      <div className="kv"><span>seq</span><strong>{seq}</strong></div>
      <div className="kv"><span>commits</span><strong>{commits}</strong></div>
      <div className="kv"><span>quorum</span><strong>{quorumThreshold}</strong></div>

     
      <div
        className="collapsible-header"
        onClick={() => setShowEvents(s => !s)}
      >
        {showEvents ? '▼' : '▶'} Recent Events
      </div>

      {showEvents && (
        <div className="eventlog">
          {eventLog.length === 0 ? (
            <div className="eventlog-empty">No events yet</div>
          ) : (
            eventLog.map((line, idx) => (
              <div key={idx} className="eventlog-line">{line}</div>
            ))
          )}
        </div>
      )}


      <div
        className="collapsible-header"
        onClick={() => setShowExplanation(s => !s)}
      >
        {showExplanation ? '▼' : '▶'} PBFT Explanation
      </div>

      {showExplanation && (
        <div className={`edu-window ${pulseClass}`}>
          <div className="edu-header">What is happening?</div>
          <div className="edu-text">
            <strong>{stageLabel}</strong>
            {stageSeq != null ? <span> · seq {stageSeq}</span> : null}
            <div className="edu-text-detail">{explain}</div>
          </div>
        </div>
      )}

     
      <div
        className="collapsible-header"
        onClick={() => setShowLegend(s => !s)}
      >
        {showLegend ? '▼' : '▶'} Legend
      </div>

      {showLegend && (
        <div className="legend-window">
          {['commit', 'prepare', 'preprepare', 'reply', 'idle'].map(type => (
            <div key={type} className="legend-row">
              <span
                className={
                  `legend-color ${type} ${legendFlash === type ? 'legend-flash' : ''}`
                }
              ></span>
              <span>
                {{
                  commit: 'Commit',
                  prepare: 'Prepare',
                  preprepare: 'Pre-Prepare',
                  reply: 'Reply',
                  idle: 'Idle / No Activity'
                }[type]}
              </span>
            </div>
          ))}
        </div>
      )}

     
      <div
        className="collapsible-header"
        onClick={() => setShowTutorial(s => !s)}
      >
        {showTutorial ? '▼' : '▶'} PBFT Tutorial
      </div>

      {showTutorial && (
        <div className="tutorial-window">
          <p><strong>PBFT (Practical Byzantine Fault Tolerance)</strong> tolerates up to <code>f</code> Byzantine nodes, requiring <code>n ≥ 3f + 1</code>.</p>
          <p>The protocol flow:</p>
          <ul>
            <li><strong>Client Request</strong> → sent to primary</li>
            <li><strong>Pre-Prepare</strong> → primary proposes operation</li>
            <li><strong>Prepare</strong> → replicas confirm proposal</li>
            <li><strong>Commit</strong> → replicas finalize request</li>
            <li><strong>Reply</strong> → client gets result</li>
          </ul>
          <p>Once replicas collect <strong>2f + 1 matching messages</strong>, the step becomes safe.</p>
        </div>
      )}
    </div>
  )
}
