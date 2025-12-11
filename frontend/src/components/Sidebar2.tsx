import React, { useEffect, useState } from 'react'

type SidebarProps = {
  n: number
  f: number
  view: number
  seq: number
  quorumCount: number
  quorumThreshold: number
  statusMessage?: string        // optional message
  showAt?: number               // time (ms) after which to show the message
  duration?: number             // how long (ms) the message stays visible
}

export default function Sidebar({
  n,
  f,
  view,
  seq,
  quorumCount,
  quorumThreshold,
  statusMessage = 'System running smoothly.',
  showAt = 2000,
  duration = 3000
}: SidebarProps) {
  const [showStatus, setShowStatus] = useState(false)

  useEffect(() => {
    const showTimer = setTimeout(() => setShowStatus(true), showAt)
    const hideTimer = setTimeout(() => setShowStatus(false), showAt + duration)

    return () => {
      clearTimeout(showTimer)
      clearTimeout(hideTimer)
    }
  }, [showAt, duration])

  return (
    <div className="sidebar p-4 bg-gray-900 text-white rounded-2xl space-y-3 shadow-lg">
      <div className="kv"><span>n</span><strong>{n}</strong></div>
      <div className="kv"><span>f</span><strong>{f}</strong></div>
      <div className="kv"><span>view</span><strong>{view}</strong></div>
      <div className="kv"><span>seq</span><strong>{seq}</strong></div>
      <div className="kv"><span>quorum count</span><strong>{quorumCount}</strong></div>
      <div className="kv"><span>quorum thresh</span><strong>{quorumThreshold}</strong></div>
      <div className="kv"><span></span><strong>{statusMessage}</strong></div>

      {/* Status Info Window */}
      {showStatus && (
        <div className="status-info mt-4 p-3 bg-blue-600 rounded-lg text-sm text-center shadow-md animate-fade-in">
          {statusMessage}
        </div>
      )}
    </div>
  )
}
