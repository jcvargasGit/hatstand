import type { ClientPhoto } from '../shared/schemas';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const DRIVE_THUMBNAIL_WIDTH = 256;
const COPY_IMAGE_ADDRESS =
  'Open the photo, right-click it and choose "Copy image address", then paste that link.';

export type PhotoType = ClientPhoto['type'];

function parseHttpsLink(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`That is not a web link. ${COPY_IMAGE_ADDRESS}`);
  }
  if (url.protocol !== 'https:') throw new Error('Use a link that starts with https://.');
  return url;
}

function driveFileId(url: URL): string | null {
  return /^\/file\/d\/([^/]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get('id');
}

export function normalizePhotoLink(raw: string): string {
  const url = parseHttpsLink(raw);
  const host = url.hostname.replace(/^www\./, '');

  if (/^google\.[a-z.]+$/.test(host) && /^\/(imgres|url|search)\/?$/.test(url.pathname)) {
    const target = url.searchParams.get('imgurl') ?? url.searchParams.get('url');
    if (target) return normalizePhotoLink(target);
    throw new Error(`That link opens a Google page, not the photo. ${COPY_IMAGE_ADDRESS}`);
  }
  if (host === 'drive.google.com') {
    const id = driveFileId(url);
    if (!id) throw new Error('That Google Drive link does not point to one file. Share the photo itself.');
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${DRIVE_THUMBNAIL_WIDTH}`;
  }
  if (host === 'photos.google.com' || host === 'photos.app.goo.gl') {
    throw new Error(`Google Photos links open a page, not the photo. ${COPY_IMAGE_ADDRESS}`);
  }
  return url.toString();
}

export function detectImageType(bytes: Uint8Array): PhotoType | null {
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  const isRiff = startsWith(0x52, 0x49, 0x46, 0x46);
  const isWebp = String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return isRiff && isWebp ? 'image/webp' : null;
}

export type DownloadedPhoto = { bytes: Buffer; type: PhotoType };

export async function downloadPhoto(link: string, fetcher: typeof fetch = fetch): Promise<DownloadedPhoto> {
  const url = normalizePhotoLink(link);
  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch {
    throw new Error('Could not reach that link. Check your connection and the address.');
  }
  if (!response.ok) {
    throw new Error(`That link answered ${response.status}. Make sure the photo is public.`);
  }
  if (Number(response.headers.get('content-length') ?? 0) > MAX_PHOTO_BYTES) {
    throw new Error('That photo is larger than 5 MB. Choose a smaller one.');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error('That photo is larger than 5 MB. Choose a smaller one.');
  const type = detectImageType(bytes);
  if (!type) throw new Error(`That link does not open a PNG, JPEG, WebP or GIF image. ${COPY_IMAGE_ADDRESS}`);
  return { bytes, type };
}
