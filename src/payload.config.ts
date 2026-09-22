import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { ar } from '@payloadcms/translations/languages/ar'
import { buildConfig } from 'payload'

import { cmsPoolOptions } from './lib/db'
import { optionalEnv, requireEnv } from './lib/env'
import { RuntimeProbe } from './payload/collections/RuntimeProbe'
import { Users } from './payload/collections/Users'
import { jobs } from './payload/jobs'
import { r2StoragePlugin, RuntimeProbeMedia } from './payload/storage'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  // Unconfigured means unavailable: there is no fallback secret.
  secret: requireEnv('PAYLOAD_SECRET'),
  serverURL: optionalEnv('SITE_URL'),

  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },

  // Arabic admin. Payload derives the right-to-left direction from the active
  // language, so the native admin renders RTL without a custom layer.
  i18n: {
    fallbackLanguage: 'ar',
    supportedLanguages: { ar },
  },

  collections: [Users, RuntimeProbe, RuntimeProbeMedia],

  editor: lexicalEditor(),

  db: postgresAdapter({
    pool: cmsPoolOptions,
    // UUID primary keys, explicit `cms` schema, no schema push. `schemaName` is
    // documented experimental, so P00 verifies the qualification rather than
    // assuming it.
    idType: 'uuid',
    schemaName: 'cms',
    push: false,
    disableCreateDatabase: true,
    migrationDir: path.resolve(dirname, 'payload/migrations'),
    generateSchemaOutputFile: path.resolve(dirname, 'payload-generated.schema.ts'),
  }),

  jobs,

  plugins: [r2StoragePlugin],

  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },

  // `sharp` is deliberately absent (D15). Passing it is what enables Payload's
  // native image resizing; leaving it out keeps every native resize path off.
})
