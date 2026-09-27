#!/usr/bin/env tsx
/**
 * check-accounts — read-only Stellar account checker.
 *
 * Reads public keys from accounts.txt (or --file <path>), GETs each one from
 * Horizon, prints a table, writes out/accounts-status.csv, and suggests which
 * account to use as issuer / treasury / agent operator for the carbon rail.
 *
 * Only public keys are ever read. Anything shaped like a secret key is
 * counted, warned about, and dropped without being printed or persisted.
 *
 * Usage:
 *   npm run accounts -- [--file accounts.txt] [--net mainnet|testnet]
 *
 * Exit codes: 0 ok · 1 file missing / no valid keys · 2 at least one request ended in ERROR.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HORIZON, type Net } from "../src/stellar/rail.ts";

// ───────────────────────────── types ─────────────────────────────

export interface ParsedKeys {
  /** Valid, de-duplicated public keys with the 1-based line they came from. */
  keys: { line: number; key: string }[];
  /** Lines that were neither blank, comment, valid key, nor secret-shaped. */
  invalid: { line: number; reason: string }[];
  /** 1-based line numbers of secret-shaped lines. The text is deliberately not kept. */
  secretLines: number[];
}

export interface AccountInfo {
  xlm_balance: string;
  sequence: string;
  subentry_count: number;
  num_trustlines: number;
  num_signers: number;
  thresholds: { low: number; med: number; high: number };
  flags: { auth_required: boolean; auth_revocable: boolean; auth_clawback_enabled: boolean; auth_immutable: boolean };
  home_domain: string;
  data_entries: number;
  last_modified_time: string;
}

export interface AccountRecord {
  key: string;
  exists: boolean;
  /** HTTP status of the final attempt, or "ERROR" for a network failure. */
  status: number | "ERROR";
  info: AccountInfo | null;
  note: string;
}

export type Role = "issuer" | "treasury" | "agent_operator" | "other" | "unfunded";

export interface Pick {
  key: string;
  reason: string;
}
export interface Picks {
  issuer: Pick | null;
  treasury: Pick | null;
  agent_operator: Pick | null;
}

// ───────────────────────────── parsing ─────────────────────────────

const PUBKEY_RE = /^G[A-Z2-7]{55}$/;
const SECRET_SHAPE_RE = /^S[A-Z2-7]{55}$/i;

export function isPublicKey(s: string): boolean {
  return PUBKEY_RE.test(s);
}

/** Secret-shaped = 56 chars starting with S. Case-insensitive on purpose: err toward hiding. */
export function looksLikeSecret(s: string): boolean {
  return s.length === 56 && SECRET_SHAPE_RE.test(s);
}

export function parseAccountsFile(text: string): ParsedKeys {
  const out: ParsedKeys = { keys: [], invalid: [], secretLines: [] };
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i].trim();
    if (raw === "" || raw.startsWith("#")) continue;
    if (looksLikeSecret(raw)) {
      out.secretLines.push(lineNo);
      continue;
    }
    if (!isPublicKey(raw)) {
      // Never echo the offending text: it might be a mangled secret.
      out.invalid.push({ line: lineNo, reason: `not a Stellar public key (need 56 chars, G + base32 [A-Z2-7]); got ${raw.length} chars` });
      continue;
    }
    if (seen.has(raw)) {
      out.invalid.push({ line: lineNo, reason: `duplicate of an earlier line (${raw})` });
      continue;
    }
    seen.add(raw);
    out.keys.push({ line: lineNo, key: raw });
  }
  return out;
}

// ───────────────────────────── Horizon mapping ─────────────────────────────

function num(v: unknown, dflt = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : dflt;
}
function str(v: unknown, dflt = ""): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : dflt;
}

export function parseHorizonAccount(j: any): AccountInfo {
  const balances: any[] = Array.isArray(j?.balances) ? j.balances : [];
  const native = balances.find((b) => b?.asset_type === "native");
  const trustlines = balances.filter((b) => b?.asset_type !== "native").length;
  const signers: any[] = Array.isArray(j?.signers) ? j.signers : [];
  const th = j?.thresholds ?? {};
  const fl = j?.flags ?? {};
  const data = j?.data && typeof j.data === "object" ? Object.keys(j.data).length : 0;
  return {
    xlm_balance: str(native?.balance, "0"),
    sequence: str(j?.sequence, ""),
    subentry_count: num(j?.subentry_count),
    num_trustlines: trustlines,
    num_signers: signers.length,
    thresholds: { low: num(th.low_threshold), med: num(th.med_threshold), high: num(th.high_threshold) },
    flags: {
      auth_required: fl.auth_required === true,
      auth_revocable: fl.auth_revocable === true,
      auth_clawback_enabled: fl.auth_clawback_enabled === true,
      auth_immutable: fl.auth_immutable === true,
    },
    home_domain: str(j?.home_domain, ""),
    data_entries: data,
    last_modified_time: str(j?.last_modified_time, ""),
  };
}

// ───────────────────────────── roles ─────────────────────────────

function anyFlag(i: AccountInfo): boolean {
  return i.flags.auth_required || i.flags.auth_revocable || i.flags.auth_clawback_enabled || i.flags.auth_immutable;
}
function xlm(i: AccountInfo): number {
  return num(i.xlm_balance);
}

export function isIssuerCandidate(r: AccountRecord): boolean {
  const i = r.info;
  if (!r.exists || !i) return false;
  return xlm(i) >= 3 && i.num_trustlines === 0 && i.data_entries === 0 && !anyFlag(i) && i.num_signers === 1 && i.home_domain === "";
}
export function isTreasuryCandidate(r: AccountRecord): boolean {
  const i = r.info;
  if (!r.exists || !i) return false;
  return xlm(i) >= 1.5 && i.num_trustlines <= 5 && !anyFlag(i);
}
export function isAgentCandidate(r: AccountRecord): boolean {
  const i = r.info;
  if (!r.exists || !i) return false;
  return xlm(i) >= 1;
}

/** Best single tier an account qualifies for, considered on its own. */
export function suggestRole(r: AccountRecord): Role {
  if (!r.exists || !r.info) return "unfunded";
  if (isIssuerCandidate(r)) return "issuer";
  if (isTreasuryCandidate(r)) return "treasury";
  if (isAgentCandidate(r)) return "agent_operator";
  return "other";
}

/** Stable sort by XLM balance descending; ties keep input order. */
function byBalanceDesc(recs: AccountRecord[]): AccountRecord[] {
  return recs
    .map((r, idx) => ({ r, idx }))
    .sort((a, b) => xlm(b.r.info!) - xlm(a.r.info!) || a.idx - b.idx)
    .map((x) => x.r);
}

/** Assign the three roles across the whole set. Each account is used at most once. */
export function pickCandidates(recs: AccountRecord[]): Picks {
  const used = new Set<string>();
  const take = (pred: (r: AccountRecord) => boolean, reason: (r: AccountRecord) => string): Pick | null => {
    const c = byBalanceDesc(recs.filter((r) => r.exists && r.info && !used.has(r.key) && pred(r)))[0];
    if (!c) return null;
    used.add(c.key);
    return { key: c.key, reason: reason(c) };
  };
  const issuer = take(
    isIssuerCandidate,
    (r) => `clean, unused account with the highest balance (${r.info!.xlm_balance} XLM, 0 trustlines, 0 data, no flags, 1 signer, no home_domain)`,
  );
  const treasury = take(
    isTreasuryCandidate,
    (r) => `next by balance (${r.info!.xlm_balance} XLM, ${r.info!.num_trustlines} trustline(s), no flags)`,
  );
  const agent_operator = take(isAgentCandidate, (r) => `next by balance (${r.info!.xlm_balance} XLM, ${r.info!.num_trustlines} trustline(s))`);
  return { issuer, treasury, agent_operator };
}

// ───────────────────────────── CSV ─────────────────────────────

export const CSV_HEADER =
  "key,exists,xlm_balance,sequence,subentries,trustlines,signers,thresh_low,thresh_med,thresh_high,auth_required,auth_revocable,auth_clawback,auth_immutable,home_domain,data_entries,last_modified,suggested_role,note";

export function csvField(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: { rec: AccountRecord; role: Role }[]): string {
  const lines = [CSV_HEADER];
  for (const { rec, role } of rows) {
    const i = rec.info;
    const cells: (string | number | boolean | null)[] = i
      ? [
          rec.key, rec.exists, i.xlm_balance, i.sequence, i.subentry_count, i.num_trustlines, i.num_signers,
          i.thresholds.low, i.thresholds.med, i.thresholds.high,
          i.flags.auth_required, i.flags.auth_revocable, i.flags.auth_clawback_enabled, i.flags.auth_immutable,
          i.home_domain, i.data_entries, i.last_modified_time, role, rec.note,
        ]
      : [rec.key, rec.exists, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, role, rec.note];
    lines.push(cells.map(csvField).join(","));
  }
  return lines.join("\n") + "\n";
}

// ───────────────────────────── network ─────────────────────────────

export type FetchLike = (url: string) => Promise<{ status: number; json(): Promise<any> }>;
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchAccount(
  horizon: string,
  key: string,
  fetchImpl: FetchLike = (u) => fetch(u, { headers: { accept: "application/json" } }),
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<AccountRecord> {
  const url = `${horizon}/accounts/${key}`;
  const delays = [1000, 2000, 4000];
  for (let attempt = 0; ; attempt++) {
    let res: { status: number; json(): Promise<any> };
    try {
      res = await fetchImpl(url);
    } catch (e: any) {
      return { key, exists: false, status: "ERROR", info: null, note: `network error: ${e?.message ?? String(e)}` };
    }
    if (res.status === 200) {
      try {
        return { key, exists: true, status: 200, info: parseHorizonAccount(await res.json()), note: "" };
      } catch (e: any) {
        return { key, exists: false, status: "ERROR", info: null, note: `bad JSON from Horizon: ${e?.message ?? String(e)}` };
      }
    }
    if (res.status === 404) return { key, exists: false, status: 404, info: null, note: "unfunded / does not exist" };
    if (res.status === 429 && attempt < delays.length) {
      await sleep(delays[attempt]);
      continue;
    }
    return { key, exists: false, status: res.status, info: null, note: res.status === 429 ? "rate limited after 3 retries" : `HTTP ${res.status}` };
  }
}

/** Run tasks with at most `limit` in flight, preserving result order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ───────────────────────────── CLI ─────────────────────────────

export function parseArgs(argv: string[]): { file: string; net: Net } {
  let file = "accounts.txt";
  let net: Net = "mainnet";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" && argv[i + 1]) file = argv[++i];
    else if (a.startsWith("--file=")) file = a.slice("--file=".length);
    else if (a === "--net" && argv[i + 1]) net = argv[++i] as Net;
    else if (a.startsWith("--net=")) net = a.slice("--net=".length) as Net;
    else if (a === "-h" || a === "--help") {
      console.log("usage: check-accounts [--file accounts.txt] [--net mainnet|testnet]");
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(1);
    }
  }
  if (net !== "mainnet" && net !== "testnet") {
    console.error(`--net must be mainnet or testnet`);
    process.exit(1);
  }
  return { file, net };
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

function printTable(rows: { rec: AccountRecord; role: Role }[]): void {
  const head = ["key", "exists", "xlm", "trust", "signers", "data", "flags", "home_domain", "role", "note"];
  const body = rows.map(({ rec, role }) => {
    const i = rec.info;
    const flags = i ? Object.entries(i.flags).filter(([, v]) => v).map(([k]) => k.replace("auth_", "")).join("|") || "-" : "";
    return [
      rec.key,
      String(rec.exists),
      i ? i.xlm_balance : "",
      i ? String(i.num_trustlines) : "",
      i ? String(i.num_signers) : "",
      i ? String(i.data_entries) : "",
      flags,
      i ? i.home_domain || "-" : "",
      role,
      rec.note,
    ];
  });
  const widths = head.map((h, c) => Math.max(h.length, ...body.map((r) => r[c].length)));
  const line = (r: string[]) => r.map((v, c) => pad(v, widths[c])).join("  ").trimEnd();
  console.log(line(head));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of body) console.log(line(r));
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { file, net } = parseArgs(argv);
  const filePath = resolve(process.cwd(), file);
  if (!existsSync(filePath)) {
    console.error(`accounts file not found: ${filePath}`);
    console.error("Create it with one public key (G...) per line. See accounts.example.txt.");
    return 1;
  }
  const parsed = parseAccountsFile(readFileSync(filePath, "utf8"));

  for (const n of parsed.secretLines) {
    console.warn(`WARNING: line ${n} looks like a secret key — removed from consideration; rotate it if it was ever real`);
  }
  for (const inv of parsed.invalid) console.warn(`skip line ${inv.line}: ${inv.reason}`);
  if (parsed.keys.length === 0) {
    console.error("no valid public keys found");
    return 1;
  }

  const horizon = HORIZON[net];
  console.log(`Checking ${parsed.keys.length} account(s) on ${net} via ${horizon} (read-only, max 4 concurrent)\n`);
  const records = await mapLimit(parsed.keys, 4, ({ key }) => fetchAccount(horizon, key));

  const picks = pickCandidates(records);
  const roleOf = (r: AccountRecord): Role => {
    if (picks.issuer?.key === r.key) return "issuer";
    if (picks.treasury?.key === r.key) return "treasury";
    if (picks.agent_operator?.key === r.key) return "agent_operator";
    return r.exists ? "other" : "unfunded";
  };
  const rows = records.map((rec) => {
    const role = roleOf(rec);
    const tier = suggestRole(rec);
    if (role === "other" && tier !== "other") rec.note = [rec.note, `also qualifies as ${tier} candidate`].filter(Boolean).join("; ");
    return { rec, role };
  });

  printTable(rows);
  console.log("");
  for (const name of ["issuer", "treasury", "agent_operator"] as const) {
    const p = picks[name];
    console.log(p ? `${name}: ${p.key} — ${p.reason}` : `no suitable ${name} candidate`);
  }

  const outDir = resolve(process.cwd(), "out");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "accounts-status.csv");
  writeFileSync(outPath, toCsv(rows), "utf8");
  console.log(`\nwrote ${outPath}`);

  const errors = records.filter((r) => r.status === "ERROR").length;
  if (errors) console.error(`${errors} request(s) ended in ERROR`);
  return errors ? 2 : 0;
}

// Run only when executed directly (not when imported by tests).
const isDirect = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isDirect) {
  // Set exitCode rather than calling process.exit(): a hard exit while tsx's
  // loader handles are still open trips a libuv assertion on Windows.
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e?.message ?? e);
      process.exitCode = 2;
    },
  );
}
