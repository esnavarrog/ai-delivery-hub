import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyOpSignature } from '../../src/modules/ingest/webhook.js';

const secret = 'top-secret';
const body = JSON.stringify({ action: 'work_package:updated', work_package: { id: 4711 } });

describe('verifyOpSignature', () => {
  it('accepts a valid sha1 signature (OpenProject default)', () => {
    const sig = createHmac('sha1', secret).update(body).digest('hex');
    expect(verifyOpSignature(body, `sha1=${sig}`, secret)).toBe(true);
  });

  it('accepts a valid sha256 signature too', () => {
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyOpSignature(body, `sha256=${sig}`, secret)).toBe(true);
  });

  it('rejects a tampered body, a wrong secret, an unknown algorithm and a missing header', () => {
    const sig = createHmac('sha1', secret).update(body).digest('hex');
    expect(verifyOpSignature(body + ' ', `sha1=${sig}`, secret)).toBe(false);
    expect(verifyOpSignature(body, `sha1=${sig}`, 'other')).toBe(false);
    expect(verifyOpSignature(body, `md5=${sig}`, secret)).toBe(false);
    expect(verifyOpSignature(body, `sha1=abc`, secret)).toBe(false);
    expect(verifyOpSignature(body, undefined, secret)).toBe(false);
    expect(verifyOpSignature(body, '', secret)).toBe(false);
  });
});
