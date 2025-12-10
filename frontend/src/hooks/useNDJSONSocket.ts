import { useCallback, useEffect, useRef, useState } from 'react'
import type { Envelope } from '../types'

type SocketStatus = 'disconnected' | 'connecting' | 'connected'

// SSE-based JSON stream consumer. Keeps the same API as the prior WebSocket hook.
export function useNDJSONSocket(
  urlStr: string,
  onEvent: (env: Envelope) => void,
  lastEidRef: React.MutableRefObject<number | null>,
) {
  const [status, setStatus] = useState<SocketStatus>('disconnected')
  const esRef = useRef<EventSource | null>(null)
  const baseUrlRef = useRef<string>(urlStr)

  useEffect(() => {
    baseUrlRef.current = urlStr
  }, [urlStr])

  const connect = useCallback(() => {
    if (esRef.current && esRef.current.readyState !== EventSource.CLOSED) {
      return
    }
    setStatus('connecting')
    let urlToUse = baseUrlRef.current
    try {
      const u = new URL(urlToUse, window.location.href)
      // Always give each connection a unique consumer group unless caller already set one.
      if (!u.searchParams.has('group')) {
        u.searchParams.set('group', `run-${Date.now()}`)
      }
      const last = lastEidRef.current
      if (last !== null && !u.searchParams.has('from_eid')) {
        u.searchParams.set('from_eid', String(last + 1))
      }
      urlToUse = u.toString()
    } catch {
      // If URL parsing fails, fall back to the raw string.
    }
    const es = new EventSource(urlToUse)
    esRef.current = es

    es.onopen = () => {
      setStatus('connected')
    }
    es.onmessage = (ev) => {
      // Server sends one JSON envelope per SSE message.
      const data = typeof ev.data === 'string' ? ev.data.trim() : ''
      if (!data) return
      try {
        const obj = JSON.parse(data) as Envelope
        onEvent(obj)
      } catch {
        // ignore malformed payloads
      }
      // Updates from the server may include lastEventId; mirror into ref
      if (ev.lastEventId) {
        const parsed = parseInt(ev.lastEventId, 10)
        if (!isNaN(parsed)) lastEidRef.current = parsed
      }
    }
    es.onerror = () => {
      setStatus('connecting')
      // EventSource retries automatically; nothing else to do here.
    }
  }, [onEvent, lastEidRef])

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
      setStatus('disconnected')
    }
  }, [])

  return { status, connect, disconnect }
}
