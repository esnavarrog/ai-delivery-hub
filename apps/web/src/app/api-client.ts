import { ErrorResponse, type ErrorCode } from '@ai-delivery-hub/contracts';
import { getCurrentLogin } from './current-user';

export const HUB_USER_HEADER = 'X-Hub-User';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

/** Thin fetch wrapper: adds `X-Hub-User`, JSON bodies, and turns the server error envelope into `ApiError`. */
/** Same-origin absolute base so the client also works where relative URLs are not resolved (tests). */
const DEFAULT_BASE_URL = typeof globalThis.location !== 'undefined' ? globalThis.location.origin : '';

export function createApiClient(fetchImpl: typeof fetch = (...args) => fetch(...args), baseUrl = DEFAULT_BASE_URL): ApiClient {
  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', [HUB_USER_HEADER]: getCurrentLogin() };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch (err) {
      throw new ApiError(0, 'network', err instanceof Error ? err.message : 'network error');
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      let code: ErrorCode = 'internal';
      try {
        const parsed = ErrorResponse.safeParse(await res.json());
        if (parsed.success) {
          message = parsed.data.error.message;
          code = parsed.data.error.code;
        }
      } catch {
        // non-JSON error body
      }
      throw new ApiError(res.status, code, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
  };
}

export const api: ApiClient = createApiClient();
