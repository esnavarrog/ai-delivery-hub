import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, resolveAiCredentialsMode, shouldWarnOnSubscriptionFallback } from '../../src/config.js';

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
    expect(config.CLAUDE_CODE_PATH).toBeUndefined();
  });

  it('accepts the worktree dir and claude binary path overrides', () => {
    const config = loadConfig({ ...valid, WORKTREES_DIR: '/var/hub/worktrees', CLAUDE_CODE_PATH: '/usr/local/bin/claude' });
    expect(config.WORKTREES_DIR).toBe('/var/hub/worktrees');
    expect(config.CLAUDE_CODE_PATH).toBe('/usr/local/bin/claude');
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

describe('loadConfig: production credentials guard', () => {
  it('fails when NODE_ENV=production and auto resolves to subscription (no key)', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production', ANTHROPIC_API_KEY: '' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production', ANTHROPIC_API_KEY: '' })).toThrow(/production/i);
  });

  it('fails when NODE_ENV=production and AI_CREDENTIALS=subscription is explicit, even with a key set', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production', AI_CREDENTIALS: 'subscription', ANTHROPIC_API_KEY: 'sk-test' })).toThrow(ConfigError);
  });

  it('succeeds when NODE_ENV=production and auto resolves to api-key', () => {
    const config = loadConfig({ ...valid, NODE_ENV: 'production', ANTHROPIC_API_KEY: 'sk-test' });
    expect(config.aiCredentialsMode).toBe('api-key');
  });

  it('succeeds when NODE_ENV=production and AI_CREDENTIALS=api-key with a key', () => {
    const config = loadConfig({ ...valid, NODE_ENV: 'production', AI_CREDENTIALS: 'api-key', ANTHROPIC_API_KEY: 'sk-test' });
    expect(config.aiCredentialsMode).toBe('api-key');
  });
});

describe('shouldWarnOnSubscriptionFallback', () => {
  it('is true outside production when auto resolved to subscription', () => {
    expect(shouldWarnOnSubscriptionFallback({ NODE_ENV: 'development', AI_CREDENTIALS: 'auto', aiCredentialsMode: 'subscription' })).toBe(true);
    expect(shouldWarnOnSubscriptionFallback({ NODE_ENV: 'test', AI_CREDENTIALS: 'auto', aiCredentialsMode: 'subscription' })).toBe(true);
  });

  it('is false when the mode was chosen explicitly, resolved to api-key, or NODE_ENV is production', () => {
    expect(shouldWarnOnSubscriptionFallback({ NODE_ENV: 'development', AI_CREDENTIALS: 'subscription', aiCredentialsMode: 'subscription' })).toBe(false);
    expect(shouldWarnOnSubscriptionFallback({ NODE_ENV: 'development', AI_CREDENTIALS: 'auto', aiCredentialsMode: 'api-key' })).toBe(false);
    expect(shouldWarnOnSubscriptionFallback({ NODE_ENV: 'production', AI_CREDENTIALS: 'auto', aiCredentialsMode: 'subscription' })).toBe(false);
  });
});
