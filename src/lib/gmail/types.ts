/** Gmail integration types */

export type GmailAccountStatus = "connected" | "needs_reauth" | "disconnected" | "error";

export interface GmailOAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // unix timestamp in ms
  scope: string;
  token_type: "Bearer";
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailMessageList {
  messages?: Array<{
    id: string;
    threadId: string;
  }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string; // milliseconds since epoch
  payload: {
    partId?: string;
    mimeType: string;
    filename?: string;
    headers: Array<{ name: string; value: string }>;
    body?: {
      attachmentId?: string;
      size: number;
      data?: string; // base64url encoded
    };
    parts?: Array<GmailMessagePart>;
  };
  sizeEstimate: number;
  raw?: string; // base64url encoded raw message
}

export interface GmailMessagePart {
  partId: string;
  mimeType: string;
  filename?: string;
  headers: Array<{ name: string; value: string }>;
  body?: {
    attachmentId?: string;
    size: number;
    data?: string;
  };
  parts?: GmailMessagePart[];
}

export interface GmailHistory {
  id: string;
  messages?: Array<{
    id: string;
    threadId: string;
    labelIds: string[];
  }>;
  messagesAdded?: Array<{
    message: GmailMessage;
  }>;
  messagesDeleted?: Array<{
    message: { id: string; threadId: string };
  }>;
  labelsAdded?: Array<{
    message: { id: string; threadId: string; labelIds: string[] };
  }>;
  labelsRemoved?: Array<{
    message: { id: string; threadId: string; labelIds: string[] };
  }>;
}

export interface GmailHistoryList {
  history?: GmailHistory[];
  nextPageToken?: string;
  historyId: string;
}

export interface GmailSendRequest {
  raw: string; // base64url encoded RFC 2822 message
  threadId?: string;
}

export interface GmailSendResponse {
  id: string;
  threadId: string;
  labelIds: string[];
}

/** parsed email address with optional name */
export interface EmailAddress {
  email: string;
  name?: string;
}

/** normalized email message for our internal use */
export interface NormalizedEmailMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  gmailHistoryId: string;
  subject: string | null;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  internalDate: string; // ISO string
  direction: "inbound" | "outbound";
  isRead: boolean;
  isStarred: boolean;
  labelIds: string[];
  labelNames: string[];
}

/** result of matching a Gmail message to a lead */
export interface GmailLeadMatch {
  leadId: string | null;
  matchedBy: "email" | "thread" | "manual" | "none";
  confidence: number;
}

/** result of sending an email */
export interface GmailSendResult {
  messageId: string;
  threadId: string;
  labelIds: string[];
}

/** Gmail API error response */
export interface GmailApiError {
  error: {
    code: number;
    message: string;
    errors?: Array<{
      domain: string;
      reason: string;
      message: string;
    }>;
  };
}

/** Gmail watch request for push notifications */
export interface GmailWatchRequest {
  labelIds?: string[];
  labelFilterAction?: "include" | "exclude";
  topicName: string;
}

/** Gmail watch response */
export interface GmailWatchResponse {
  historyId: string;
  expiration: string; // timestamp in ms
}