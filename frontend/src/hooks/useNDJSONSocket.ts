import { useCallback, useEffect, useRef, useState } from 'react'
import type { Envelope } from '../types'

type SocketStatus = 'disconnected' | 'connecting' | 'connected'

export function useNDJSONSocket(
  urlStr: string,
  onEvent: (env: Envelope) => void,
  lastEidRef: React.MutableRefObject<number | null>,
) {
  const [status, setStatus] = useState<SocketStatus>('disconnected')
  const wsRef = useRef<WebSocket | null>(null)
  const bufferRef = useRef<string>('')
  const retryRef = useRef<number>(0)
  const baseUrlRef = useRef<string>(urlStr)

  useEffect(() => {
    baseUrlRef.current = urlStr
  }, [urlStr])

  const connect = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return
    }
    setStatus('connecting')
    let urlToUse = baseUrlRef.current
    const last = lastEidRef.current
    if (last !== null) {
      const u = new URL(urlToUse)
      u.searchParams.set('from_eid', String(last + 1))
      urlToUse = u.toString()
    }
    const ws = new WebSocket(urlToUse)
    wsRef.current = ws
    bufferRef.current = ''

    ws.onopen = () => {
      setStatus('connected')
      retryRef.current = 0
    }
    ws.onmessage = (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : ''
      bufferRef.current += data
      let idx
      while ((idx = bufferRef.current.indexOf('\n')) >= 0) {
        const line = bufferRef.current.slice(0, idx).trim()
        bufferRef.current = bufferRef.current.slice(idx + 1)
        if (!line) continue
        try {
          const obj = JSON.parse(line) as Envelope
          onEvent(obj)
        } catch {
          // ignore malformed payloads
        }
      }
    }
    ws.onclose = () => {
      setStatus('disconnected')
      const baseDelay = 300
      const attempt = Math.min(6, retryRef.current)
      const delay = baseDelay * Math.pow(2, attempt)
      retryRef.current += 1
      setTimeout(() => connect(), delay)
    }
    ws.onerror = () => {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
  }, [onEvent, lastEidRef])

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close()
      } catch {
        // ignore
      }
      wsRef.current = null
      setStatus('disconnected')
    }
  }, [])

  return { status, connect, disconnect }
}
