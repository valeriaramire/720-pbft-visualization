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
}

export function reducer(state: State, action: Action): State {
  switch (action.kind) {
    case 'sessionStart': {
      const phases = new Map<number, Phase>()
      for (let i = 0; i < action.n; i++) phases.set(i, 'idle')
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
      }
    }
    case 'primaryElected': {
      return state
    }
    case 'prePrepare': {
      const phases = new Map(state.nodePhase)
      phases.set(action.from, 'preprepare')
      return {
        ...state,
        seq: action.seq,
        prepares: new Set(),
        commits: new Set(),
        nodePhase: phases,
        messages: [...state.messages, { type: 'PrePrepare', from: action.from, to: action.to, t: action.t }],
        lastEid: action.eid,
        stageLabel: 'PrePrepare',
        stageSeq: action.seq,
      }
    }
    case 'prepare': {
      const prepares = new Set(state.prepares)
      prepares.add(action.from)
      const phases = new Map(state.nodePhase)
      phases.set(action.from, 'prepare')
      return {
        ...state,
        prepares,
        nodePhase: phases,
        messages: [...state.messages, { type: 'Prepare', from: action.from, to: action.to, t: action.t }],
        lastEid: action.eid,
        stageLabel: 'Prepare',
        stageSeq: state.seq,
      }
    }
    case 'commit': {
      const commits = new Set(state.commits)
      commits.add(action.from)
      const phases = new Map(state.nodePhase)
      phases.set(action.from, 'commit')
      return {
        ...state,
        commits,
        nodePhase: phases,
        messages: [...state.messages, { type: 'Commit', from: action.from, to: action.to, t: action.t }],
        lastEid: action.eid,
        stageLabel: 'Commit',
        stageSeq: state.seq,
      }
    }
    case 'reply': {
      return {
        ...state,
        messages: [...state.messages, { type: 'Reply', from: action.from, to: [-1], t: action.t }],
        lastEid: action.eid,
        stageLabel: 'Reply',
        stageSeq: state.seq,
      }
    }
    case 'connected': {
      return { ...state, connected: action.value }
    }
    case 'client': {
      return {
        ...state,
        messages: [...state.messages, { type: 'Client', from: -1, to: [action.to], t: action.t }],
        lastEid: action.eid,
        stageLabel: 'Client Request',
        stageSeq: state.seq ? state.seq + 1 : 1,
      }
    }
    case 'stage': {
      return { ...state, stageLabel: action.label, stageSeq: action.seq }
    }
    default:
      return state
  }
}
