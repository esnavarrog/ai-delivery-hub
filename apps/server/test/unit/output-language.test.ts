import { describe, expect, it } from 'vitest';
import { buildOutputLanguageInstruction } from '../../src/adapters/agent/output-language.js';

describe('buildOutputLanguageInstruction', () => {
  it('instructs the agent to write free text in Spanish, keeping JSON keys/enums/paths/commands/code untouched', () => {
    const text = buildOutputLanguageInstruction('es');
    expect(text).toMatch(/Spanish/);
    expect(text).toMatch(/JSON keys/i);
    expect(text).toMatch(/enum values/i);
    expect(text).toMatch(/file paths/i);
    expect(text).toMatch(/commands/i);
    expect(text).toMatch(/code/i);
    expect(text).toMatch(/never translate/i);
  });

  it('instructs the agent to write free text in English for the en setting', () => {
    expect(buildOutputLanguageInstruction('en')).toMatch(/English/);
  });
});
