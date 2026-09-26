# Media library: rights and limits (P05)

A short guide for staff who upload images to the library. The library stores
its objects in Supabase Storage (D32: a private bucket for originals, a
public one for the checked WebP sizes), and there is no
server-side image processing: the browser generates the WebP sizes at upload
time, and the server only verifies what arrived.

## Before an image can go live

- **Alt text (`altAr`) is required.** Describe the image in Arabic for a
  visitor who cannot see it. This is not optional and cannot be left blank.
- **The rights statement is required.** A short Arabic note naming who owns
  the image and what allows us to publish it (for example the photographer
  and the licence, or "تصوير أنس" for our own work). If you do not have the
  right to publish an image, it does not go into the library at all.
- **A caption is optional** (at most 500 characters).
- The name (at most 120 characters) is the library label; the folder is a
  `/`-separated path of your choosing, Arabic allowed, and the empty string
  is the root folder.

## Formats and limits

| What | Limit |
| --- | --- |
| Original format | JPEG, PNG, WebP or AVIF |
| Original size | at most 15 MiB and 40 million pixels |
| Derivative size | at most 4 MiB each |
| Derivative widths | 360, 720, 1200 and 1800 px — only the ones that fit the crop; a smaller crop gets its own width. The library never upscales. |
| Open uploads per person | at most 10 tickets; a ticket expires after 5 minutes |

SVG, HTML, plain text and archive files are refused, as is any file whose
real content does not match what was declared. The server checks the file's
magic bytes, type and dimensions from the first MiB of each object. **These
are header checks, not a full decode and not a guarantee that metadata has
been stripped** — but every derivative is re-encoded by the browser as WebP,
and re-encoding drops the source file's metadata, including EXIF such as
camera and GPS data. The original is kept as uploaded, privately, so a
future crop does not lose quality.

## What stays private

- The **original** (`originals/<id>`) is never served to visitors. It stays
  in the private bucket for re-cropping later.
- During upload, derivatives wait in a private **quarantine** area until
  every part has been verified. Anything that fails verification is deleted
  immediately.
- Only the verified WebP derivatives are published, from an isolated public
  origin, with `nosniff` and a sandboxing content-security-policy. A visitor
  can never list the library or fetch another image by guessing.

## Reuse and deletion

Images are meant to be reused across records. A library image that a live,
drafted or scheduled document still references cannot be deleted — remove
those references first. Publishing a document whose library image has
disappeared is refused with «صورة من المكتبة لم تعد موجودة.».

## Working in the library (المكتبة)

The library lives at **/admin/media** (owners and editors). Its steps:

1. **«رفع صورة»** opens the upload dialog in the folder you are filtering
   by. Choose the file, crop it (the aspect presets or the image's own
   ratio, with the zoom slider), fill the required alt text and rights, then
   «رفع». The browser generates the WebP sizes while uploading; a progress
   line shows which part is being sent. If anything fails, «إعادة المحاولة»
   starts over with a new ticket — the same file, crop and fields are kept,
   and nothing half-uploaded is ever published.
2. **Folders** are just text: type a `/`-separated path in the item's
   «المجلد» field (Arabic allowed) and save. «تصفية بالمجلد» filters the
   grid; «إعادة تسمية المجلد» moves a whole folder, including everything
   under it.
3. **Reuse**: on any content form, an image field's «اختر من المكتبة» opens
   the same grid inside the form; choosing a tile puts the library id in the
   field and shows a small preview instead of the raw id.
4. **«مستخدمة في»** in the details panel lists every document that still
   references the image, as a link with its state (منشورة / مسودة / مجدولة).
   «حذف» stays disabled while that list is not empty — the server enforces
   the same guard again — and asks for confirmation in a dialog. Deleting
   removes the private original and every public derivative.

The details panel also shows the original's dimensions, size and type
read-only, with the list of generated derivatives.
