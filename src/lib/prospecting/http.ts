/** one http path shared by every provider, so errors look the same everywhere. */
import { ProviderError } from "./types";

const DEFAULT_TIMEOUT_MS = 20_000;

export interface RequestOptions {
  method?: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** 429 and 5xx are worth one quiet retry. */
  retries?: number;
  providerLabel: string;
}

/** apollo and pdl both use a flat {error, error_code, message} shape for failures. */
interface ApiErrorBody {
  error?: string;
  error_code?: string;
  message?: string;
  error_details?: { code?: string; message?: string };
  // apollo returns partial results alongside an error, and we still want to show them
  organization?: unknown;
}

export async function apiFetch<T>(options: RequestOptions): Promise<T> {
  const retries = options.retries ?? 1;
  let attempt = 0;

  for (;;) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(options.url, {
        method: options.method ?? "GET",
        headers: {
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...options.headers,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
        cache: "no-store",
      });

      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      if (!response.ok) {
        const body = (parsed ?? {}) as ApiErrorBody;
        const error = normaliseHttpError(options.providerLabel, response, body);

        // one silent retry for the things that usually clear on their own
        if (error.retryable && attempt < retries) {
          attempt++;
          const wait = error.retryAfterSeconds ? Math.min(error.retryAfterSeconds, 10) : 2 ** attempt * 500;
          await sleep(wait);
          continue;
        }
        throw error;
      }

      // a 200 that still carries an error body is still a failure
      if (parsed && typeof parsed === "object") {
        const body = parsed as ApiErrorBody;
        if (body.error_code && !body.organization && !(parsed as Record<string, unknown>).people && !(parsed as Record<string, unknown>).data) {
          throw normaliseHttpError(options.providerLabel, response, body);
        }
      }

      return parsed as T;
    } catch (error) {
      if (error instanceof ProviderError) throw error;

      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderError({
          code: "timeout",
          message: `${options.providerLabel} took too long to answer. try again in a moment.`,
          retryable: true,
        });
      }

      const message = error instanceof Error ? error.message : String(error);
      if (attempt < retries) {
        attempt++;
        await sleep(2 ** attempt * 500);
        continue;
      }
      throw new ProviderError({
        code: "network",
        message: `could not reach ${options.providerLabel}. check the connection and try again.`,
        detail: message,
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normaliseHttpError(label: string, response: Response, body: ApiErrorBody): ProviderError {
  const status = response.status;
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) || null : null;
  const detail = body.error_details?.message ?? body.message ?? body.error ?? null;
  const code = body.error_details?.code ?? body.error_code ?? null;

  if (status === 401) {
    return new ProviderError({
      code: "unauthorized",
      message: `${label} did not accept that api key. check you copied the whole thing.`,
      status,
      detail,
    });
  }
  if (status === 403) {
    const planBlocked = /plan|upgrade|trial|permission|feature/i.test(`${code ?? ""} ${detail ?? ""}`);
    return new ProviderError({
      code: planBlocked ? "plan_blocked" : "forbidden",
      message: planBlocked
        ? `${label} says this plan does not have access to that. you may need a paid plan.`
        : `${label} refused the request. the key is valid but not allowed to do this.`,
      status,
      detail,
    });
  }
  if (status === 402) {
    return new ProviderError({
      code: "out_of_credits",
      message: `${label} has run out of credits. top up the account, then try again.`,
      status,
      detail,
    });
  }
  if (status === 429) {
    return new ProviderError({
      code: "rate_limited",
      message: `${label} is rate limiting us. wait a moment and try again.`,
      status,
      detail,
      retryable: true,
      retryAfterSeconds,
    });
  }
  if (status === 400) {
    return new ProviderError({
      code: "bad_request",
      message: `${label} rejected the search. check the filters, particularly the industry names and the size range.`,
      status,
      detail,
    });
  }
  if (status === 422) {
    return new ProviderError({
      code: "unprocessable",
      message: `${label} could not make sense of one of the filters. industries must match their list exactly.`,
      status,
      detail,
    });
  }
  if (status >= 500) {
    return new ProviderError({
      code: "server_error",
      message: `${label} had a problem on their side. this is usually temporary.`,
      status,
      detail,
      retryable: true,
      retryAfterSeconds,
    });
  }
  return new ProviderError({
    code: "unknown",
    message: `${label} returned an unexpected response.`,
    status,
    detail,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** builds a query string where repeated keys become arrays: a[]=1&a[]=2 */
export function withArrayParams(base: string, params: Record<string, string | string[] | number | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== "" && item !== undefined && item !== null) url.searchParams.append(`${key}[]`, item);
      }
    } else if (value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}