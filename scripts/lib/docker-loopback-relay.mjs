/**
 * The Docker API relay `restore-check` runs around `supabase start`, and only around it (I56). The Supabase CLI
 * publishes every port of the scratch stack with no host address, and Docker Desktop does not apply the loopback
 * default of the network the stack is put on, so without the relay the restored database would be published on every
 * address of the machine. The relay stands between the CLI and the Docker endpoint plain `docker` uses and changes one
 * thing: in a container create, every published port with no host address gets 127.0.0.1, and a create that asks for
 * another address, for every port (`PublishAllPorts`) or for another network is refused, so the start fails closed.
 * Everything else passes through. It is the mechanism, not the check: restore-check's guard reads the result through
 * plain docker afterwards, whatever the relay did.
 *
 * It listens on a named pipe on Windows and on a unix socket in a private folder elsewhere, never on TCP, where a
 * Docker API would be open to every local process. It runs in a worker thread: restore-check runs the CLI with
 * spawnSync, which blocks the main thread for the whole start. This one file is both the library and the worker.
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { STATUS_CODES } from 'node:http'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

const HEAD_LIMIT = 64 * 1024
const BODY_LIMIT = 1024 * 1024
const CREATE = /^\/(v[0-9][0-9.]*\/)?containers\/create$/

/** The path of the local Docker endpoint a `DOCKER_HOST`-style value names: `npipe:////./pipe/<name>` or
 * `unix:///<path>`. Anything else is refused: on a tcp:// or ssh:// engine, 127.0.0.1 would not be this machine's
 * loopback.
 * @returns {string} */
export function relayTarget(dockerHost) {
  const pipe = /^npipe:\/\/\/\/\.\/pipe\/([^/\\]+)$/.exec(dockerHost ?? '')
  if (pipe) return `\\\\.\\pipe\\${pipe[1]}`
  const socket = /^unix:\/\/(\/.+)$/.exec(dockerHost ?? '')
  if (socket) return socket[1]
  throw new Error(`Cannot relay the Docker endpoint ${JSON.stringify(dockerHost)}: the rehearsal can relay only a local Docker endpoint (a named pipe or a unix socket).`)
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A container create's body (a Buffer) with 127.0.0.1 written into every published port that names no host address:
 * `{ body }`, or `{ refusal }` saying why it cannot go to Docker. `network` is the only NetworkMode allowed: the CLI puts
 * every container it creates on the network it was given with `--network-id`. */
export function rewriteCreate(body, network) {
  let create
  try {
    create = JSON.parse(body.toString('utf8'), (_key, value) => {
      // An integer beyond 2^53 would not come out of JSON.stringify as it went in.
      if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error(`the integer ${value} is beyond 2^53`)
      return value
    })
  } catch (error) {
    return { refusal: `its body cannot be rewritten exactly (${error.message})` }
  }
  if (!isObject(create)) return { refusal: 'its body is not a JSON object' }
  const host = create.HostConfig
  if (!isObject(host)) return { refusal: 'it has no HostConfig' }
  if (host.NetworkMode !== network) return { refusal: `its NetworkMode is ${JSON.stringify(host.NetworkMode)}, not the scratch network ${network}` }
  if (![undefined, null, false].includes(host.PublishAllPorts)) return { refusal: 'it asks to publish every port (PublishAllPorts)' }
  const ports = host.PortBindings ?? null
  if (ports !== null && !isObject(ports)) return { refusal: 'its PortBindings is not an object' }
  for (const [port, bindings] of Object.entries(ports ?? {})) {
    if (bindings === null) continue
    if (!Array.isArray(bindings) || !bindings.every(isObject)) return { refusal: `its bindings of ${port} are not a list of objects` }
    for (const binding of bindings) {
      if ([undefined, null, ''].includes(binding.HostIp)) binding.HostIp = '127.0.0.1'
      else if (binding.HostIp !== '127.0.0.1') return { refusal: `it publishes ${port} on ${JSON.stringify(binding.HostIp)}, not on 127.0.0.1` }
    }
  }
  return { body: Buffer.from(JSON.stringify(create)) }
}

/** An answer from the relay itself, in Docker's error shape (the CLI prints it as "Error response from daemon: ..."),
 * after which the connection ends. */
function answer(client, status, message) {
  const body = JSON.stringify({ message })
  client.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
}

/** Serves one client connection, which carries one request: a container create is read whole, rewritten and forwarded;
 * any other request is forwarded as it comes and both directions are piped. */
function serve(client, target, network) {
  let upstream
  const drop = () => {
    client.destroy()
    upstream?.destroy()
  }
  client.on('error', drop)
  let data = Buffer.alloc(0)
  let fields
  let length
  /** Answers with an error and drops whatever the client still sends. */
  const refuse = (status, message) => {
    client.off('data', onData)
    client.resume()
    answer(client, status, message)
  }
  const refused = (status, reason) => refuse(status, `restore-check's loopback relay refused this container create: ${reason}`)
  /** Forwards `bytes`, then pipes the upstream's answer back unchanged; `both` pipes the client's later bytes on too. */
  const open = (bytes, both) => {
    client.off('data', onData)
    client.off('end', onEarlyEnd)
    let connected = false
    upstream = connect({ path: target, allowHalfOpen: true })
    upstream.on('connect', () => {
      connected = true
    })
    upstream.on('error', (error) => {
      if (connected) return drop()
      client.unpipe(upstream)
      refuse(502, `restore-check's loopback relay could not reach Docker at ${target} (${error.code ?? error.message})`)
    })
    upstream.write(bytes)
    upstream.pipe(client)
    if (both) client.pipe(upstream)
    else {
      client.on('end', () => upstream.end())
      client.resume()
    }
  }
  /** A head rebuilt without the named fields, with `extra` lines at its end. */
  const rebuild = (without, extra) =>
    Buffer.from([...fields.filter((field) => !without.includes(field.name)).map((field) => field.line), ...extra, '', ''].join('\r\n'), 'latin1')
  const onData = (chunk) => {
    data = Buffer.concat([data, chunk])
    if (fields === undefined) {
      const end = data.indexOf('\r\n\r\n')
      if ((end < 0 ? data.length : end + 4) > HEAD_LIMIT) return refuse(431, "restore-check's loopback relay refused this request: its head is over 64 KiB")
      if (end < 0) return
      const head = data.subarray(0, end + 4)
      data = data.subarray(end + 4)
      // The request line stays first; it has no colon, so no field name matches it.
      fields = head
        .subarray(0, end)
        .toString('latin1')
        .split('\r\n')
        .map((line, index) => ({ line, name: index === 0 ? '' : line.slice(0, Math.max(line.indexOf(':'), 0)).trim().toLowerCase() }))
      const [method, path = ''] = fields[0].line.split(' ')
      const has = (name) => fields.filter((field) => field.name === name)
      if (!(method === 'POST' && CREATE.test(path.split('?')[0]))) {
        // A hijack (exec, attach) goes as it came. Any other request is made its connection's only one, so the relay never
        // has to find where a body it does not read (a chunked upload) ends and the next request starts.
        return open(Buffer.concat([has('upgrade').length > 0 ? head : rebuild(['connection', 'keep-alive'], ['Connection: close']), data]), true)
      }
      if (has('transfer-encoding').length > 0 || has('upgrade').length > 0) return refused(400, 'it is sent chunked or asks for an upgrade')
      const lengths = has('content-length').map((field) => field.line.slice(field.line.indexOf(':') + 1).trim())
      if (lengths.length !== 1 || !/^\d+$/.test(lengths[0])) return refused(400, 'it does not carry exactly one Content-Length')
      length = Number(lengths[0])
      if (length > BODY_LIMIT) return refused(413, 'its body is over 1 MiB')
    }
    if (data.length < length) return
    const rewritten = rewriteCreate(data.subarray(0, length), network)
    if (rewritten.refusal) return refused(403, rewritten.refusal)
    // What the client sends after the body is not forwarded.
    open(Buffer.concat([rebuild(['content-length', 'connection', 'keep-alive'], [`Content-Length: ${rewritten.body.length}`, 'Connection: close']), rewritten.body]), false)
  }
  const onEarlyEnd = () => client.end()
  client.on('data', onData)
  client.on('end', onEarlyEnd)
}

/** Starts the relay in a worker thread, forwarding to `upstream` (a `DOCKER_HOST`-style value) and allowing creates on
 * `network` only. Resolves once it listens, with the `DOCKER_HOST` value that reaches it and `close()`, which is
 * idempotent and synchronous enough for an 'exit' handler: it removes the socket's folder before it returns the worker's
 * termination. */
export async function startLoopbackRelay({ upstream, network }) {
  const target = relayTarget(upstream)
  let folder
  let path
  let dockerHost
  if (process.platform === 'win32') {
    // Node's default pipe security; the random name cannot be guessed ahead of the run.
    const name = `anasaq-restore-relay-${randomBytes(8).toString('hex')}`
    path = `\\\\.\\pipe\\${name}`
    dockerHost = `npipe:////./pipe/${name}`
  } else {
    // mkdtemp makes the folder 0700, so only this user can reach the socket in it. The path stays short: macOS allows a
    // socket path of 104 bytes.
    folder = mkdtempSync(join(tmpdir(), 'anasaq-relay-'))
    path = join(folder, 'd.sock')
    dockerHost = `unix://${path}`
  }
  let worker
  const close = () => {
    process.off('exit', close)
    if (folder) rmSync(folder, { recursive: true, force: true })
    return worker?.terminate() ?? Promise.resolve()
  }
  // The folder goes on the way out whatever happens, a Ctrl+C before the caller holds `close` included.
  process.once('exit', close)
  let started = false
  try {
    worker = new Worker(new URL(import.meta.url), { workerData: { dockerLoopbackRelay: { path, target, network } } })
    // A Worker 'error' with no listener would throw in the main thread. A relay that dies after the start fails the CLI's
    // next request, so the start fails closed; this says why.
    worker.on('error', (error) => {
      if (started) console.error(`restore-check's loopback relay stopped: ${error.message}`)
    })
    await new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error("restore-check's loopback relay did not start within 10 s.")), 10_000).unref()
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', (code) => reject(new Error(`restore-check's loopback relay stopped before it listened (exit ${code}).`)))
    })
  } catch (error) {
    await close()
    throw error
  }
  started = true
  worker.unref()
  return { dockerHost, close }
}

if (!isMainThread && workerData?.dockerLoopbackRelay) {
  const { path, target, network } = workerData.dockerLoopbackRelay
  createServer({ allowHalfOpen: true }, (client) => serve(client, target, network)).listen(path, () => parentPort.postMessage('listening'))
}
