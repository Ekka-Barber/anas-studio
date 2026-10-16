/**
 * The paid file's limit, in one place (RESIDUALS-1 round R3b, QUALITY-24): the `admin` function's paid-file actions
 * (`paid-files.ts`) and the owner's upload form (`src/lib/admin-commerce.ts`, a client module that cannot import the Deno
 * function) refuse a file by the same number. Pure: no imports, no runtime APIs.
 */

/** The bucket's own limit (`file_size_limit` of the migration that created `paid-files`): 100 MiB. */
export const PAID_FILE_MAX_BYTES = 104_857_600
