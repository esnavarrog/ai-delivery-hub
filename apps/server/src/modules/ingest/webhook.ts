import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WorkPackage } from '@ai-delivery-hub/domain';
import { Hono } from 'hono';
import { z } from 'zod';
import type { IngestWorkPackage } from './ingest-work-package.js';

export const OP_SIGNATURE_HEADER = 'X-OP-Signature';

const SUPPORTED_ALGORITHMS = new Set(['sha1', 'sha256']);

/**
 * Verifies OpenProject's webhook signature header (`sha1=<hex hmac>` by default; `sha256=` accepted).
 * Constant-time comparison; any malformed input is a rejection.
 */
export function verifyOpSignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const [algorithm, provided, ...rest] = header.split('=');
  if (!algorithm || !provided || rest.length > 0 || !SUPPORTED_ALGORITHMS.has(algorithm)) return false;
  const expected = createHmac(algorithm, secret).update(rawBody).digest('hex');
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
}

const WebhookBody = z.object({
  action: z.string().optional(),
  work_package: z.object({ id: z.number().int().positive() }),
});

export interface WebhookDeps {
  secret: string;
  ingest: IngestWorkPackage;
  /** Only the read side is needed: the payload body is never trusted, the work package is re-fetched. */
  op: { getWorkPackage(id: number): Promise<WorkPackage> };
}

export function webhookRoutes(deps: WebhookDeps): Hono {
  const app = new Hono();
  app.post('/openproject', async (c) => {
    const raw = await c.req.text();
    if (!verifyOpSignature(raw, c.req.header(OP_SIGNATURE_HEADER), deps.secret)) {
      return c.json({ error: 'invalid signature' }, 401);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: 'body is not JSON' }, 400);
    }
    const body = WebhookBody.safeParse(parsed);
    if (!body.success) return c.json({ error: 'body has no work_package.id' }, 400);

    const wp = await deps.op.getWorkPackage(body.data.work_package.id);
    const outcome = await deps.ingest.execute(wp);
    return c.json({ outcome }, 202);
  });
  return app;
}
