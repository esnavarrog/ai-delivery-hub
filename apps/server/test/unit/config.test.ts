import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, resolveAiCredentialsMode } from '../../src/config.js';

const valid = {
  DATABASE_URL: 'postgres://hub:hub@localhost:5433/hub',
  OP_BASE_URL: 'https://op.example.com',
  OP_API_KEY: 'k',
  OP_WEBHOOK_SECRET: 'a-very-long-webhook-secret',
};

describe('loadConfig', () => {
  it('applies defaults for optional values', () => {
    const config = loadConfig({ ...valid, POLICIES_DIR: '', PORT: '' });
    expect(config.PORT).toBe(3000);
    expect(config.POLL_INTERVAL_MS).toBe(120_000);
    expect(config.POLICIES_DIR).toMatch(/packages\/policies\/$/);
    expect(config.NODE_ENV).toBe('development');
    expect(config.WORKTREES_DIR).toMatch(/ai-delivery-hub\/\.worktrees$/);
    expect(config.HUB_PUBLIC_URL).toBe('http://localhost:5173');
    expect(config.CLAUDE_CODE_PATH).toBeUndefined();
  });

  it('accepts the worktree dir, public url and claude binary path overrides and rejects a bad url', () => {
    const config = loadConfig({ ...valid, WORKTREES_DIR: '/var/hub/worktrees', HUB_PUBLIC_URL: 'https://hub.example.com/', CLAUDE_CODE_PATH: '/usr/local/bin/claude' });
    expect(config.WORKTREES_DIR).toBe('/var/hub/worktrees');
    expect(config.HUB_PUBLIC_URL).toBe('https://hub.example.com');
    expect(config.CLAUDE_CODE_PATH).toBe('/usr/local/bin/claude');
    expect(() => loadConfig({ ...valid, HUB_PUBLIC_URL: 'not a url' })).toThrow(ConfigError);
  });

  it('coerces numbers and rejects missing secrets or a non-postgres URL', () => {
    expect(loadConfig({ ...valid, PORT: '8080', POLL_INTERVAL_MS: '60000' })).toMatchObject({ PORT: 8080, POLL_INTERVAL_MS: 60_000 });
    expect(() => loadConfig({ ...valid, OP_API_KEY: undefined })).toThrow(ConfigError);
    expect(() => loadConfig({ ...valid, DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
    expect(() => loadConfig({ ...valid, OP_WEBHOOK_SECRET: 'short' })).toThrow(/16/);
  });
});

describe('resolveAiCredentialsMode', () => {
  it('auto resolves to api-key when a non-empty key is present, else subscription', () => {
    expect(resolveAiCredentialsMode('auto', 'sk-test')).toBe('api-key');
    expect(resolveAiCredentialsMode('auto', undefined)).toBe('subscription');
    expect(resolveAiCredentialsMode('auto', '')).toBe('subscription');
  });

  it('an explicit mode is returned as-is regardless of the key', () => {
    expect(resolveAiCredentialsMode('subscription', 'sk-test')).toBe('subscription');
    expect(resolveAiCredentialsMode('subscription', undefined)).toBe('subscription');
    expect(resolveAiCredentialsMode('api-key', undefined)).toBe('api-key');
    expect(resolveAiCredentialsMode('api-key', 'sk-test')).toBe('api-key');
  });
});

describe('loadConfig: AI_CREDENTIALS', () => {
  it('defaults to auto and resolves to subscription when no ANTHROPIC_API_KEY is set', () => {
    const config = loadConfig({ ...valid, ANTHROPIC_API_KEY: '' });
    expect(config.AI_CREDENTIALS).toBe('auto');
    expect(config.aiCredentialsMode).toBe('subscription');
  });

  it('resolves auto to api-key when ANTHROPIC_API_KEY is set', () => {
    const config = loadConfig({ ...valid, ANTHROPIC_API_KEY: 'sk-test' });
    expect(config.aiCredentialsMode).toBe('api-key');
  });

  it('keeps subscription mode even when a key is present', () => {
    const config = loadConfig({ ...valid, AI_CREDENTIALS: 'subscription', ANTHROPIC_API_KEY: 'sk-test' });
    expect(config.aiCredentialsMode).toBe('subscription');
  });

  it('accepts api-key mode with a key set', () => {
    const config = loadConfig({ ...valid, AI_CREDENTIALS: 'api-key', ANTHROPIC_API_KEY: 'sk-test' });
    expect(config.aiCredentialsMode).toBe('api-key');
  });

  it('fails startup with a clear message when api-key mode has no key', () => {
    expect(() => loadConfig({ ...valid, AI_CREDENTIALS: 'api-key', ANTHROPIC_API_KEY: '' })).toThrow(/AI_CREDENTIALS=api-key.*ANTHROPIC_API_KEY/s);
    expect(() => loadConfig({ ...valid, AI_CREDENTIALS: 'api-key' })).toThrow(ConfigError);
  });

  it('rejects an unknown AI_CREDENTIALS value', () => {
    expect(() => loadConfig({ ...valid, AI_CREDENTIALS: 'yolo' })).toThrow(ConfigError);
  });
});
