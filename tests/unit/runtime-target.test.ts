import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The one runtime switch (I19/D27): `RUNTIME_TARGET=node` selects the Node
 * admin target's storage adapter and job runner; unset keeps the Worker
 * target. `src/payload/storage.ts` and `src/payload/jobs.ts` both decide this
 * once, at module load, so each case here resets the module registry and
 * re-imports rather than reusing a cached module.
 *
 * Importing `src/payload/jobs.ts` transitively imports `src/payload/storage.ts`
 * (via `./collections/RuntimeProbe`), so one import per case exercises both.
 */

const ENV_KEYS = [
  'RUNTIME_TARGET',
  'R2_BUCKET_NAME',
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ENV_KEYS) delete process.env[key]
  vi.resetModules()
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  vi.doUnmock('@payloadcms/storage-r2')
  vi.doUnmock('@payloadcms/storage-s3')
})

function mockStorageAdapters() {
  const r2Storage = vi.fn((options: unknown) => () => options)
  const s3Storage = vi.fn((options: unknown) => () => options)
  vi.doMock('@payloadcms/storage-r2', () => ({ r2Storage }))
  vi.doMock('@payloadcms/storage-s3', () => ({ s3Storage }))
  return { r2Storage, s3Storage }
}

describe('RUNTIME_TARGET switch', () => {
  it('unset: selects the R2 binding adapter and sets no autoRun', async () => {
    const { r2Storage, s3Storage } = mockStorageAdapters()

    const { jobs } = await import('../../src/payload/jobs')

    expect(r2Storage).toHaveBeenCalledTimes(1)
    expect(s3Storage).not.toHaveBeenCalled()
    expect(jobs.autoRun).toBeUndefined()
  })

  it('node: selects storage-s3 with the required env and enables autoRun', async () => {
    process.env.RUNTIME_TARGET = 'node'
    process.env.R2_BUCKET_NAME = 'test-bucket'
    process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com'
    process.env.R2_ACCESS_KEY_ID = 'test-key'
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret'
    const { r2Storage, s3Storage } = mockStorageAdapters()

    const { jobs } = await import('../../src/payload/jobs')

    expect(r2Storage).not.toHaveBeenCalled()
    expect(s3Storage).toHaveBeenCalledTimes(1)
    expect(s3Storage.mock.calls[0]?.[0]).toMatchObject({
      bucket: 'test-bucket',
      config: {
        region: 'auto',
        endpoint: 'https://acct.r2.cloudflarestorage.com',
        credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
      },
    })
    expect(jobs.autoRun).toEqual([{ cron: '*/15 * * * *', queue: 'default', limit: 5 }])
  })

  it('node without required env throws instead of defaulting', async () => {
    process.env.RUNTIME_TARGET = 'node'
    // R2_* deliberately left unset.
    mockStorageAdapters()

    await expect(import('../../src/payload/jobs')).rejects.toThrow(
      'Missing required environment variable: R2_BUCKET_NAME',
    )
  })
})
