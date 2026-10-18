/** the provider registry, plus resolving a workspace's saved credentials. */
import { db } from "../db/client";
import { nowIso } from "../db/time";
import { writeLog } from "../engine/events";
import { envKey, keyHint, open, seal } from "./secrets";
import { apolloProvider, APOLLO_INFO, APOLLO_SENIORITY, APOLLO_SIZE_RANGES } from "./providers/apollo";
import { pdlProvider, PDL_INFO } from "./providers/pdl";
import { ProviderError, type Provider, type ProviderId, type ProviderInfo } from "./types";

function newCredIdLocal(): string {
  return `cred_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
export const PROVIDERS: Record<ProviderId, Provider> = {
  apollo: apolloProvider,
  pdl: pdlProvider,
};

export const PROVIDER_LIST: Provider[] = [apolloProvider, pdlProvider];

export { APOLLO_INFO, APOLLO_SENIORITY, APOLLO_SIZE_RANGES, PDL_INFO };

export function getProvider(id: string): Provider {
  const provider = PROVIDERS[id as ProviderId];
  if (!provider) {
    throw new ProviderError({ code: "not_configured", message: `we do not know how to talk to "${id}"` });
  }
  return provider;
}

export interface CredentialStatus {
  provider: ProviderId;
  label: string;
  /** true when a usable key exists, whether from the environment or the database. */
  configured: boolean;
  /** where the key came from. environment keys are never written to the database. */
  source: "environment" | "database" | "none";
  hint: string | null;
  plan: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
}

export interface ResolvedCredential {
  secret: string;
  plan: string | null;
  status: CredentialStatus;
}

interface CredentialRow {
  provider: string;
  secret_ciphertext: string;
  secret_iv: string;
  secret_tag: string;
  key_hint: string | null;
  plan: string | null;
  is_active: number;
  last_verified_at: string | null;
  last_error: string | null;
}

/** reads the key, decrypting it only on the server. the result never leaves this process. */
export function resolveCredential(workspaceId: string, providerId: string): ResolvedCredential | null {
  const provider = getProvider(providerId);
  const info = provider.info;

  const fromEnv = envKey(provider.id);
  if (fromEnv && provider.isConfigured(fromEnv, null)) {
    return {
      secret: fromEnv,
      plan: null,
      status: {
        provider: provider.id,
        label: info.label,
        configured: true,
        source: "environment",
        hint: keyHint(fromEnv),
        plan: null,
        lastVerifiedAt: null,
        lastError: null,
      },
    };
  }

  const row = db()
    .prepare(`SELECT * FROM provider_credentials WHERE workspace_id = ? AND provider = ?`)
    .get(workspaceId, provider.id) as CredentialRow | undefined;

  if (!row || row.is_active !== 1) return null;

  let secret: string;
  try {
    secret = open({ ciphertext: row.secret_ciphertext, iv: row.secret_iv, tag: row.secret_tag });
  } catch {
    // the encryption key changed underneath us. say so rather than failing obscurely later.
    return {
      secret: "",
      plan: row.plan,
      status: {
        provider: provider.id,
        label: info.label,
        configured: false,
        source: "database",
        hint: row.key_hint,
        plan: row.plan,
        lastVerifiedAt: row.last_verified_at,
        lastError: "this key was saved with a different encryption key and cannot be read. paste it again.",
      },
    };
  }

  return {
    secret,
    plan: row.plan,
    status: {
      provider: provider.id,
      label: info.label,
      configured: provider.isConfigured(secret, row.plan),
      source: "database",
      hint: row.key_hint,
      plan: row.plan,
      lastVerifiedAt: row.last_verified_at,
      lastError: row.last_error,
    },
  };
}

export function saveCredential(
  workspaceId: string,
  providerId: string,
  secret: string,
  options: { plan?: string | null; label?: string | null; actorId?: string | null } = {},
): CredentialStatus {
  const provider = getProvider(providerId);
  const trimmed = secret.trim();
  if (!provider.isConfigured(trimmed, options.plan ?? null)) {
    throw new ProviderError({ code: "unauthorized", message: "that does not look like a complete api key" });
  }

  const sealed = seal(trimmed);
  const now = nowIso();
  const id = newCredIdLocal();

  db()
    .prepare(
      `INSERT INTO provider_credentials
         (id, workspace_id, provider, label, secret_ciphertext, secret_iv, secret_tag, key_hint, plan, is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, 1, ?, ?)
       ON CONFLICT (workspace_id, provider) DO UPDATE SET
         secret_ciphertext = excluded.secret_ciphertext,
         secret_iv = excluded.secret_iv,
         secret_tag = excluded.secret_tag,
         key_hint = excluded.key_hint,
         plan = excluded.plan,
         label = excluded.label,
         is_active = 1,
         last_error = NULL,
         updated_at = excluded.updated_at`,
    )
    .run(id, workspaceId, provider.id, options.label ?? provider.info.label, sealed.ciphertext, sealed.iv, sealed.tag, keyHint(trimmed), options.plan ?? null, now, now);

  // the key itself is never written to the log
  writeLog(db(), {
    workspaceId,
    kind: "integration",
    message: `saved a ${provider.info.label} api key`,
    detail: { provider: provider.id, hint: keyHint(trimmed) },
  });

  const resolved = resolveCredential(workspaceId, provider.id);
  if (!resolved) throw new ProviderError({ code: "unknown", message: "the key did not save" });
  return resolved.status;
}

export function clearCredential(workspaceId: string, providerId: string): void {
  const provider = getProvider(providerId);
  db().prepare(`DELETE FROM provider_credentials WHERE workspace_id = ? AND provider = ?`).run(workspaceId, provider.id);
  writeLog(db(), { workspaceId, kind: "integration", message: `removed the ${provider.info.label} api key`, detail: { provider: provider.id } });
}

export function noteCredentialResult(
  workspaceId: string,
  providerId: string,
  outcome: { ok: boolean; error?: string | null },
): void {
  db()
    .prepare(`UPDATE provider_credentials SET last_verified_at = ?, last_error = ?, updated_at = ? WHERE workspace_id = ? AND provider = ?`)
    .run(nowIso(), outcome.ok ? null : outcome.error ?? "unknown error", nowIso(), workspaceId, providerId);
}

/** every provider with whether we can actually use it right now. */
export function credentialStatuses(workspaceId: string): CredentialStatus[] {
  return PROVIDER_LIST.map((provider) => {
    const resolved = resolveCredential(workspaceId, provider.id);
    if (resolved) return resolved.status;
    return {
      provider: provider.id,
      label: provider.info.label,
      configured: false,
      source: "none" as const,
      hint: null,
      plan: null,
      lastVerifiedAt: null,
      lastError: null,
    };
  });
}

/** the first provider we hold a working key for. */
export function firstConfiguredProvider(workspaceId: string, preferred?: string | null): Provider | null {
  if (preferred) {
    const provider = getProvider(preferred);
    const resolved = resolveCredential(workspaceId, provider.id);
    if (resolved?.status.configured) return provider;
    return null;
  }
  for (const provider of PROVIDER_LIST) {
    const resolved = resolveCredential(workspaceId, provider.id);
    if (resolved?.status.configured) return provider;
  }
  return null;
}

export function requireCredential(workspaceId: string, providerId: string): ResolvedCredential {
  const provider = getProvider(providerId);
  const resolved = resolveCredential(workspaceId, provider.id);
  if (!resolved || !resolved.status.configured) {
    throw new ProviderError({
      code: "not_configured",
      message: `${provider.info.label} is not connected yet. add an api key first — there is nothing to search against without one.`,
    });
  }
  return resolved;
}

export function providerInfo(providerId: string): ProviderInfo {
  return getProvider(providerId).info;
}