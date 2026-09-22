import type { CollectionConfig } from 'payload'

/**
 * Staff identity. Payload's native authentication is the only staff identity in
 * this project (D08): password, login/logout, reset, verification and lockout
 * all come from Payload itself.
 *
 * P00 scope: enough to prove native login works against Supabase PostgreSQL.
 * The full owner/editor/operations access matrix, the last-owner guard, the
 * active-role recheck and owner MFA are P03's work.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  labels: {
    singular: 'مستخدم',
    plural: 'المستخدمون',
  },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'role'],
  },
  access: {
    // Public registration is disabled: only a signed-in staff user may create
    // another user. Payload's native "create first user" bootstrap still works
    // while the collection is empty, which is the out-of-band owner bootstrap.
    create: ({ req }) => Boolean(req.user),
    read: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
    admin: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'owner',
      label: 'الدور',
      options: [
        { label: 'المالك', value: 'owner' },
        { label: 'محرّر', value: 'editor' },
        { label: 'تشغيل', value: 'operations' },
      ],
    },
  ],
}
