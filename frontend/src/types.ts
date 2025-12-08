export type Phase = 'idle' | 'preprepare' | 'prepare' | 'commit' | 'reply'
export type EventType = 'ClientRequest' | 'PrePrepare' | 'Prepare' | 'Commit' | 'Reply' | 'SessionStart' | 'PrimaryElected'

export type Envelope = {
  schema_ver: number
  type: EventType
  ts: number // microseconds since session start
  sid: string
  eid: number
  view: number
  seq: number
  from: number
  to: number[]
  data: any
}

export type Pulse = {
  type: 'Client' | 'PrePrepare' | 'Prepare' | 'Commit' | 'Reply'
  from: number
  to?: number[]
  t: number // ms
}

export type State = {
  n: number
  f: number
  view: number
  seq: number
  prepares: Set<number>
  commits: Set<number>
  nodePhase: Map<number, Phase>
  messages: Pulse[]
  lastEid: number | null
  connected: boolean
  stageLabel: string
  stageSeq: number | null
  eventLog: string[]
}

export type Action =
  | { kind: 'sessionStart'; n: number; f: number }
  | { kind: 'primaryElected' }
  | { kind: 'prePrepare'; seq: number; from: number; to: number[]; t: number; eid: number }
  | { kind: 'prepare'; from: number; to?: number[]; t: number; eid: number }
  | { kind: 'commit'; from: number; to?: number[]; t: number; eid: number }
  | { kind: 'connected'; value: boolean }
  | { kind: 'client'; to: number; t: number; eid: number }
  | { kind: 'stage'; label: string; seq: number | null }
  | { kind: 'reply'; from: number; t: number; eid: number }
  | { kind: 'restore'; snapshot: State }

export type LayoutMode = 'ring' | 'lanes'
