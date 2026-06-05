export function parseNDJSON(stream: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamDone = false

      return {
        async next() {
          while (true) {
            const nl = buffer.indexOf('\n')
            if (nl !== -1) {
              const line = buffer.slice(0, nl).trim()
              buffer = buffer.slice(nl + 1)
              if (line) return { value: JSON.parse(line), done: false as const }
              continue
            }

            if (streamDone) {
              const line = buffer.trim()
              buffer = ''
              if (line) return { value: JSON.parse(line), done: false as const }
              return { value: undefined, done: true as const }
            }

            const { value, done } = await reader.read()
            if (done) {
              streamDone = true
            } else {
              buffer += decoder.decode(value, { stream: true })
            }
          }
        },
        return() {
          reader.cancel()
          return Promise.resolve({ value: undefined, done: true as const })
        },
      }
    },
  }
}
