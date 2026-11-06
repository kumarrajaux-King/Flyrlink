/**
 * Object storage behind an adapter.
 *
 * STEP 02 §25 keeps every external provider behind an interface, for the same
 * reason the AI providers and the email sender are: the application must not
 * learn a vendor's shape, and development must not require that vendor's
 * credentials.
 *
 * THE UPLOAD MODEL
 *   Bytes never pass through the application. The client asks for permission to
 *   upload, the server validates the *description* of the file and reserves a
 *   server-derived key, and the client then sends the bytes straight to storage
 *   with a short-lived, single-purpose credential. The attachment row is only
 *   confirmed once the object is actually there.
 *
 *   This is what keeps a 25 MB upload from occupying a request handler, and what
 *   keeps an unconfirmed upload from appearing in a thread as though it had
 *   succeeded.
 *
 * WHAT IS NOT HERE
 *   No S3/R2 adapter. `STORAGE_ENDPOINT` and friends are unset and no bucket has
 *   been provisioned (blocking input `M-09`), so writing one would mean inventing
 *   a configuration nobody has agreed. The development adapter below is a real,
 *   working implementation against the local filesystem — enough to exercise the
 *   whole flow end to end — and the production path fails loudly rather than
 *   silently accepting files it cannot store.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** How long an upload or download authorisation stays valid. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export interface UploadTicket {
  /** Where the client sends the bytes. */
  readonly url: string;
  readonly method: 'PUT' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface StoredObject {
  readonly sizeBytes: number;
  readonly checksum: string;
}

export interface StorageProvider {
  readonly name: string;
  /** Authorise an upload to a server-derived key. */
  createUploadTicket(key: string, mimeType: string): Promise<UploadTicket>;
  /** Authorise a time-limited read. */
  createDownloadUrl(key: string): Promise<{ readonly url: string; readonly expiresAt: Date }>;
  /** What is actually stored at the key, or null when nothing is. */
  head(key: string): Promise<StoredObject | null>;
  /** Remove an object. Used only for uploads that were never confirmed. */
  remove(key: string): Promise<void>;
}

/**
 * Development adapter: the local filesystem, under `.storage/`.
 *
 * Real enough to test against — it stores bytes, reports their true size, and
 * computes a real checksum — without needing a bucket or a credential. It is
 * never used in production: `storageProvider()` refuses to return it there.
 */
export class LocalFilesystemStorage implements StorageProvider {
  readonly name = 'local-filesystem';

  private readonly root: string;

  constructor(root = process.env.STORAGE_LOCAL_ROOT ?? '.storage') {
    this.root = resolve(root);
  }

  /**
   * Resolve a key to a path *inside* the root, refusing anything that escapes.
   *
   * Keys are server-derived, so this should be unreachable. It is here because
   * "should be unreachable" is not a property the filesystem enforces.
   */
  private pathFor(key: string): string {
    const full = resolve(join(this.root, key));
    if (full !== this.root && !full.startsWith(this.root + '/')) {
      throw new Error('Storage key escapes the storage root.');
    }
    return full;
  }

  async createUploadTicket(key: string, mimeType: string): Promise<UploadTicket> {
    await mkdir(dirname(this.pathFor(key)), { recursive: true });
    return {
      // Handled by the development content route; no external service is involved.
      url: `/api/attachments/content?key=${encodeURIComponent(key)}`,
      method: 'PUT',
      headers: { 'content-type': mimeType },
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
    };
  }

  async createDownloadUrl(key: string): Promise<{ url: string; expiresAt: Date }> {
    return {
      url: `/api/attachments/content?key=${encodeURIComponent(key)}`,
      expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    };
  }

  async head(key: string): Promise<StoredObject | null> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
      const bytes = await readFile(path);
      return { sizeBytes: info.size, checksum: createHash('sha256').update(bytes).digest('hex') };
    } catch {
      return null;
    }
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  /**
   * The stored bytes as a standalone `ArrayBuffer`.
   *
   * Copied out of Node's pooled Buffer rather than returned as a view of it:
   * a view shares the pool's backing store, which is not something to hand to a
   * response body.
   */
  async get(key: string): Promise<ArrayBuffer | null> {
    try {
      const buffer = await readFile(this.pathFor(key));
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      // Removing something that is not there is the desired end state.
    }
  }
}

/**
 * A provider is configured but no adapter for it exists yet.
 *
 * Thrown rather than silently falling back to the local filesystem: quietly
 * writing a customer's deliverable to a container's disk, when an operator
 * believes it is going to object storage, is the worse failure.
 */
export class StorageNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageNotConfiguredError';
  }
}

function isRemoteConfigured(): boolean {
  return Boolean(process.env.STORAGE_ENDPOINT && process.env.STORAGE_BUCKET && process.env.STORAGE_ACCESS_KEY);
}

let cached: StorageProvider | null = null;

/** The provider for this environment. */
export function storageProvider(): StorageProvider {
  if (cached) return cached;

  if (isRemoteConfigured()) {
    throw new StorageNotConfiguredError(
      'Object storage is configured but its adapter is not implemented yet (blocking input M-09). ' +
        'Unset STORAGE_ENDPOINT to use the development filesystem adapter.',
    );
  }

  if (process.env.NODE_ENV === 'production') {
    throw new StorageNotConfiguredError(
      'No object storage is configured. Set STORAGE_ENDPOINT, STORAGE_BUCKET and STORAGE_ACCESS_KEY. ' +
        'The development filesystem adapter is never used in production.',
    );
  }

  cached = new LocalFilesystemStorage();
  return cached;
}

/** Test seam. Replaces the provider for the current process. */
export function setStorageProvider(provider: StorageProvider | null): void {
  cached = provider;
}

/** A server-generated unique component for a storage key. */
export function newObjectId(): string {
  return randomUUID();
}
