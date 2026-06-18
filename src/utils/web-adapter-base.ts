import type { SSEOptions } from '@/types'
import { withResponseMethods } from '@/utils/adapter-base'

export const WEB_MAX_BODY_SIZE = 10_485_760

const _encoder = new TextEncoder()

export class WebApiResponseBase {
  protected _adapterName = 'unknown'

  statusCode = 200
  headersSent = false
  get finished() { return this.headersSent }
  get writableEnded() { return this.headersSent }

  _body: any = null
  _headers: string[] | null = null
  _sseReadable: ReadableStream<Uint8Array> | null = null
  _streamBody: ReadableStream<Uint8Array> | null = null
  private _sseWriter: WritableStreamDefaultWriter<Uint8Array> | null = null
  private _sseWindowClosed = false
  private _listeners: ((...a: any[]) => void)[] | null = null

  on(event: string, listener: (...a: any[]) => void) {
    if (event === 'finish' || event === 'close') {
      if (!this._listeners) this._listeners = []
      this._listeners.push(listener)
    }
    return this
  }
  once(event: string, listener: (...a: any[]) => void) { return this.on(event, listener) }
  emit(event: string) {
    if ((event === 'finish' || event === 'close') && this._listeners)
      for (let i = 0; i < this._listeners.length; i++) this._listeners[i]()
    return true
  }

  setHeader(name: string, value: string | string[]) {
    if (!this._headers) this._headers = []
    if (Array.isArray(value)) {
      for (const v of value) this._headers.push(name, v)
    } else {
      this._headers.push(name, value)
    }
    return this
  }
  getHeader(name: string) {
    if (!this._headers) return undefined
    const lo = name.toLowerCase()
    for (let i = 0; i < this._headers.length; i += 2)
      if (this._headers[i].toLowerCase() === lo) return this._headers[i + 1]
  }
  removeHeader(name: string) {
    if (!this._headers) return this
    const lo = name.toLowerCase()
    for (let i = 0; i < this._headers.length; i += 2)
      if (this._headers[i].toLowerCase() === lo) { this._headers.splice(i, 2); break }
    return this
  }
  hasHeader(name: string) {
    if (!this._headers) return false
    const lo = name.toLowerCase()
    for (let i = 0; i < this._headers.length; i += 2)
      if (this._headers[i].toLowerCase() === lo) return true
    return false
  }
  writeHead(statusCode: number, headers?: Record<string, string> | null) {
    this.statusCode = statusCode
    if (headers) for (const [k, v] of Object.entries(headers)) this.setHeader(k, v)
    return this
  }
  write(chunk: any) {
    if (this._sseWriter) {
      this._sseWriter.write(_encoder.encode(String(chunk)))
      return true
    }
    this._body = (this._body ?? '') + chunk
    return true
  }
  end(data?: any) {
    if (data !== undefined) this.write(data)
    if (this._sseWriter) this._sseWriter.close()
    this.headersSent = true
    if (this._listeners)
      for (let i = 0; i < this._listeners.length; i++) this._listeners[i]()
    return this
  }

  _initSseStream() {
    if (this._sseWindowClosed)
      throw new Error(`[lacis/${this._adapterName}] initSSE() must be called synchronously before any \`await\` in your handler.`)
    const { readable, writable } = new TransformStream<Uint8Array>()
    this._sseReadable = readable
    this._sseWriter = writable.getWriter()
  }

  _closeSseWindow() {
    this._sseWindowClosed = true
  }
}

export class WebApiResponse extends withResponseMethods(WebApiResponseBase) {
  initSSE(options?: SSEOptions) {
    this._initSseStream()
    return super.initSSE(options)
  }

  stream(body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>): Promise<void> {
    this.setHeader('Cache-Control', 'no-cache')
    this.setHeader('X-Accel-Buffering', 'no')
    if (body instanceof ReadableStream) {
      this._streamBody = body as ReadableStream<Uint8Array>
    } else {
      this._streamBody = new ReadableStream<Uint8Array>({
        async start(controller) {
          for await (const chunk of body as AsyncIterable<Uint8Array>) controller.enqueue(chunk)
          controller.close()
        },
      })
    }
    this.headersSent = true
    return Promise.resolve()
  }

  ndjson(iter: AsyncIterable<unknown>): Promise<void> {
    const encoder = new TextEncoder()
    this.setHeader('Content-Type', 'application/x-ndjson')
    this.setHeader('Cache-Control', 'no-cache')
    this.setHeader('X-Accel-Buffering', 'no')
    this._streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const item of iter) controller.enqueue(encoder.encode(JSON.stringify(item) + '\n'))
        controller.close()
      },
    })
    this.headersSent = true
    return Promise.resolve()
  }
}

export function buildWebApiResponse(res: WebApiResponseBase, body?: ReadableStream<Uint8Array> | null): globalThis.Response {
  const responseBody = body ?? res._streamBody ?? res._body
  if (!res._headers) return new globalThis.Response(responseBody, { status: res.statusCode })
  const headers = new Headers()
  for (let i = 0; i < res._headers.length; i += 2) {
    const name = res._headers[i]
    const value = res._headers[i + 1]
    if (name.toLowerCase() === 'set-cookie') {
      headers.append(name, value)
    } else {
      headers.set(name, value)
    }
  }
  return new globalThis.Response(responseBody, { status: res.statusCode, headers })
}
