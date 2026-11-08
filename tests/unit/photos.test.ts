import { mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { dataPaths } from '../../src/main/paths';
import { detectImageType, downloadPhoto, normalizePhotoLink } from '../../src/main/photos';
import { Store } from '../../src/main/store';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fakeFetch(body: BodyInit, init: ResponseInit = {}) {
  return vi.fn<typeof fetch>(async () => new Response(body, init));
}

describe('normalizePhotoLink', () => {
  it('keeps a direct image link', () => {
    expect(normalizePhotoLink(' https://acme.com/logo.png ')).toBe('https://acme.com/logo.png');
  });

  it('keeps an image hosted on Google itself', () => {
    const link = 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png';
    expect(normalizePhotoLink(link)).toBe(link);
    const thumbnail = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:abc';
    expect(normalizePhotoLink(thumbnail)).toBe(thumbnail);
  });

  it('finds the image inside a Google Images result', () => {
    const target = encodeURIComponent('https://acme.com/logo.png');
    expect(normalizePhotoLink(`https://www.google.com/imgres?imgurl=${target}&tbnid=abc`)).toBe(
      'https://acme.com/logo.png',
    );
    expect(normalizePhotoLink(`https://www.google.co.uk/url?sa=i&url=${target}`)).toBe('https://acme.com/logo.png');
  });

  it.each(['https://drive.google.com/file/d/AbC123/view?usp=sharing', 'https://drive.google.com/open?id=AbC123'])(
    'turns the Google Drive link %s into an image link',
    (link) => {
      expect(normalizePhotoLink(link)).toBe('https://drive.google.com/thumbnail?id=AbC123&sz=w256');
    },
  );

  it.each([
    'https://www.google.com/search?q=acme&tbm=isch',
    'https://photos.google.com/share/abc',
    'https://photos.app.goo.gl/abc',
  ])('explains how to get the image from %s', (link) => {
    expect(() => normalizePhotoLink(link)).toThrow(/Copy image address/);
  });

  it('rejects anything that is not https', () => {
    expect(() => normalizePhotoLink('http://acme.com/logo.png')).toThrow(/https/);
    expect(() => normalizePhotoLink('file:///etc/passwd')).toThrow(/https/);
    expect(() => normalizePhotoLink('javascript:alert(1)')).toThrow(/https/);
    expect(() => normalizePhotoLink('logo')).toThrow(/not a web link/);
    const nested = encodeURIComponent('http://acme.com/logo.png');
    expect(() => normalizePhotoLink(`https://www.google.com/imgres?imgurl=${nested}`)).toThrow(/https/);
  });
});

describe('detectImageType', () => {
  it('reads the type from the content, not from the name', () => {
    expect(detectImageType(PNG)).toBe('image/png');
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectImageType(Buffer.from('GIF89a'))).toBe('image/gif');
    expect(detectImageType(Buffer.from('RIFF0000WEBPVP8 '))).toBe('image/webp');
  });

  it('rejects pages and SVG files, which can contain scripts', () => {
    expect(detectImageType(Buffer.from('<!doctype html><html>'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(detectImageType(Buffer.from('RIFF0000WAVEfmt '))).toBeNull();
  });
});

describe('downloadPhoto', () => {
  it('returns the image and its detected type', async () => {
    const photo = await downloadPhoto('https://acme.com/logo', fakeFetch(PNG));
    expect(photo.type).toBe('image/png');
    expect(photo.bytes.equals(PNG)).toBe(true);
  });

  it('explains a page returned instead of an image', async () => {
    await expect(downloadPhoto('https://acme.com/', fakeFetch('<html></html>'))).rejects.toThrow(/does not open/);
  });

  it('explains a private photo', async () => {
    await expect(downloadPhoto('https://acme.com/x.png', fakeFetch('', { status: 403 }))).rejects.toThrow(/403/);
  });

  it('refuses a file over the limit, with or without a declared size', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    await expect(downloadPhoto('https://acme.com/x.png', fakeFetch(big))).rejects.toThrow(/5 MB/);
    const declared = fakeFetch(PNG, { headers: { 'content-length': String(big.length) } });
    await expect(downloadPhoto('https://acme.com/x.png', declared)).rejects.toThrow(/5 MB/);
  });

  it('explains an unreachable link', async () => {
    const failing = vi.fn<typeof fetch>(async () => {
      throw new TypeError('network');
    });
    await expect(downloadPhoto('https://acme.com/x.png', failing)).rejects.toThrow(/Could not reach/);
  });
});

describe('Store photos', () => {
  it('keeps the photo privately with the client, and removes it', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'hatstand-photo-')));
    try {
      const paths = dataPaths(home);
      const store = new Store(paths);
      const { id } = store.createCompany('Acme', '#112233');
      expect(store.readCompanyPhoto(id)).toBeNull();

      store.saveCompanyPhoto(id, 'https://acme.com/logo.png', { bytes: PNG, type: 'image/png' });
      expect(store.readCompany(id).photo?.sourceUrl).toBe('https://acme.com/logo.png');
      expect(store.readCompanyPhoto(id)).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
      expect(statSync(paths.photoFile(id)).mode & 0o777).toBe(0o600);

      store.removeCompanyPhoto(id);
      expect(store.readCompany(id).photo).toBeUndefined();
      expect(store.readCompanyPhoto(id)).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
