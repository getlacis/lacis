import type { SSEOptions, Locals, PlatformContext } from '@/types'
import { withResponseMethods, type LacisHeaders } from '@/utils/adapter-base'
import { DEFAULT_MAX_BODY_SIZE } from '@/utils/constants'

const _encoder = new TextEncoder()

// Shared request base for runtime-Web adapters (Bun, Cloudflare): both wrap a Web
// `Request`. Common parts live here (body() via arrayBuffer + size check, native
// json()); runtime-specific bits (Bun's text(), Cloudflare's platform context and
// cf-connecting-ip) are added by the subclasses.
export class WebApiRequestBase {
  params: Record<string, string> = {}
  url: string
  method: string
  headers: LacisHeaders
  connection: { remoteAddress: string }
  socket = { setTimeout: (_: number) => {} } as const
  _maxBodySize?: number
  locals: Locals = {}
  platform: PlatformContext = {}
  protected _req: globalThis.Request

  constructor(req: globalThis.Request, url: string, remoteAddress: string) {
    this._req = req
    this.url = url
    this.method = req.method
    this.headers = req.headers as unknown as LacisHeaders
    this.connection = { remoteAddress }
  }

  setTimeout(_: number) {}

  body(): Promise<Buffer> {
    const limit = this._maxBodySize ?? DEFAULT_MAX_BODY_SIZE
    return this._req.arrayBuffer().then((b: ArrayBuffer) => {
      if (b.byteLength > limit)
        throw Object.assign(new Error('Payload Too Large'), { code: 413 })
      return Buffer.from(b)
    })
  }

  json<T = any>(): Promise<T> {
    return this._req.json() as Promise<T>
  }
}

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
