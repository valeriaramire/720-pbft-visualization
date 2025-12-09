import { Action, Phase, State } from './types'

export const initialState: State = {
  n: 4,
  f: 1,
  view: 0,
  seq: 0,
  prepares: new Set(),
  commits: new Set(),
  nodePhase: new Map(),
  messages: [],
  lastEid: null,
  connected: false,
  stageLabel: 'Idle',
  stageSeq: null,
  eventLog: [],
}

export function reducer(state: State, action: Action): State {
  switch (action.kind) {
    case 'sessionStart': {
      const phases = new Map<number, Phase>()
      for (let i = 0; i < action.n; i++) phases.set(i, 'idle')
      const desc = `Session start · n=${action.n}, f=${action.f}`
      const eventLog = [...state.eventLog, desc].slice(-8)
      return {
        ...state,
        n: action.n,
        f: action.f,
        view: 0,
        seq: 0,
        prepares: new Set(),
        commits: new Set(),
        nodePhase: phases,
        stageLabel: 'Session Start',
        stageSeq: 0,
        eventLog,
      }
    }
    case 'primaryElected': {
      return {
        ...state,
        eventLog: [...state.eventLog, 'Primary elected'].slice(-8),
      }
    }
    case 'prePrepare': {
      const phases = new Map(state.nodePhase)
      phases.set(action.from, 'preprepare')
      const toStr = action.to.length ? action.to.join(',') : '-'
      const desc = `PrePrepare · from ${action.from} → [${toStr}] · seq=${action.seq}`
      const eventLog = [...state.eventLog, desc].slice(-8)
      const pulse = { type: 'PrePrepare' as const, from: action.from, to: action.to, t: action.t }
      return {
        ...state,
        seq: action.seq,
        prepares: new Set(),
        commits: new Set(),
        nodePhase: phases,
        // For clarity when stepping, only keep pulses for the most recent event.
        messages: [pulse],
        lastEid: action.eid,
        stageLabel: 'PrePrepare',
        stageSeq: action.seq,
        eventLog,
      }
    }
    case 'prepare': {
      const prepares = new Set(state.prepares)
      prepares.add(action.from)
      const phases = new Map(state.nodePhase)
      phases.set(action.from, 'prepare')
      const toStr = action.to && action.to.length ? `[${action.to.join(',')}]` : 'all replicas'
      const desc = `Prepare · from ${action.from} → ${toStr}`
      const eventLog = [...state.eventLog, desc].slice(-8)
      const pulse = { type: 'Prepare' as const, from: action.from, to: action.to, t: action.t }
      return {
        ...state,
        prepares,
        nodePhase: phases,
        messages: [pulse],
        lastEid: action.eid,
        stageLabel: 'Prepare',
        stageSeq: state.seq,
        eventLog,
      }
    }
    case 'commit': {
      const commits = new Set(state.commits)
      commits.add(action.from)
      const phases = new Map(state.nodePhase)
      phases.set(action.from, 'commit')
      const toStr = action.to && action.to.length ? `[${action.to.join(',')}]` : 'all replicas'
      const desc = `Commit · from ${action.from} → ${toStr}`
      const eventLog = [...state.eventLog, desc].slice(-8)
      const pulse = { type: 'Commit' as const, from: action.from, to: action.to, t: action.t }
      return {
        ...state,
        commits,
        nodePhase: phases,
        messages: [pulse],
        lastEid: action.eid,
        stageLabel: 'Commit',
        stageSeq: state.seq,
        eventLog,
      }
    }
    case 'reply': {
      const desc = `Reply · from ${action.from} → client`
      const eventLog = [...state.eventLog, desc].slice(-8)
      const pulse = { type: 'Reply' as const, from: action.from, to: [-1], t: action.t }
      const phases = new Map(state.nodePhase)
      phases.set(action.from, 'reply')
      return {
        ...state,
        nodePhase: phases,
        messages: [pulse],
        lastEid: action.eid,
        stageLabel: 'Reply',
        stageSeq: state.seq,
        eventLog,
      }
    }
    case 'connected': {
      const desc = action.value ? 'Connected to stream' : 'Disconnected from stream'
      const eventLog = [...state.eventLog, desc].slice(-8)
      return { ...state, connected: action.value, eventLog }
    }
    case 'client': {
      const desc = `ClientRequest · to primary (0)`
      const eventLog = [...state.eventLog, desc].slice(-8)
      const pulse = { type: 'Client' as const, from: -1, to: [action.to], t: action.t }
      return {
        ...state,
        messages: [pulse],
        lastEid: action.eid,
        stageLabel: 'Client Request',
        stageSeq: state.seq ? state.seq + 1 : 1,
        eventLog,
      }
    }
    case 'stage': {
      return { ...state, stageLabel: action.label, stageSeq: action.seq }
    }
    case 'restore': {
      return action.snapshot
    }
    default:
      return state
  }
}
