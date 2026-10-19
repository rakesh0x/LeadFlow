/**
 * Gmail API client - handles all communication with Gmail API
 */
import { apiFetch, withArrayParams } from "../prospecting/http";
import { ProviderError, type Icp } from "../prospecting/types";
import type {
  GmailOAuthTokens,
  GmailProfile,
  GmailMessageList,
  GmailMessage,
  GmailHistoryList,
  GmailSendRequest,
  GmailSendResponse,
  GmailHistory,
  GmailWatchRequest,
  GmailWatchResponse,
  EmailAddress,
  NormalizedEmailMessage,
  GmailSendResult,
  GmailApiError,
  GmailMessage as GmailMessageType,
} from "./types";
import { isTokenExpired } from "./secrets";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.metadata",
];

export const GMAIL_INFO = {
  id: "gmail",
  label: "Gmail",
  kinds: ["email"] as const,
  providesEmailOnSearch: true,
  emailMethod: "emails come directly from Gmail via OAuth",
  signupUrl: "https://console.cloud.google.com/",
  docsUrl: "https://developers.google.com/gmail/api",
  keyUrl: "https://console.cloud.google.com/apis/credentials",
  sizeFilterLabel: "not applicable",
  planNotes: [
    "requires a Google Cloud project with Gmail API enabled",
    "OAuth consent screen must be configured",
    "scopes: read, send, modify, metadata",
    "free tier: generous daily limits",
  ],
};

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const captured: Captured[] = [];

/**
 * Makes a request to Gmail API with the given access token
 */
async function gmailFetch<T>(
  accessToken: string,
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    query?: Record<string, string | string[] | number | undefined>;
  } = {}
): Promise<T> {
  const query = new URLSearchParams();
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) query.append(key, String(v));
      } else {
        query.set(key, String(value));
      }
    }
  }

  const url = `${BASE}${path}${query.toString() ? `?${query.toString()}` : ""}`;

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const body = (parsed ?? {}) as { error?: { code?: number; message?: string; errors?: Array<{ reason: string; message: string }> } };
    const status = response.status;

    if (status === 401) {
      throw new ProviderError({
        code: "unauthorized",
        message: "Gmail access token expired or invalid. Please reconnect your account.",
        status,
        detail: body.error?.message ?? "invalid token",
      });
    }
    if (status === 403) {
      throw new ProviderError({
        code: "forbidden",
        message: "Gmail API access denied. Check OAuth scopes and permissions.",
        status,
        detail: body.error?.message ?? "access denied",
      });
    }
    if (status === 429) {
      throw new ProviderError({
        code: "rate_limited",
        message: "Gmail API rate limit exceeded. Please wait and try again.",
        status,
        detail: body.error?.message ?? "rate limited",
        retryable: true,
        retryAfterSeconds: 60,
      });
    }
    if (status >= 500) {
      throw new ProviderError({
        code: "server_error",
        message: "Gmail API server error. This is usually temporary.",
        status,
        detail: body.error?.message ?? "server error",
        retryable: true,
      });
    }
    throw new ProviderError({
      code: "unknown",
      message: `Gmail API error: ${body.error?.message ?? response.statusText}`,
      status,
      detail: body.error?.message ?? "unknown error",
    });
  }

  return parsed as T;
}

function buildUrl(path: string, query?: Record<string, string | string[] | number | undefined>): string {
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) params.append(key, String(v));
      } else {
        params.set(key, String(value));
      }
    }
  }
  const qs = params.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ""}`;
}

void buildUrl;

export const gmailProvider = {
  id: "gmail" as const,
  info: {
    id: "gmail",
    label: "Gmail",
    kinds: ["email"] as const,
    providesEmailOnSearch: true,
    emailMethod: "emails come directly from your Gmail inbox via OAuth",
    signupUrl: "https://console.cloud.google.com/",
    docsUrl: "https://developers.google.com/gmail/api",
    keyUrl: "https://console.cloud.google.com/apis/credentials",
    sizeFilterLabel: "not applicable",
    companiesNote: "Gmail is an email provider, not a prospect database. Use Apollo or PDL for finding new leads.",
    planNotes: [
      "requires a Google Cloud project with Gmail API enabled",
      "OAuth consent screen must be configured with gmail.readonly, gmail.send, gmail.modify, gmail.metadata scopes",
      "free tier: generous daily limits",
      "tokens are encrypted and stored securely",
    ],
  },

  isConfigured(secret: string | null) {
    return Boolean(secret && secret.trim().length >= 8);
  },

  async getProfile(secret: string) {
    return gmailFetch<GmailProfile>(secret, "/profile");
  },

  async listMessages(secret: string, options: {
    q?: string;
    labelIds?: string[];
    maxResults?: number;
    pageToken?: string;
    includeSpamTrash?: boolean;
  } = {}) {
    return gmailFetch<GmailMessageList>(secret, "/messages", {
      query: {
        q: options.q,
        labelIds: options.labelIds,
        maxResults: options.maxResults ?? 100,
        pageToken: options.pageToken,
        includeSpamTrash: options.includeSpamTrash === undefined ? undefined : String(options.includeSpamTrash),
      },
    });
  },

  async getMessage(secret: string, messageId: string, format: "full" | "metadata" | "minimal" = "full") {
    return gmailFetch<GmailMessage>(secret, `/messages/${messageId}`, {
      query: { format, metadataHeaders: ["Subject", "From", "To", "Cc", "Bcc", "Date", "Message-ID", "In-Reply-To", "References"] },
    });
  },

  async getThread(secret: string, threadId: string) {
    return gmailFetch<{ id: string; messages: GmailMessageType[] }>(secret, `/threads/${threadId}`, {
      query: { format: "full" },
    });
  },

  async getHistory(secret: string, options: {
    startHistoryId: string;
    labelId?: string;
    historyTypes?: string[];
    maxResults?: number;
    pageToken?: string;
  }) {
    return gmailFetch<GmailHistoryList>(secret, "/history", {
      query: {
        startHistoryId: options.startHistoryId,
        labelId: options.labelId,
        historyTypes: options.historyTypes,
        maxResults: options.maxResults,
        pageToken: options.pageToken,
      },
    });
  },

  async sendMessage(secret: string, request: GmailSendRequest) {
    return gmailFetch<GmailSendResponse>(secret, "/messages/send", {
      method: "POST",
      body: request,
    });
  },

  async modifyMessage(secret: string, messageId: string, body: { addLabelIds?: string[]; removeLabelIds?: string[] }) {
    return gmailFetch(secret, `/messages/${messageId}/modify`, {
      method: "POST",
      body,
    });
  },

  async trashMessage(secret: string, messageId: string) {
    return gmailFetch(secret, `/messages/${messageId}/trash`, {
      method: "POST",
    });
  },

  async watch(secret: string, request: { labelIds?: string[]; topicName: string }) {
    return gmailFetch(secret, "/watch", {
      method: "POST",
      body: request,
    });
  },

  async stopWatch(secret: string) {
    return gmailFetch(secret, "/stop", { method: "POST" });
  },

  async verify(secret: string) {
    const profile = await gmailProvider.getProfile(secret);
    return { ok: true as const, label: profile.emailAddress };
  },
};