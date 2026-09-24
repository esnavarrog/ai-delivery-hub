import { TicketPriority } from '@ai-delivery-hub/domain';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** Frontmatter accepted on a `hub/inbox/*.md` note; every field but `title` is optional. */
export const InboxFrontmatter = z.object({
  title: z.string().trim().min(1, 'title is required'),
  /** Free-text hint for triage; folded into the untrusted description, never trusted directly. */
  repo: z.string().trim().min(1).optional(),
  priority: TicketPriority.optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
});
export type InboxFrontmatter = z.infer<typeof InboxFrontmatter>;

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/;

/**
 * Splits `---\n<yaml>\n---\n<body>` frontmatter from a note. A note with no frontmatter block
 * parses as an empty frontmatter object and the whole file as body (caught downstream as an
 * invalid note, since `title` is required).
 */
export function parseNote(raw: string): ParsedNote {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { frontmatter: {}, body: raw };
  const [, yamlBlock, body] = match;
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlBlock ?? '') ?? {};
  } catch (err) {
    throw new Error(`frontmatter is not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('frontmatter must be a YAML mapping');
  }
  return { frontmatter: parsed as Record<string, unknown>, body: (body ?? '').replace(/^\r?\n/, '') };
}
