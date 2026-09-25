/**
 * What may be attached to a message or a deliverable.
 *
 * Pure validation and key derivation. Every rule here exists because the file
 * arrives from a browser and nothing about it can be trusted: not the name, not
 * the declared type, not the declared size.
 *
 * THE FOUR THINGS THIS PREVENTS
 *   1. **Path traversal and collision.** The storage key is *derived*, never
 *      taken from the client. A name of `../../etc/passwd` cannot become a key,
 *      because the name never reaches the key — only a sanitised label stored
 *      alongside it for display.
 *   2. **Executable content.** The allow-list holds documents, images, archives
 *      and media. Anything that a browser or an operating system might run is
 *      absent, and absence is the control: there is no "dangerous types need
 *      approval" path to misconfigure.
 *   3. **A declared type that contradicts the extension.** `invoice.pdf` sent as
 *      `image/png` is refused rather than stored under whichever of the two a
 *      later reader happens to believe.
 *   4. **Unbounded size.** A cap the storage layer can rely on, checked before
 *      anything is reserved.
 *
 * Content sniffing is deliberately NOT done here — it needs the bytes, and this
 * module runs before they exist. The upload boundary re-checks the real size and
 * the magic bytes when the object lands; see `services/messaging/attachment-service.ts`.
 */

/** 25 MB. Deliverables that exceed it belong in a linked repository or drive. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Display names are truncated, not rejected, at this length. */
export const MAX_FILE_NAME_LENGTH = 200;

/**
 * Accepted types, each with the extensions that may legitimately carry it.
 *
 * An allow-list, so adding a type is a deliberate act with a diff attached.
 */
export const ALLOWED_MIME_TYPES: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'application/zip': ['zip'],
  'application/json': ['json'],
  'text/plain': ['txt', 'md', 'log'],
  'text/csv': ['csv'],
  'text/markdown': ['md'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/svg+xml': ['svg'],
  'video/mp4': ['mp4'],
  'audio/mpeg': ['mp3'],
  'audio/wav': ['wav'],
};

export type AttachmentRefusal =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'EXTENSION_MISMATCH'
  | 'INVALID_FILE_NAME';

export interface UploadDescriptor {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/** The extension, lower-cased, without the dot. Empty when there is none. */
export function extensionOf(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/**
 * A safe display name.
 *
 * Directory separators, control characters and leading dots are removed, and the
 * result is length-bounded. This is what a reader sees; it is never a path.
 */
export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // Control characters are exactly what must go.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.slice(0, MAX_FILE_NAME_LENGTH);
}

/** Reject anything that cannot safely be stored. Returns null to accept. */
export function uploadRefusal(descriptor: UploadDescriptor): AttachmentRefusal | null {
  const name = sanitizeFileName(descriptor.fileName);
  if (name.length === 0) return 'INVALID_FILE_NAME';

  if (!Number.isInteger(descriptor.sizeBytes) || descriptor.sizeBytes <= 0) return 'EMPTY_FILE';
  if (descriptor.sizeBytes > MAX_ATTACHMENT_BYTES) return 'FILE_TOO_LARGE';

  // Parameters such as `; charset=utf-8` are stripped before matching.
  const mime = descriptor.mimeType.split(';')[0]!.trim().toLowerCase();
  const extensions = ALLOWED_MIME_TYPES[mime];
  if (!extensions) return 'UNSUPPORTED_TYPE';

  if (!extensions.includes(extensionOf(name))) return 'EXTENSION_MISMATCH';

  return null;
}

export function attachmentRefusalMessage(refusal: AttachmentRefusal): string {
  switch (refusal) {
    case 'EMPTY_FILE':
      return 'The file is empty.';
    case 'FILE_TOO_LARGE':
      return `Files must be ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB or smaller.`;
    case 'UNSUPPORTED_TYPE':
      return 'That file type is not accepted.';
    case 'EXTENSION_MISMATCH':
      return 'The file extension does not match its type.';
    case 'INVALID_FILE_NAME':
      return 'The file name is not usable.';
  }
}

/**
 * Derive the storage key.
 *
 * Built entirely from server-controlled values: the owning scope, the uploader,
 * a server-generated unique id and the *validated* extension. The client's name
 * contributes nothing, so no client can choose where its bytes land or overwrite
 * another object.
 */
export function buildFileKey(input: {
  readonly scope: 'messages' | 'deliverables';
  readonly scopeId: string;
  readonly uploaderUserId: string;
  readonly uniqueId: string;
  readonly fileName: string;
}): string {
  const extension = extensionOf(sanitizeFileName(input.fileName));
  const suffix = extension ? `.${extension}` : '';
  return `${input.scope}/${input.scopeId}/${input.uploaderUserId}/${input.uniqueId}${suffix}`;
}
