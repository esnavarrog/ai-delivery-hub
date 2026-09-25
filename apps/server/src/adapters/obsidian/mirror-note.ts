import { stringify as stringifyYaml } from 'yaml';
import { parseNote } from './note.js';

/** Separates the hub-owned frontmatter from the user's own notes; everything below is never touched by the hub. */
export const MIRROR_MARKER = '<!-- hub:notas — todo lo que sigue es tuyo -->';

/** Old English marker, kept only so notes written before the Spanish switch still parse correctly. */
const LEGACY_MIRROR_MARKER = '<!-- hub:notes — everything below is yours -->';

export interface MirrorFrontmatter {
  key: string;
  source: 'openproject' | 'manual';
  title: string;
  state: string;
  riskTier?: string | undefined;
  targetRepo?: string | undefined;
  updatedAt: string;
  hubUrl: string;
}

/** Renders a hub-owned mirror note: YAML frontmatter, the marker, then the caller-preserved user body verbatim. */
export function renderMirrorNote(frontmatter: MirrorFrontmatter, userBody: string): string {
  const fm: Record<string, unknown> = {
    key: frontmatter.key,
    source: frontmatter.source,
    title: frontmatter.title,
    state: frontmatter.state,
    updatedAt: frontmatter.updatedAt,
    hubUrl: frontmatter.hubUrl,
  };
  if (frontmatter.riskTier !== undefined) fm.riskTier = frontmatter.riskTier;
  if (frontmatter.targetRepo !== undefined) fm.targetRepo = frontmatter.targetRepo;
  const yamlBlock = stringifyYaml(fm).trimEnd();
  return `---\n${yamlBlock}\n---\n\n${MIRROR_MARKER}\n${userBody}`;
}

/**
 * Extracts the content the hub must never overwrite from an existing file's raw text:
 * - already a mirror note (has the marker) → everything after the marker, byte-for-byte;
 * - a raw note with its own frontmatter (a just-moved Obsidian inbox note, not yet a mirror) →
 *   its body, so the original note text survives the first mirror write;
 * - no file yet (`undefined`) → empty, a fresh mirror starts with nothing below the marker.
 */
export function extractUserContent(existing: string | undefined): string {
  if (existing === undefined) return '';
  for (const marker of [MIRROR_MARKER, LEGACY_MIRROR_MARKER]) {
    const markerIndex = existing.indexOf(marker);
    if (markerIndex !== -1) return existing.slice(markerIndex + marker.length).replace(/^\r?\n/, '');
  }
  return parseNote(existing).body;
}
