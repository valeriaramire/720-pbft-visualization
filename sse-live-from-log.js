// Simple SSE server that replays events from live.log
// Usage: node sse-live-from-log.js

const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 8080
const LOG_PATH = path.join(__dirname, 'live.log')

function loadEvents() {
  const txt = fs.readFileSync(LOG_PATH, 'utf8')
  const lines = txt.split(/\r?\n/)
  const blocks = []
  let current = []
  for (const line of lines) {
    if (!line.trim()) {
      if (current.length) {
        blocks.push(current.join('\n') + '\n\n')
        current = []
      }
    } else {
      current.push(line)
    }
  }
  if (current.length) {
    blocks.push(current.join('\n') + '\n\n')
  }
  return blocks
}

const events = loadEvents()
console.log(`Loaded ${events.length} SSE events from ${LOG_PATH}`)

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/sse/events')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    let idx = 0
    const intervalMs = 400
    const timer = setInterval(() => {
      if (idx >= events.length) {
        clearInterval(timer)
        return
      }
      res.write(events[idx])
      idx += 1
    }, intervalMs)

    req.on('close', () => {
      clearInterval(timer)
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`SSE log server listening on http://localhost:${PORT}/sse/events`)
})

