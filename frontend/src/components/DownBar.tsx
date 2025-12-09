import React from 'react'

type DownBarProps = {
  quorumProgress: number
  commitCount: number
  quorumThreshold: number
}

export default function DownBar({ quorumProgress, commitCount, quorumThreshold }: DownBarProps) {
  const progress = Math.max(0, Math.min(1, quorumProgress))
  return (
    <div className="downbar">
      <div className="downbar-meter">
        <div className="fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="downbar-label">Commit quorum: {commitCount} / {quorumThreshold}</div>
    </div>
  )
}
