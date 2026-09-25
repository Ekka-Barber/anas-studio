'use client'

/**
 * Renders one field from a collection's field config (P04 part 2). Every
 * field type in `src/admin/fields.ts` is handled here, recursively for
 * `group` and `list`. Values flow up through `onChange`; the parent
 * (`CollectionForm`) owns the document state.
 */
import { type Field } from '@/admin/fields'

import imageManifestRaw from '../../../public/images/manifest.json'
import mediaManifestRaw from '../../../public/media/manifest.json'

import styles from './admin.module.css'
import { RichTextEditor } from './RichTextEditor'

const imageIds = Object.keys(imageManifestRaw as Record<string, unknown>)
const videoIds = Object.keys((mediaManifestRaw as { videos: Record<string, unknown> }).videos)

export interface Taxonomy {
  slug: string
  label: string
}

export interface TaxonomiesByKind {
  category: Taxonomy[]
  tag: Taxonomy[]
}

/** A field list's empty starting value, computed from the config itself. */
export function defaultsForFields(fields: readonly Field[]): Record<string, unknown> {
  const value: Record<string, unknown> = {}
  for (const field of fields) value[field.name] = defaultForField(field)
  return value
}

function defaultForField(field: Field): unknown {
  if (field.nullable) return null
  // An optional (not nullable) image/video has no valid "empty" id, so an
  // empty default must be an absent key, not '' (which would fail the id
  // schema). `posts.cover` is the only field like this today.
  if (field.required === false && (field.type === 'image' || field.type === 'video')) return undefined
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'slug':
    case 'date':
    case 'image':
    case 'video':
      return ''
    case 'paragraphs':
    case 'relation':
      return []
    case 'boolean':
      return false
    case 'select':
      return field.options[0] ?? ''
    case 'richtext':
      return { root: { type: 'root', children: [] } }
    case 'group':
      return defaultsForFields(field.fields)
    case 'list':
      return []
  }
}

function move<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice()
  const [item] = next.splice(from, 1)
  if (item === undefined) return next
  next.splice(to, 0, item)
  return next
}

interface FieldInputProps {
  field: Field
  value: unknown
  onChange: (value: unknown) => void
  id: string
  taxonomies?: TaxonomiesByKind
}

export function FieldInput({ field, value, onChange, id, taxonomies }: FieldInputProps) {
  switch (field.type) {
    case 'text':
    case 'slug':
      return (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id}>
            {field.label}
          </label>
          <input
            id={id}
            className={styles.input}
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      )
    case 'textarea':
      return (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id}>
            {field.label}
          </label>
          <textarea
            id={id}
            className={styles.input}
            rows={4}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      )
    case 'date':
      return (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id}>
            {field.label}
          </label>
          <input
            id={id}
            className={styles.input}
            type="date"
            value={typeof value === 'string' ? value.slice(0, 10) : ''}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      )
    case 'boolean':
      return (
        <div className={styles.row}>
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
          <label htmlFor={id}>{field.label}</label>
        </div>
      )
    case 'select':
      return (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id}>
            {field.label}
          </label>
          <select
            id={id}
            className={styles.input}
            value={typeof value === 'string' ? value : (field.options[0] ?? '')}
            onChange={(event) => onChange(event.target.value)}
          >
            {field.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      )
    case 'image':
    case 'video': {
      const listId = `${id}-list`
      const ids = field.type === 'image' ? imageIds : videoIds
      const clearable = field.nullable || field.required === false
      const emptyValue = field.nullable ? null : undefined
      if (clearable && (value === null || value === undefined)) {
        return (
          <div className={styles.field}>
            <span className={styles.label}>{field.label}</span>
            <button type="button" className={styles.buttonSecondary} onClick={() => onChange('')}>
              إضافة صورة
            </button>
          </div>
        )
      }
      return (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id}>
            {field.label}
          </label>
          <input
            id={id}
            className={styles.input}
            list={listId}
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
          <datalist id={listId}>
            {ids.map((optionId) => (
              <option key={optionId} value={optionId} />
            ))}
          </datalist>
          {clearable && (
            <button type="button" className={styles.buttonSecondary} onClick={() => onChange(emptyValue)}>
              إزالة
            </button>
          )}
        </div>
      )
    }
    case 'relation': {
      const kind = field.name === 'tags' ? 'tag' : 'category'
      const options = taxonomies?.[kind] ?? []
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{field.label}</legend>
          {options.length === 0 && <p className={styles.message}>لا توجد عناصر منشورة بعد.</p>}
          {options.map((option) => (
            <div key={option.slug} className={styles.row}>
              <input
                id={`${id}-${option.slug}`}
                type="checkbox"
                checked={selected.includes(option.slug)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, option.slug]
                      : selected.filter((slug) => slug !== option.slug),
                  )
                }
              />
              <label htmlFor={`${id}-${option.slug}`}>{option.label}</label>
            </div>
          ))}
        </fieldset>
      )
    }
    case 'richtext':
      return (
        <div className={styles.field}>
          <span className={styles.label}>{field.label}</span>
          <RichTextEditor
            value={(value ?? { root: { type: 'root', children: [] } }) as never}
            onChange={onChange}
          />
        </div>
      )
    case 'group': {
      const groupValue = (value ?? {}) as Record<string, unknown>
      return (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{field.label}</legend>
          {field.fields.map((child) => (
            <FieldInput
              key={child.name}
              field={child}
              value={groupValue[child.name]}
              onChange={(childValue) => onChange({ ...groupValue, [child.name]: childValue })}
              id={`${id}-${child.name}`}
              taxonomies={taxonomies}
            />
          ))}
        </fieldset>
      )
    }
    case 'paragraphs': {
      const items = Array.isArray(value) ? (value as string[]) : []
      return (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{field.label}</legend>
          {items.map((paragraph, index) => (
            <div key={index} className={styles.listItem}>
              <label className={styles.label} htmlFor={`${id}-${index}`}>
                {field.label} {index + 1}
              </label>
              <textarea
                id={`${id}-${index}`}
                className={styles.input}
                rows={3}
                value={paragraph}
                onChange={(event) => {
                  const next = items.slice()
                  next[index] = event.target.value
                  onChange(next)
                }}
              />
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  disabled={index === 0}
                  onClick={() => onChange(move(items, index, index - 1))}
                >
                  أعلى
                </button>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  disabled={index === items.length - 1}
                  onClick={() => onChange(move(items, index, index + 1))}
                >
                  أسفل
                </button>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
                >
                  حذف
                </button>
              </div>
            </div>
          ))}
          <button type="button" className={styles.buttonSecondary} onClick={() => onChange([...items, ''])}>
            أضف فقرة
          </button>
        </fieldset>
      )
    }
    case 'list': {
      const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : []
      return (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{field.label}</legend>
          {items.map((item, index) => (
            <div key={index} className={styles.listItem}>
              {field.fields.map((child) => (
                <FieldInput
                  key={child.name}
                  field={child}
                  value={item[child.name]}
                  onChange={(childValue) => {
                    const next = items.slice()
                    next[index] = { ...item, [child.name]: childValue }
                    onChange(next)
                  }}
                  id={`${id}-${index}-${child.name}`}
                  taxonomies={taxonomies}
                />
              ))}
              {field.hideable && (
                <div className={styles.row}>
                  <input
                    id={`${id}-${index}-hidden`}
                    type="checkbox"
                    checked={item.hidden === true}
                    onChange={(event) => {
                      const next = items.slice()
                      next[index] = { ...item, hidden: event.target.checked }
                      onChange(next)
                    }}
                  />
                  <label htmlFor={`${id}-${index}-hidden`}>إخفاء</label>
                </div>
              )}
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  disabled={index === 0}
                  onClick={() => onChange(move(items, index, index - 1))}
                >
                  أعلى
                </button>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  disabled={index === items.length - 1}
                  onClick={() => onChange(move(items, index, index + 1))}
                >
                  أسفل
                </button>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
                >
                  حذف
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() =>
              onChange([
                ...items,
                { ...defaultsForFields(field.fields), ...(field.hideable ? { hidden: false } : {}) },
              ])
            }
          >
            أضف عنصرًا
          </button>
        </fieldset>
      )
    }
  }
}
