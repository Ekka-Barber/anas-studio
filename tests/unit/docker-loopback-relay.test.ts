// I56: the Docker API relay restore-check runs around `supabase start`. The relay is started for real, in its worker
// thread, on a real named pipe on Windows and a unix socket elsewhere, in front of a fake Docker on its own pipe or
// socket; the real Docker is never reached. What it forwards is read from what the fake Docker received.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer as createHttpServer, request, type IncomingHttpHeaders } from 'node:http'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Worker } from 'node:worker_threads'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { relayTarget, startLoopbackRelay } from '../../scripts/lib/docker-loopback-relay.mjs'

const WINDOWS = process.platform === 'win32'
const NETWORK = 'supabase_network_anasaq-restore-check'
const REFUSED = "restore-check's loopback relay refused this container create: "

let dir: string

/** A fresh endpoint for a fake Docker: a named pipe on Windows, a unix socket elsewhere. */
const endpoint = (name: string) =>
  WINDOWS ? `\\\\.\\pipe\\anasaq-relay-test-${name}-${randomBytes(6).toString('hex')}` : join(dir, `${name}-${randomBytes(3).toString('hex')}.sock`)
const dockerHostOf = (path: string) => (WINDOWS ? `npipe://${path.replaceAll('\\', '/')}` : `unix://${path}`)

async function listen(server: Server, path = endpoint('docker')) {
  server.listen(path)
  await once(server, 'listening')
  return path
}

/** Sends `bytes` as they are and resolves with everything that comes back until the relay ends the connection. */
function raw(path: string, bytes: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const socket = connect(path, () => socket.write(bytes))
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('end', () => resolve(Buffer.concat(chunks).toString()))
    socket.on('error', reject)
  })
}

/** One HTTP request with node:http, on a connection of its own. */
function send(path: string, target: string, body: string, headers: Record<string, string> = {}) {
  return new Promise<{ status?: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const outgoing = request(
      { socketPath: path, method: 'POST', path: target, agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), ...headers } },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }))
      },
    )
    outgoing.on('error', reject)
    outgoing.end(body)
  })
}

const createRequest = (body: string) =>
  `POST /v1.47/containers/create?name=supabase_db_anasaq-restore-check HTTP/1.1\r\nHost: api.moby.localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
const createBody = (hostConfig: Record<string, unknown>) => JSON.stringify({ Image: 'postgres:17', HostConfig: hostConfig })
const port = (HostIp: string) => ({ '5432/tcp': [{ HostIp, HostPort: '55322' }] })

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'anasaq-relay-test-'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the loopback relay, in front of a fake Docker', { timeout: 30_000 }, () => {
  const seen: { method?: string; url?: string; headers: IncomingHttpHeaders; body: string }[] = []
  let connections = 0
  let docker: Server
  let relay: Awaited<ReturnType<typeof startLoopbackRelay>>
  let relayPath: string

  beforeAll(async () => {
    docker = createHttpServer((incoming, response) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
      incoming.on('end', () => {
        seen.push({ method: incoming.method, url: incoming.url, headers: incoming.headers, body: Buffer.concat(chunks).toString() })
        response.writeHead(201, { 'Content-Type': 'application/json', 'X-Fake-Docker': 'yes' })
        response.end('{"Id":"created","Warnings":[]}')
      })
    })
    docker.on('connection', () => (connections += 1))
    const path = await listen(docker)
    relay = await startLoopbackRelay({ upstream: dockerHostOf(path), network: NETWORK })
    relayPath = relayTarget(relay.dockerHost)
  })

  afterAll(async () => {
    await relay.close()
    docker.close()
  })

  beforeEach(() => {
    seen.length = 0
    connections = 0
  })

  it('writes 127.0.0.1 into every binding of a versioned create that names no host address, and changes nothing else', async () => {
    const sent = {
      Image: 'public.ecr.aws/supabase/postgres:17.6.1.032',
      ExposedPorts: { '5432/tcp': {}, '8000/tcp': {}, '9000/tcp': {} },
      Labels: { 'com.supabase.cli.project': 'anasaq-restore-check' },
      Healthcheck: { Interval: 10_000_000_000, Retries: 3 },
      HostConfig: {
        NetworkMode: NETWORK,
        RestartPolicy: { Name: 'always' },
        PortBindings: {
          '5432/tcp': [{ HostIp: '', HostPort: '55322' }],
          '8000/tcp': [{ HostPort: '55321' }],
          '9000/tcp': [{ HostIp: '127.0.0.1', HostPort: '55329' }],
        },
      },
    }
    const target = '/v1.47/containers/create?name=supabase_db_anasaq-restore-check'
    const answer = await send(relayPath, target, JSON.stringify(sent), { Connection: 'keep-alive' })

    expect(seen).toHaveLength(1)
    const [create] = seen
    expect({ method: create!.method, url: create!.url }).toEqual({ method: 'POST', url: target })
    const loopback = (HostPort: string) => [{ HostIp: '127.0.0.1', HostPort }]
    const PortBindings = { '5432/tcp': loopback('55322'), '8000/tcp': loopback('55321'), '9000/tcp': loopback('55329') }
    expect(JSON.parse(create!.body)).toEqual({ ...sent, HostConfig: { ...sent.HostConfig, PortBindings } })
    expect(create!.headers['content-length']).toBe(String(Buffer.byteLength(create!.body)))
    expect(create!.headers.connection).toBe('close')
    expect(create!.headers['content-type']).toBe('application/json')
    // The answer comes back as Docker gave it.
    expect(answer.status).toBe(201)
    expect(answer.headers['x-fake-docker']).toBe('yes')
    expect(answer.body).toBe('{"Id":"created","Warnings":[]}')
  })

  it('rewrites an unversioned create too', async () => {
    const answer = await send(relayPath, '/containers/create', createBody({ NetworkMode: NETWORK, PortBindings: port('') }))
    expect(answer.status).toBe(201)
    expect(JSON.parse(seen[0]!.body).HostConfig.PortBindings).toEqual(port('127.0.0.1'))
  })

  it.each([
    ['a binding on 0.0.0.0', createRequest(createBody({ NetworkMode: NETWORK, PortBindings: port('0.0.0.0') })), 403, '"0.0.0.0"'],
    ['a binding on ::', createRequest(createBody({ NetworkMode: NETWORK, PortBindings: port('::') })), 403, '"::"'],
    ['PublishAllPorts', createRequest(createBody({ NetworkMode: NETWORK, PublishAllPorts: true })), 403, 'PublishAllPorts'],
    ['host networking', createRequest(createBody({ NetworkMode: 'host', PortBindings: port('') })), 403, 'NetworkMode is "host"'],
    ['another network', createRequest(createBody({ NetworkMode: 'bridge', PortBindings: port('') })), 403, 'NetworkMode is "bridge"'],
    ['no HostConfig', createRequest(JSON.stringify({ Image: 'postgres:17' })), 403, 'no HostConfig'],
    ['a body that is not JSON', createRequest('not json'), 403, 'cannot be rewritten exactly'],
    ['an integer beyond 2^53', createRequest(`{"Image":"postgres:17","HostConfig":{"NetworkMode":"${NETWORK}","Memory":9007199254740993}}`), 403, 'beyond 2^53'],
    [
      'a chunked create',
      'POST /v1.47/containers/create HTTP/1.1\r\nHost: api.moby.localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n',
      400,
      'chunked',
    ],
    ['a create without Content-Length', 'POST /v1.47/containers/create HTTP/1.1\r\nHost: api.moby.localhost\r\nContent-Type: application/json\r\n\r\n{}', 400, 'Content-Length'],
    [
      'an Upgrade header',
      'POST /v1.47/containers/create HTTP/1.1\r\nHost: api.moby.localhost\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}',
      400,
      'upgrade',
    ],
    ['two Content-Length headers', 'POST /v1.47/containers/create HTTP/1.1\r\nHost: api.moby.localhost\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}', 400, 'exactly one Content-Length'],
    ['a body over 1 MiB', `POST /v1.47/containers/create HTTP/1.1\r\nHost: api.moby.localhost\r\nContent-Length: ${1024 * 1024 + 1}\r\n\r\n`, 413, 'over 1 MiB'],
  ])('refuses a create with %s, and Docker receives nothing', async (_name, bytes, status, reason) => {
    const answer = await raw(relayPath, bytes)
    expect(answer).toMatch(new RegExp(`^HTTP/1\\.1 ${status} `))
    expect(answer).toContain('\r\nConnection: close\r\n')
    const { message } = JSON.parse(answer.slice(answer.indexOf('\r\n\r\n') + 4)) as { message: string }
    expect(message.startsWith(REFUSED)).toBe(true)
    expect(message).toContain(reason)
    expect(seen).toEqual([])
    expect(connections).toBe(0)
  })

  it('refuses a request head over 64 KiB, and Docker receives nothing', async () => {
    const answer = await raw(relayPath, `GET /v1.47/${'a'.repeat(70 * 1024)} HTTP/1.1\r\n`)
    expect(answer).toMatch(/^HTTP\/1\.1 431 /)
    expect(answer).toContain('its head is over 64 KiB')
    expect(seen).toEqual([])
    expect(connections).toBe(0)
  })

  it('answers 502, saying so, when Docker cannot be reached', async () => {
    const lost = await startLoopbackRelay({ upstream: dockerHostOf(endpoint('never-reached')), network: NETWORK })
    try {
      const answer = await raw(relayTarget(lost.dockerHost), createRequest(createBody({ NetworkMode: NETWORK, PortBindings: port('') })))
      expect(answer).toMatch(/^HTTP\/1\.1 502 /)
      expect(answer).toContain("restore-check's loopback relay could not reach Docker at ")
    } finally {
      await lost.close()
    }
  })
})

describe('the loopback relay, for what is not a create', { timeout: 30_000 }, () => {
  /** A raw fake Docker: records the first bytes of each connection and answers with `reply`. */
  async function rawDocker(reply: (socket: Socket) => void) {
    const heads: string[] = []
    const server = createServer((socket) => {
      socket.once('data', (head: Buffer) => {
        heads.push(head.toString('latin1'))
        reply(socket)
      })
    })
    const path = await listen(server)
    const relay = await startLoopbackRelay({ upstream: dockerHostOf(path), network: NETWORK })
    const close = async () => {
      await relay.close()
      server.close()
    }
    return { heads, relayPath: relayTarget(relay.dockerHost), close }
  }

  it('passes any other request on as the only one of its connection, and its streamed answer back byte for byte', async () => {
    const chunk = (text: string) => `${Buffer.byteLength(text).toString(16)}\r\n${text}\r\n`
    const parts = ['HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n', chunk('{"status":"Pulling"}\n'), chunk('{"status":"Done"}\n'), '0\r\n\r\n']
    const docker = await rawDocker(async (socket) => {
      for (const part of parts) {
        socket.write(part)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      socket.end()
    })
    try {
      const answer = await raw(docker.relayPath, 'POST /v1.47/images/create?fromImage=postgres&tag=17 HTTP/1.1\r\nHost: api.moby.localhost\r\nConnection: keep-alive\r\nKeep-Alive: timeout=5\r\nUser-Agent: Docker-Client\r\nContent-Length: 0\r\n\r\n')
      expect(answer).toBe(parts.join(''))
      expect(docker.heads).toEqual(['POST /v1.47/images/create?fromImage=postgres&tag=17 HTTP/1.1\r\nHost: api.moby.localhost\r\nUser-Agent: Docker-Client\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'])
    } finally {
      await docker.close()
    }
  })

  it('relays an upgraded connection (exec, attach) both ways, its request as it came and a half-close too', async () => {
    const upgraded = 'HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n'
    const docker = await rawDocker((socket) => {
      socket.write(upgraded)
      socket.pipe(socket)
    })
    const start = '{"Detach":false,"Tty":false}'
    const hijack = `POST /v1.47/exec/abc/start HTTP/1.1\r\nHost: api.moby.localhost\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Type: application/json\r\nContent-Length: ${start.length}\r\n\r\n${start}`
    try {
      const answer = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        const socket = connect(docker.relayPath, () => socket.write(hijack))
        socket.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
          // Once upgraded, send a few bytes and half-close: the echo must still come back.
          if (Buffer.concat(chunks).toString() === upgraded) socket.end('ping')
        })
        socket.on('end', () => resolve(Buffer.concat(chunks).toString()))
        socket.on('error', reject)
      })
      expect(answer).toBe(`${upgraded}ping`)
      expect(docker.heads).toEqual([hijack])
    } finally {
      await docker.close()
    }
  })
})

describe('the loopback relay itself', { timeout: 30_000 }, () => {
  it('relays only a local Docker endpoint, a named pipe or a unix socket, and says so for anything else', async () => {
    expect(relayTarget('npipe:////./pipe/dockerDesktopLinuxEngine')).toBe('\\\\.\\pipe\\dockerDesktopLinuxEngine')
    expect(relayTarget('unix:///var/run/docker.sock')).toBe('/var/run/docker.sock')
    for (const value of ['tcp://127.0.0.1:2375', 'ssh://me@build-host', 'npipe:////build-host/pipe/docker_engine', '', 'fd://', 'unix://docker.sock']) {
      expect(() => relayTarget(value)).toThrow(`${JSON.stringify(value)}: the rehearsal can relay only a local Docker endpoint (a named pipe or a unix socket)`)
    }
    // Before anything starts.
    await expect(startLoopbackRelay({ upstream: 'tcp://127.0.0.1:2375', network: NETWORK })).rejects.toThrow('only a local Docker endpoint')
  })

  it('listens on a named pipe on Windows and on a socket in a private folder elsewhere, and is gone once closed', async () => {
    const relay = await startLoopbackRelay({ upstream: dockerHostOf(endpoint('never-reached')), network: NETWORK })
    const path = relayTarget(relay.dockerHost)
    const reach = () =>
      new Promise<void>((resolve, reject) => {
        const socket = connect(path, () => {
          socket.destroy()
          resolve()
        })
        socket.on('error', reject)
      })
    if (WINDOWS) {
      expect(relay.dockerHost).toMatch(/^npipe:\/\/\/\/\.\/pipe\/anasaq-restore-relay-[0-9a-f]{16}$/)
    } else {
      expect(relay.dockerHost).toMatch(/^unix:\/\/\/.+\/anasaq-relay-[^/]+\/d\.sock$/)
      expect(statSync(dirname(path)).mode & 0o777).toBe(0o700)
      expect(statSync(path).isSocket()).toBe(true)
    }
    await reach()
    await relay.close()
    await relay.close()
    if (!WINDOWS) expect(existsSync(dirname(path))).toBe(false)
    await expect(reach()).rejects.toThrow()
  })

  // restore-check runs `supabase start` with spawnSync, which blocks its main thread for the whole start: the relay must
  // serve from its worker all the same. Here the test's main thread is blocked the same way while a child process sends
  // a create through the relay, and the fake Docker runs in a worker of its own.
  it('serves while the main thread is blocked in spawnSync, as restore-check\'s is during `supabase start`', async () => {
    const log = join(dir, 'blocked.jsonl')
    const path = endpoint('blocked')
    const docker = new Worker(
      `const { appendFileSync } = require('node:fs')
      const { createServer } = require('node:http')
      const { parentPort, workerData } = require('node:worker_threads')
      createServer((incoming, response) => {
        let body = ''
        incoming.on('data', (chunk) => (body += chunk))
        incoming.on('end', () => {
          appendFileSync(workerData.log, JSON.stringify({ url: incoming.url, body }) + '\\n')
          response.writeHead(201, { 'Content-Type': 'application/json' })
          response.end('{"Id":"blocked-main","Warnings":[]}')
        })
      }).listen(workerData.path, () => parentPort.postMessage('listening'))`,
      { eval: true, workerData: { path, log } },
    )
    await once(docker, 'message')
    const relay = await startLoopbackRelay({ upstream: dockerHostOf(path), network: NETWORK })
    try {
      const client = spawnSync(
        process.execPath,
        [
          '-e',
          `const body = process.env.CREATE
          const outgoing = require('node:http').request({ socketPath: process.env.RELAY, method: 'POST', path: '/v1.47/containers/create', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (response) => {
            let text = ''
            response.on('data', (chunk) => (text += chunk))
            response.on('end', () => process.stdout.write(response.statusCode + ' ' + text))
          })
          outgoing.on('error', (error) => { process.stderr.write(String(error)); process.exitCode = 1 })
          outgoing.end(body)`,
        ],
        { encoding: 'utf8', timeout: 20_000, env: { ...process.env, RELAY: relayTarget(relay.dockerHost), CREATE: createBody({ NetworkMode: NETWORK, PortBindings: port('') }) } },
      )
      expect({ status: client.status, stdout: client.stdout, stderr: client.stderr }).toEqual({ status: 0, stdout: '201 {"Id":"blocked-main","Warnings":[]}', stderr: '' })
      const received = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { url: string; body: string })
      expect(received).toHaveLength(1)
      expect(JSON.parse(received[0]!.body).HostConfig.PortBindings).toEqual(port('127.0.0.1'))
    } finally {
      await relay.close()
      await docker.terminate()
    }
  })
})
