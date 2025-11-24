import React from 'react'

type SidebarProps = {
  n: number
  f: number
  view: number
  seq: number
  commits: number
  quorumThreshold: number
}

export default function Sidebar({ n, f, view, seq, commits, quorumThreshold }: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="kv"><span>n</span><strong>{n}</strong></div>
      <div className="kv"><span>f</span><strong>{f}</strong></div>
      <div className="kv"><span>view</span><strong>{view}</strong></div>
      <div className="kv"><span>seq</span><strong>{seq}</strong></div>
      <div className="kv"><span>commits</span><strong>{commits}</strong></div>
      <div className="kv"><span>quorum</span><strong>{quorumThreshold}</strong></div>
    </div>
  )
}
