/**
 * normalisation.
 * two leads only match each other if their identifiers reduce to the same string.
 * everything here is deliberately boring: lowercase, strip the noise providers add,
 * and take the part that identifies the person.
 */

/** plus tags are routing noise on almost every mail provider. */
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com"]);

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return null;
  let local = value.slice(0, at);
  let domain = value.slice(at + 1);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;

  // jane+news@ and jane+sales@ are the same person on the same inbox
  if (local.includes("+")) local = local.slice(0, local.indexOf("+"));
  // on gmail the dots are not part of the address either
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replaceAll(".", "");
  }
  if (domain === "googlemail.com") domain = "gmail.com";
  if (!local) return null;
  const out = `${local}@${domain}`;
  return out.length > 4 ? out : null;
}

/** keeps digits, drops a leading country code and leading 0. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;
  let out = digits;
  if (out.length === 11 && out.startsWith("1")) out = out.slice(1);
  else if (out.length > 11 && out.startsWith("00")) out = out.slice(2);
  else if (out.length > 10 && out[0] === "0") out = out.slice(1);
  return out.length >= 7 && out.length <= 15 ? out : null;
}

/** strips scheme, www, trailing slash, tracking params, and case. */
export function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  if (!value) return null;
  if (!/^https?:\/\//.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    url.hash = "";
    const keep = new URLSearchParams();
    for (const [key, val] of url.searchParams) {
      if (key.startsWith("utm_") || key === "ref" || key === "source") continue;
      keep.append(key, val);
    }
    url.search = keep.toString();
    let host = url.host.replace(/^www\./, "");
    let pathname = url.pathname.replace(/\/+$/, "");
    return `${host}${pathname}${url.search}`.replace(/\/$/, "");
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  }
}

/** linkedin profile keys look like /in/jane-doe or /company/acme. */
export function normalizeLinkedin(raw: string | null | undefined): string | null {
  const base = normalizeUrl(raw);
  if (!base) return null;
  const host = base.split("/")[0];
  if (!/(^|\.)linkedin\.com$/.test(host)) return null;
  const segments = base.split("/").slice(1).filter(Boolean);
  // the interesting segment is the one after in/company/school/groups
  const interesting = ["in", "company", "school", "showcase", "groups"].find((k) => segments[0] === k);
  const key = interesting ? segments[1] : segments[0];
  return key ? `linkedin:${key}` : null;
}

export function normalizeX(raw: string | null | undefined): string | null {
  const base = normalizeUrl(raw);
  if (!base) return null;
  const m = base.match(/^(?:twitter\.com|x\.com)\/([^/?#]+)/);
  if (!m) return null;
  const handle = m[1].replace(/^@/, "").toLowerCase();
  return handle && handle !== "home" && handle !== "search" ? `x:${handle}` : null;
}

/**
 * a company domain: mail.acme.co.uk -> acme.co.uk
 * a small public-suffix list covers the multi-part suffixes that actually
 * show up on business domains, so we do not treat "acme.co.uk" as a domain.
 */
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
  "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz",
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp",
  "com.br", "net.br", "org.br", "com.mx", "com.ar", "com.co", "com.pe",
  "co.in", "net.in", "org.in", "co.za", "co.il", "com.tr", "com.sg", "com.hk",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
]);

export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  if (!value) return null;
  if (emailLike(value)) value = value.split("@")[1];
  else if (!/^https?:\/\//.test(value)) value = `https://${value}`;
  value = value.replace(/^https?:\/\//, "");
  const host = value.split("/")[0].split(":")[0].replace(/^www\./, "");
  if (!host.includes(".")) return null;

  if (FREE_MAIL.has(host)) return null;

  const bits = host.split(".");
  if (bits.length < 2) return null;
  if (bits.length >= 3) {
    const lastTwo = bits.slice(-2).join(".");
    if (MULTI_PART_SUFFIXES.has(lastTwo)) return bits.slice(-3).join(".");
  }
  return bits.slice(-2).join(".");
}

function emailLike(v: string) {
  return v.includes("@") && !v.includes("/");
}

export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** diacritics, initials and honorifics all hide a real match. */
export function nameKey(raw: string | null | undefined): string {
  const norm = normalizeName(raw);
  if (!norm) return "";
  const parts = norm
    .split(" ")
    .filter((p) => p && !["mr", "mrs", "ms", "dr", "prof", "mx"].includes(p));
  if (parts.length >= 2) return `${parts[0]}.${parts[parts.length - 1]}`;
  return parts[0] ?? "";
}

/** free-mail addresses do not identify a company. */
export function isFreeEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.split("@")[1];
  if (!domain) return true;
  return FREE_MAIL.has(domain) || ["aol.com","proton.me","protonmail.com","mail.com","gmx.com","me.com"].includes(domain);
}

export function companyDomainFromEmail(email: string | null | undefined): string | null {
  if (!email || isFreeEmail(email)) return null;
  return normalizeDomain(email.split("@")[1]);
}

export function initials(fullName: string | null | undefined): string {
  if (!fullName) return "?";
  const parts = normalizeName(fullName).split(" ").filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** a stable colour per person so avatars stay the same across the app. */
export function hueFromString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) % 360;
  return h;
}

export function displayName(fullName: string | null | undefined, email: string | null | undefined): string {
  if (fullName && fullName.trim()) return fullName.trim();
  if (email) return email.split("@")[0];
  return "unknown";
}

export function companyFromEmail(email: string | null | undefined): string | null {
  const domain = companyDomainFromEmail(email);
  if (!domain) return null;
  const root = domain.split(".")[0];
  if (!root) return null;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
}