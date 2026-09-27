'use client'

/**
 * The browser upload flow (P05 round 2): choose a file, crop it with
 * react-easy-crop, encode the bounded WebP derivatives on a canvas (no
 * library, no WASM, no server-side processing), then upload the original and
 * every derivative through the ticket API. A failed ticket is dead by design
 * — «إعادة المحاولة» starts over with a new ticket and the same file, crop
 * and fields. If the browser cannot encode WebP the upload stops with an
 * actionable message; the original is never published as a fallback.
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import Cropper from 'react-easy-crop'

import { mediaFields, mediaMetaSchema, type MediaMeta } from '@/admin/collections/media'
import { derivativeHeight, derivativeWidths } from '@/lib/media-ref'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { callFunction } from '@/lib/supabase/functions'

import { FieldInput } from './FieldInput'
import styles from './admin.module.css'

// Mirrors the server's limits in src/lib/media.ts (importing that module
// here would pull server-only code into the client bundle).
const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
const MAX_ORIGINAL_BYTES = 15_728_640
const MAX_PIXELS = 40_000_000
const MAX_DERIVATIVE_BYTES = 4_194_304

const TYPE_ERROR = 'نوع الملف غير مدعوم؛ استخدم JPEG أو PNG أو WebP أو AVIF.'
const SIZE_ERROR = 'حجم الملف أكبر من 15 ميغابايت.'
const PIXELS_ERROR = 'حجم الصورة بالبكسل أكبر من المسموح.'
const DECODE_ERROR = 'تعذّرت قراءة الصورة.'
const CANVAS_ERROR = 'تعذّر تجهيز أداة الرسم في هذا المتصفح.'
const WEBP_ERROR =
  'هذا المتصفح لا يستطيع إنشاء صور WebP. استخدم نسخة حديثة من Chrome أو Edge أو Firefox أو Safari.'
const DERIVATIVE_SIZE_ERROR = 'حجم أحد المقاسات بعد التحويل أكبر من 4 ميغابايت؛ جرّب اقتصاصًا أصغر أو صورة أبسط.'

// react-easy-crop needs one fixed aspect, so «الأصل» offers the image's own
// ratio instead of a free-form crop.
const ASPECTS = [
  { key: 'origin', label: 'الأصل' },
  { key: '1:1', label: '1:1' },
  { key: '4:3', label: '4:3' },
  { key: '3:4', label: '3:4' },
  { key: '16:9', label: '16:9' },
] as const
type AspectKey = (typeof ASPECTS)[number]['key']

function aspectNumber(key: AspectKey, bitmap: ImageBitmap): number {
  if (key === 'origin') return bitmap.width / bitmap.height
  const [width, height] = key.split(':').map(Number)
  return width! / height!
}

interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** Integers clamped inside the bitmap, whatever the cropper reports. */
function clampCrop(area: { x: number; y: number; width: number; height: number }, bitmap: ImageBitmap): CropRect {
  const width = Math.max(1, Math.min(bitmap.width, Math.round(area.width)))
  const height = Math.max(1, Math.min(bitmap.height, Math.round(area.height)))
  return {
    width,
    height,
    x: Math.max(0, Math.min(bitmap.width - width, Math.round(area.x))),
    y: Math.max(0, Math.min(bitmap.height - height, Math.round(area.y))),
  }
}

async function encodeDerivative(
  bitmap: ImageBitmap,
  crop: CropRect,
  width: number,
): Promise<{ blob: Blob } | { error: string }> {
  const height = derivativeHeight(width, crop)
  let canvas: OffscreenCanvas | HTMLCanvasElement
  let context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height)
    context = canvas.getContext('2d')
  } else {
    canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    context = canvas.getContext('2d')
  }
  if (!context) return { error: CANVAS_ERROR }
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
  let blob: Blob | null
  try {
    blob =
      'convertToBlob' in canvas
        ? await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
        : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82))
  } catch {
    blob = null
  }
  if (!blob || blob.type !== 'image/webp') return { error: WEBP_ERROR }
  if (blob.size > MAX_DERIVATIVE_BYTES) return { error: DERIVATIVE_SIZE_ERROR }
  return { blob }
}

/** The `admin` function's `media-ticket` answer: one signed upload per declared part (D32). */
interface UploadTicket {
  ticketId: string
  bucket: string
  parts: Array<{ part: string; path: string; token: string; mime: string }>
}

export function MediaUpload({
  open,
  folder,
  onClose,
  onUploaded,
}: {
  open: boolean
  folder: string
  onClose: () => void
  onUploaded: (id: string) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [aspectKey, setAspectKey] = useState<AspectKey>('origin')
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [cropPixels, setCropPixels] = useState<CropRect | null>(null)
  const [values, setValues] = useState<Record<string, string>>({
    name: '',
    altAr: '',
    caption: '',
    rights: '',
    folder,
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    // Deferred to a microtask so the setState is not synchronous within the
    // effect body (react-hooks/set-state-in-effect), like CollectionForm's load.
    void Promise.resolve().then(() => setValues((previous) => ({ ...previous, folder })))
  }, [folder])

  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    },
    [imageUrl],
  )

  function reset() {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setFile(null)
    setBitmap((previous) => {
      previous?.close()
      return null
    })
    setImageUrl(null)
    setFileError(null)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCropPixels(null)
    setFailure(null)
    // Alt text, rights and the rest describe one image; only the folder carries over.
    setValues((previous) => ({ name: '', altAr: '', caption: '', rights: '', folder: previous.folder ?? folder }))
    setFieldErrors({})
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null
    event.target.value = ''
    if (!chosen) return
    setFileError(null)
    setFailure(null)
    if (!ACCEPTED_MIME_TYPES.includes(chosen.type)) {
      setFileError(TYPE_ERROR)
      return
    }
    if (chosen.size > MAX_ORIGINAL_BYTES) {
      setFileError(SIZE_ERROR)
      return
    }
    let decoded: ImageBitmap
    try {
      // Applies the EXIF orientation, so what is cropped is what shows.
      decoded = await createImageBitmap(chosen)
    } catch {
      setFileError(DECODE_ERROR)
      return
    }
    if (decoded.width * decoded.height > MAX_PIXELS) {
      decoded.close()
      setFileError(PIXELS_ERROR)
      return
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setImageUrl(URL.createObjectURL(chosen))
    setFile(chosen)
    setBitmap(decoded)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setValues((previous) => ({
      ...previous,
      name: previous.name || chosen.name.replace(/\.[^.]+$/, '') || chosen.name,
    }))
  }

  function cancel() {
    if (busy) return
    reset()
    onClose()
  }

  async function runUpload(meta: MediaMeta, widths: number[], blobs: Blob[]): Promise<{ id: string } | { message: string }> {
    const declared = {
      purpose: 'image',
      name: meta.name,
      folder: meta.folder,
      altAr: meta.altAr,
      caption: meta.caption ?? '',
      rights: meta.rights,
      original: { mime: file!.type, bytes: file!.size, width: bitmap!.width, height: bitmap!.height },
      crop: cropPixels!,
      derivatives: blobs.map((blob, index) => ({
        width: widths[index]!,
        height: derivativeHeight(widths[index]!, cropPixels!),
        bytes: blob.size,
      })),
    }
    const ticket = await callFunction<UploadTicket>('admin', { action: 'media-ticket', declaration: declared })
    if (!ticket.ok) return { message: ticket.error.message }

    // Each part goes straight to the private bucket through its signed URL;
    // `media-complete` then checks every byte before anything is public.
    const bodies = new Map<string, Blob>([
      ['original', file!],
      ...blobs.map((blob, index) => [`w${widths[index]}`, blob] as [string, Blob]),
    ])
    const bucket = getSupabaseBrowserClient().storage.from(ticket.data.bucket)
    for (const [index, part] of ticket.data.parts.entries()) {
      setBusy(`جارٍ رفع ${index + 1} من ${ticket.data.parts.length}`)
      const body = bodies.get(part.part)
      if (!body) return { message: 'تعذّر رفع الصورة.' }
      const { error } = await bucket.uploadToSignedUrl(part.path, part.token, body, { contentType: part.mime })
      if (error) return { message: 'تعذّر رفع الصورة.' }
    }
    const finished = await callFunction<{ id: string }>('admin', { action: 'media-complete', ticketId: ticket.data.ticketId })
    if (!finished.ok) return { message: finished.error.message }
    return { id: finished.data.id }
  }

  async function submit() {
    if (!file || !bitmap || !cropPixels || busy) return
    setFailure(null)
    const parsed = mediaMetaSchema.safeParse(values)
    if (!parsed.success) {
      const errors: Record<string, string> = {}
      for (const [name, list] of Object.entries(parsed.error.flatten().fieldErrors)) {
        if (list?.[0]) errors[name] = list[0]
      }
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})
    const widths = derivativeWidths(cropPixels.width)
    setBusy('جارٍ تجهيز الصور')
    const blobs: Blob[] = []
    for (const width of widths) {
      const encoded = await encodeDerivative(bitmap, cropPixels, width)
      if ('error' in encoded) {
        setBusy(null)
        setFailure(encoded.error)
        return
      }
      blobs.push(encoded.blob)
    }
    const result = await runUpload(parsed.data, widths, blobs)
    setBusy(null)
    if ('id' in result) {
      reset()
      onUploaded(result.id)
      return
    }
    setFailure(result.message)
  }

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles.dialogWide}`}
      onCancel={(event) => {
        if (busy) event.preventDefault()
      }}
      onClose={onClose}
    >
      <h2>رفع صورة إلى المكتبة</h2>
      {!file || !bitmap || !imageUrl ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="media-upload-file">
            الملف
          </label>
          <input
            id="media-upload-file"
            className={styles.input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            onChange={(event) => void chooseFile(event)}
          />
          <p className={styles.message}>JPEG أو PNG أو WebP أو AVIF، حتى 15 ميغابايت و40 مليون بكسل.</p>
          {fileError && <p className={styles.error}>{fileError}</p>}
        </div>
      ) : (
        <>
          <div dir="ltr" className={styles.cropArea}>
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              rotation={0}
              aspect={aspectNumber(aspectKey, bitmap)}
              minZoom={1}
              maxZoom={3}
              cropShape="rect"
              objectFit="contain"
              showGrid
              zoomWithScroll={false}
              keyboardStep={25}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_area, areaPixels) => setCropPixels(clampCrop(areaPixels, bitmap))}
              style={{ containerStyle: { position: 'absolute', inset: 0 } }}
              classes={{}}
              restrictPosition
              mediaProps={{}}
              cropperProps={{ tabIndex: 0, 'aria-label': 'منطقة الاقتصاص' }}
            />
          </div>
          <div className={styles.row} role="group" aria-label="النسبة">
            {ASPECTS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className={styles.toolbarButton}
                aria-pressed={aspectKey === preset.key}
                onClick={() => setAspectKey(preset.key)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="media-upload-zoom">
              التقريب
            </label>
            <input
              id="media-upload-zoom"
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </div>
        </>
      )}
      {file && (
        <div className={styles.field}>
          {mediaFields.map((field) => (
            <div key={field.name} className={styles.field}>
              <FieldInput
                field={field}
                value={values[field.name]}
                onChange={(value) =>
                  setValues((previous) => ({ ...previous, [field.name]: typeof value === 'string' ? value : '' }))
                }
                id={`media-upload-${field.name}`}
              />
              {fieldErrors[field.name] && <p className={styles.error}>{fieldErrors[field.name]}</p>}
            </div>
          ))}
        </div>
      )}
      {busy && (
        <p className={styles.message} role="status">
          {busy}
        </p>
      )}
      {failure && (
        <div className={styles.row}>
          <p className={styles.error}>{failure}</p>
          <button type="button" className={styles.buttonSecondary} disabled={busy !== null} onClick={() => void submit()}>
            إعادة المحاولة
          </button>
        </div>
      )}
      <div className={styles.row}>
        <button
          type="button"
          className={styles.button}
          disabled={busy !== null || !file || !cropPixels}
          onClick={() => void submit()}
        >
          رفع
        </button>
        <button type="button" className={styles.buttonSecondary} disabled={busy !== null} onClick={cancel}>
          إلغاء
        </button>
        {file && (
          <button type="button" className={styles.buttonSecondary} disabled={busy !== null} onClick={reset}>
            اختيار ملف آخر
          </button>
        )}
      </div>
      <p className={styles.message}>يُحفظ الأصل خصوصيًا للاقتصاص لاحقًا، وتُنشر المشتقات فقط.</p>
    </dialog>
  )
}
