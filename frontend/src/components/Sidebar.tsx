import React from 'react'

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
}

export default function Sidebar({ n, f, view, seq, commits, quorumThreshold, eventLog, stageLabel, stageSeq }: SidebarProps) {
  const explain = (() => {
    switch (stageLabel) {
      case 'Client Request':
        return 'Client sends a request to the primary replica (0).'
      case 'PrePrepare':
        return 'The primary proposes a request and forwards it to all other replicas.'
      case 'Prepare':
        return `Replicas echo the proposal to each other. Currently ${commits} commit(s) of ${quorumThreshold} needed for a decision.`
      case 'Commit':
        return `Replicas broadcast commit messages and move toward a final decision. Quorum is ${quorumThreshold} commits.`
      case 'Reply':
        return 'Replicas reply the result back to the client once the request is committed.'
      case 'Session Start':
        return 'The PBFT system is initialized and ready to process client requests.'
      default:
        return 'System is idle or between phases. Waiting for the next PBFT event.'
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
      <div className="eventlog-header">Recent events</div>
      <div className="eventlog">
        {eventLog.length === 0 ? (
          <div className="eventlog-empty">No events yet</div>
        ) : (
          eventLog.map((line, idx) => (
            <div key={idx} className="eventlog-line">
              {line}
            </div>
          ))
        )}
      </div>
      <div className="edu-header">What is happening now?</div>
      <div className="edu-text">
        <strong>{stageLabel}</strong>
        <span>{stageSeq != null ? ` · seq ${stageSeq}` : ''}</span>
        <div className="edu-text-detail">{explain}</div>
      </div>
    </div>
  )
}
