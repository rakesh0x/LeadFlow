"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { currentMemberSync, requireWorkspaceId } from "@/lib/workspace";
import {
  APOLLO_INFO,
  APOLLO_SENIORITY,
  APOLLO_SIZE_RANGES,
  PDL_INFO,
  clearCredential,
  credentialStatuses,
  firstConfiguredProvider,
  getProvider,
  providerInfo,
  saveCredential,
  PROVIDER_LIST,
} from "@/lib/prospecting";
import {
  enrichCandidates,
  getSearch,
  importCandidates,
  listCandidates,
  listSearches,
  runSearch,
  skipCandidates,
} from "@/lib/prospecting/discovery";
import { EMPTY_ICP, ProviderError, hasAnyFilter, type Icp, type SearchKind } from "@/lib/prospecting/types";
import { parseRange } from "@/lib/prospecting/providers/pdl";
import { normalizeDomain } from "@/lib/engine/normalize";

export interface DiscoveryResult {
  ok: boolean;
  error?: string;
  code?: string;
  detail?: string | null;
  retryable?: boolean;
  searchId?: string;
  inserted?: number;
  total?: number;
  alreadyKnown?: number;
  hasMore?: boolean;
  creditsUsed?: number;
  imported?: number;
  merged?: number;
  skipped?: number;
  duplicatesSkipped?: number;
  noEmailWarning?: number;
  enriched?: number;
  found?: number;
  message?: string;
}

/** turns comma-separated or newline-separated text into a clean list. */
function list(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function parseIcp(input: {
  titles?: string | null;
  seniority?: string | null;
  companyLocations?: string | null;
  personLocations?: string | null;
  industries?: string | null;
  employeeRanges?: string | null;
  domains?: string | null;
  keywords?: string | null;
}): Icp {
  const icp: Icp = {
    titles: list(input.titles),
    seniority: list(input.seniority).filter((s) => APOLLO_SENIORITY.some((a) => a.value === s)),
    companyLocations: list(input.companyLocations),
    personLocations: list(input.personLocations),
    industries: list(input.industries).map((s) => s.toLowerCase()),
    employeeRanges: list(input.employeeRanges).map(normaliseRange).filter((r): r is string => r !== null),
    domains: list(input.domains).map((d) => normalizeDomain(d) ?? d).filter(Boolean),
    keywords: list(input.keywords),
  };
  return icp;
}

/** accepts "51,200", "51-200", "51 to 200" and "1001+" and hands on "min,max". */
function normaliseRange(value: string): string | null {
  const parsed = parseRange(value);
  if (!parsed) return null;
  if (parsed.max === Number.MAX_SAFE_INTEGER) return `${parsed.min},`;
  if (parsed.min === parsed.max) return `${parsed.min},${parsed.max}`;
  return `${parsed.min},${parsed.max}`;
}

function toResult(error: unknown): DiscoveryResult {
  if (error instanceof ProviderError) {
    return {
      ok: false,
      error: error.message,
      code: error.code,
      detail: error.detail,
      retryable: error.retryable,
    };
  }
  return { ok: false, error: error instanceof Error ? error.message : "something went wrong" };
}

// ---------------------------------------------------------------- setup

export async function getDiscoverySetup() {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const statuses = credentialStatuses(workspaceId);
  const active = firstConfiguredProvider(workspaceId);

  return {
    workspaceId,
    statuses,
    activeProvider: active?.id ?? null,
    providers: PROVIDER_LIST.map((p) => ({
      id: p.id,
      info: p.info,
      status: statuses.find((s) => s.provider === p.id) ?? null,
    })),
    seniorities: APOLLO_SENIORITY,
    sizes: APOLLO_SIZE_RANGES,
    recentSearches: listSearches(workspaceId, 8, database),
  };
}

export async function saveDiscoveryKey(input: { provider: string; apiKey: string; plan?: string | null }): Promise<DiscoveryResult> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  const trimmed = input.apiKey?.trim() ?? "";

  if (trimmed.length < 8) {
    return { ok: false, error: "paste the whole key. keys are long — if it looks cut off, it probably is." };
  }

  let provider;
  try {
    provider = getProvider(input.provider);
  } catch (error) {
    return toResult(error);
  }

  // check it before we keep it, so a typo does not get saved and rediscovered later
  if (provider.verify) {
    try {
      await provider.verify({ secret: trimmed });
    } catch (error) {
      const result = toResult(error);
      return {
        ok: false,
        code: result.code,
        error: result.error,
        detail: result.detail,
        message: "that key was not saved.",
      };
    }
  }

  try {
    const status = saveCredential(workspaceId, input.provider, trimmed, { plan: input.plan ?? null, actorId: member?.id ?? null });
    revalidatePath("/generate");
    revalidatePath("/settings");
    return {
      ok: true,
      message: `${provider.info.label} is connected${status.plan ? ` on the ${status.plan} plan` : ""}`,
    };
  } catch (error) {
    return toResult(error);
  }
}

export async function removeDiscoveryKey(provider: string): Promise<DiscoveryResult> {
  try {
    const database = db();
    const workspaceId = requireWorkspaceId(database);
    clearCredential(workspaceId, provider);
    revalidatePath("/generate");
    revalidatePath("/settings");
    return { ok: true, message: "key removed" };
  } catch (error) {
    return toResult(error);
  }
}

export async function verifyDiscoveryKey(provider: string): Promise<DiscoveryResult> {
  try {
    const database = db();
    const workspaceId = requireWorkspaceId(database);
    const { requireCredential } = await import("@/lib/prospecting");
    const credential = requireCredential(workspaceId, provider);
    const impl = getProvider(provider);
    if (!impl.verify) return { ok: true, message: "no check available" };
    const outcome = await impl.verify({ secret: credential.secret });
    revalidatePath("/generate");
    return { ok: true, message: `connected — ${outcome.label}` };
  } catch (error) {
    return toResult(error);
  }
}

// ---------------------------------------------------------------- search

export async function searchProspectsAction(input: {
  provider?: string | null;
  kind?: SearchKind;
  titles?: string | null;
  seniority?: string | null;
  companyLocations?: string | null;
  personLocations?: string | null;
  industries?: string | null;
  employeeRanges?: string | null;
  domains?: string | null;
  keywords?: string | null;
  page?: number;
  perPage?: number;
}): Promise<DiscoveryResult> {
  try {
    const database = db();
    const workspaceId = requireWorkspaceId(database);
    const member = currentMemberSync();

    const provider = firstConfiguredProvider(workspaceId, input.provider ?? null);
    if (!provider) {
      return {
        ok: false,
        code: "not_configured",
        error:
          "no prospecting provider is connected yet, so there is nothing to search. add an api key below and we will find real people.",
      };
    }

    const icp = parseIcp(input);
    if (!hasAnyFilter(icp)) {
      return {
        ok: false,
        error: "add at least one filter. searching for everyone returns nothing useful and may cost you credits.",
      };
    }

    const outcome = await runSearch(
      {
        workspaceId,
        providerId: provider.id,
        kind: input.kind ?? "people",
        icp,
        page: input.page ?? 1,
        perPage: input.perPage ?? 25,
        actorId: member?.id ?? null,
      },
      database,
    );

    revalidatePath("/generate");
    return {
      ok: true,
      searchId: outcome.searchId,
      inserted: outcome.inserted,
      total: outcome.total,
      alreadyKnown: outcome.alreadyKnown,
      hasMore: outcome.hasMore,
      creditsUsed: outcome.creditsUsed,
      message: `${outcome.inserted} people staged for review`,
    };
  } catch (error) {
    return toResult(error);
  }
}

// ---------------------------------------------------------------- review + import

export async function loadSearchResults(searchId: string) {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const search = getSearch(workspaceId, searchId, database);
  if (!search) return { ok: false as const, error: "that search is not here any more" };
  const candidates = listCandidates(workspaceId, searchId, {}, database);
  return { ok: true as const, search, candidates };
}

export async function revealEmailsAction(candidateIds: string[]): Promise<DiscoveryResult> {
  try {
    const database = db();
    const workspaceId = requireWorkspaceId(database);
    const member = currentMemberSync();
    const outcome = await enrichCandidates(workspaceId, candidateIds, member?.id ?? null, database);
    revalidatePath("/generate");
    return {
      ok: true,
      enriched: outcome.enriched,
      found: outcome.found,
      error: outcome.failed ? `${outcome.failed} could not be looked up` : undefined,
      message: outcome.found
        ? `found ${outcome.found} contact ${outcome.found === 1 ? "address" : "addresses"}`
        : "looked them up, but the provider has no address for those people",
    };
  } catch (error) {
    return toResult(error);
  }
}

export async function importProspectsAction(input: {
  candidateIds: string[];
  sourceId?: string | null;
  includeLikelyDuplicates?: boolean;
}): Promise<DiscoveryResult> {
  try {
    const database = db();
    const workspaceId = requireWorkspaceId(database);
    const member = currentMemberSync();

    const outcome = importCandidates(
      workspaceId,
      input.candidateIds,
      {
        sourceId: input.sourceId ?? null,
        actorId: member?.id ?? null,
        includeLikelyDuplicates: input.includeLikelyDuplicates ?? false,
      },
      database,
    );

    revalidatePath("/generate");
    revalidatePath("/inbox");
    revalidatePath("/leads");
    revalidatePath("/", "layout");

    const bits = [`${outcome.imported} added`];
    if (outcome.merged) bits.push(`${outcome.merged} matched someone we already had`);
    if (outcome.duplicatesSkipped) bits.push(`${outcome.duplicatesSkipped} left out as duplicates`);

    return {
      ok: true,
      imported: outcome.imported,
      merged: outcome.merged,
      skipped: outcome.skipped,
      duplicatesSkipped: outcome.duplicatesSkipped,
      noEmailWarning: outcome.noEmailWarning,
      message: bits.join(", "),
      error: outcome.errors.length ? `${outcome.errors.length} could not be added` : undefined,
    };
  } catch (error) {
    return toResult(error);
  }
}

export async function skipProspectsAction(candidateIds: string[]): Promise<DiscoveryResult> {
  try {
    const database = db();
    const workspaceId = requireWorkspaceId(database);
    const n = skipCandidates(workspaceId, candidateIds, database);
    revalidatePath("/generate");
    return { ok: true, skipped: n, message: n ? `${n} ignored` : "nothing to ignore" };
  } catch (error) {
    return toResult(error);
  }
}

// ---------------------------------------------------------------- reference

export async function getProviderReference() {
  return {
    apollo: APOLLO_INFO,
    pdl: PDL_INFO,
    seniorities: APOLLO_SENIORITY,
    sizes: APOLLO_SIZE_RANGES,
    providers: PROVIDER_LIST.map((p) => ({ id: p.id, info: p.info })),
    defaultIcp: EMPTY_ICP,
  };
}

export async function providerDetails(id: string) {
  return providerInfo(id);
}