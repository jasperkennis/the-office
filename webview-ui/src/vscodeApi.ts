declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

export const isStandalone = typeof acquireVsCodeApi !== 'function'

interface VsCodeApi {
  postMessage(msg: unknown): void
}

function createStandaloneApi(): VsCodeApi {
  let ws: WebSocket | null = null
  let messageQueue: unknown[] = []

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`)

    ws.onopen = () => {
      // Flush queued messages
      for (const msg of messageQueue) {
        ws!.send(JSON.stringify(msg))
      }
      messageQueue = []
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        // Dispatch as a MessageEvent on window — the existing useExtensionMessages hook listens for these
        window.dispatchEvent(new MessageEvent('message', { data: msg }))
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = () => {
      ws = null
      // Reconnect after 2s
      setTimeout(connect, 2000)
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  connect()

  return {
    postMessage(msg: unknown) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg))
      } else {
        messageQueue.push(msg)
      }
    },
  }
}

export const vscode: VsCodeApi = isStandalone ? createStandaloneApi() : acquireVsCodeApi()
