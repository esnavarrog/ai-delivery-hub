import type { OutputLanguage } from '@ai-delivery-hub/policies';

const LANGUAGE_NAMES: Record<OutputLanguage, string> = { es: 'Spanish', en: 'English' };

/**
 * Instruction appended to every agent system prompt (triage + planning, both credential modes):
 * free-text values follow `repos.yaml` -> `output.language`; JSON keys, enum values, file paths,
 * commands and code are never translated.
 */
export function buildOutputLanguageInstruction(language: OutputLanguage): string {
  const name = LANGUAGE_NAMES[language];
  return [
    '# Output language',
    `Write every free-text value you produce (summary, rationale, risk signal descriptions, plan section prose such as goal/steps/risks/rollback/acceptanceCriteria/openQuestions, and any other prose) in ${name}.`,
    'JSON keys, enum values, file paths, commands and code must stay exactly as the schema and repository require — never translate or alter them.',
  ].join('\n');
}
