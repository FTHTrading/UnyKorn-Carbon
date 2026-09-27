/**
 * UnyKorn Carbon Rail on Stellar.
 *
 * Stellar gives us a regulated-asset model natively (no custom contract risk):
 *   AUTH_REQUIRED        holders must be approved (KYB) before they can hold units
 *   AUTH_REVOCABLE       the issuer can freeze a holder
 *   AUTH_CLAWBACK_ENABLED the issuer can claw back (fraud / invalidated credits)
 * Burning = paying units back to the issuer. Retirement = a burn whose memo is the
 * sha256 of a public retirement record (beneficiary, serials, purpose, agent id).
 * 7 decimal places means a single API call can retire 0.0000001 t (0.1 g CO2e).
 *
 * This module only BUILDS transactions. Signing happens in your own wallet or
 * command hub (Freighter, Lobstr, Stellar Lab, Ledger, or a signer service).
 * If STELLAR_SECRET_<ROLE> is set at runtime on your machine, it can sign locally.
 */
import {
  Asset, AuthClawbackEnabledFlag, AuthRequiredFlag, AuthRevocableFlag, Keypair,
  Memo, Networks, Operation, TransactionBuilder, Account, Transaction, type AuthFlag,
} from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";

export type Net = "testnet" | "mainnet";
export const PASSPHRASE: Record<Net, string> = { testnet: Networks.TESTNET, mainnet: Networks.PUBLIC };
export const HORIZON: Record<Net, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};
const BASE_FEE = "1000"; // stroops per op; well above min so txs land under load

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest();
export const sha256hex = (s: string | Buffer) => sha256(s).toString("hex");

/** Valid Stellar amount string: non-negative decimal, no sign, no exponent, at most 7 decimals. */
export const AMOUNT_RE = /^(0|[1-9]\d*)(\.\d{1,7})?$/;

/**
 * Stellar amounts are strings with at most 7 decimals. Floors (never rounds up) so
 * a retirement never claims mass that was not measured. Rejects negative or
 * non-finite input instead of emitting an invalid amount.
 */
export function toAmount(tonnes: number): string {
  if (!Number.isFinite(tonnes) || tonnes < 0) throw new Error(`toAmount: invalid tonnes ${tonnes}`);
  // Work in integer stroops (1e-7 t). Snap to the nearest stroop when the float is within
  // 1e-6 stroop (1e-13 t) of it: 0.409 t arrives as 4089999.9999999995 stroops and must not
  // floor to 0.4089999 (that would drop 0.1 g to IEEE-754 noise, not to measurement). Any
  // larger fraction is genuine sub-stroop mass and is floored, never rounded up.
  const x = tonnes * 1e7;
  const nearest = Math.round(x);
  const stroops = BigInt(Math.abs(x - nearest) < 1e-6 ? nearest : Math.floor(x));
  const whole = stroops / 10_000_000n;
  const frac = (stroops % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Positive, valid Stellar amount string (used to validate record amounts before they hit the wire). */
export function assertAmount(s: string, what = "amount"): string {
  if (!AMOUNT_RE.test(s) || Number(s) <= 0) throw new Error(`${what} is not a valid positive Stellar amount: "${s}"`);
  return s;
}

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace. Retirement and
 * batch memos commit to these bytes, so two parties serialising the same record in a
 * different key order must reach the same hash.
 */
export function canonicalJson(v: unknown): string {
  if (v === undefined) return "null"; // only reachable inside arrays; JSON.stringify([undefined]) === "[null]"
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

/** Cap a UTF-8 string at `max` BYTES (manage_data values are 64 bytes) without splitting a code point. */
export function utf8Cap(s: string, max = 64): Buffer {
  let out = "";
  for (const ch of s) {
    if (Buffer.byteLength(out + ch) > max) break;
    out += ch;
  }
  return Buffer.from(out, "utf8");
}

/** 32-byte hex digest -> Buffer; rejects anything that is not exactly 64 hex chars. */
export function hex32(h: string, what = "hash"): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error(`${what} must be 64 hex chars (32 bytes), got ${h.length} chars`);
  return Buffer.from(h, "hex");
}

export interface CreditClass {
  code: string;          // asset code, e.g. "UKCO2" or "TNMETH"
  issuer: string;        // issuer public key (G...)
  homeDomain: string;    // serves /.well-known/stellar.toml (SEP-1)
  methodology: string;   // e.g. "ACR-OOG v1.0" / "BCarbon MEEWP v2.1"
  registry: string;      // e.g. "Triangle Digital" / "UnyKorn Harbor"
  serialRoot: string;    // hex sha256/Merkle root of the underlying serials
  dataRoomHash: string;  // hex sha256 of the diligence pack (LPS-1 anchored)
}

export const asset = (c: CreditClass) => new Asset(c.code, c.issuer);

function builder(source: Account, net: Net, memo?: Memo) {
  const b = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: PASSPHRASE[net] }).setTimeout(0);
  if (memo) b.addMemo(memo);
  return b;
}

/** 1. Issuer: regulated-asset flags + on-chain proof entries (manage_data, 64-byte values). */
export function buildIssuerSetup(issuer: Account, c: CreditClass, net: Net): Transaction {
  // AUTH_IMMUTABLE (4) is deliberately NOT set: it would freeze these flags forever.
  const flags = (AuthRequiredFlag | AuthRevocableFlag | AuthClawbackEnabledFlag) as AuthFlag;
  return builder(issuer, net, Memo.text(`${c.code} setup`))
    .addOperation(Operation.setOptions({ setFlags: flags, homeDomain: c.homeDomain }))
    .addOperation(Operation.manageData({ name: `${c.code}:methodology`, value: utf8Cap(c.methodology) }))
    .addOperation(Operation.manageData({ name: `${c.code}:registry`, value: utf8Cap(c.registry) }))
    .addOperation(Operation.manageData({ name: `${c.code}:serialRoot`, value: hex32(c.serialRoot, "serialRoot") }))
    .addOperation(Operation.manageData({ name: `${c.code}:dataRoom`, value: hex32(c.dataRoomHash, "dataRoomHash") }))
    .build();
}

/** 2. Holder opens a trustline (any KYB'd holder: treasury, buyer, agent operator). */
export function buildTrustline(holder: Account, c: CreditClass, net: Net, limit?: string): Transaction {
  return builder(holder, net)
    .addOperation(Operation.changeTrust({ asset: asset(c), limit }))
    .build();
}

/** 3. Issuer authorizes (KYB passed) or freezes a holder. */
export function buildAuthorize(issuer: Account, c: CreditClass, holder: string, authorized: boolean, net: Net): Transaction {
  return builder(issuer, net, Memo.text(authorized ? "KYB approved" : "frozen"))
    .addOperation(Operation.setTrustLineFlags({ trustor: holder, asset: asset(c), flags: { authorized } }))
    .build();
}

/** 4. Mint: issuer pays units to the treasury. Memo = sha256 of the canonical (sorted-key) batch JSON. */
export function buildMint(issuer: Account, c: CreditClass, to: string, tonnes: number, batchRecord: object, net: Net): Transaction {
  return builder(issuer, net, Memo.hash(sha256(canonicalJson(batchRecord))))
    .addOperation(Operation.payment({ destination: to, asset: asset(c), amount: toAmount(tonnes) }))
    .build();
}

export interface RetirementRecord {
  kind: "retirement";
  asset: string;             // CODE:ISSUER
  tonnes: string;            // exact 7-decimal amount retired
  beneficiary: string;       // who the offset is for (company, agent, data center)
  purpose: string;           // e.g. "AI inference energy, Sep 2026"
  agentId?: string;          // ERC-8004 identity, e.g. "base:95721"
  paymentRefs?: string[];    // x402 / MPP settlement ids covered by this retirement
  energyKwh?: number;
  gridRegion?: string;
  kgCO2e?: number;
  at: string;                // ISO timestamp
}

/** 5. Retire: holder burns units back to the issuer; memo = sha256 of the canonical (sorted-key) record JSON. */
export function buildRetire(holder: Account, c: CreditClass, rec: RetirementRecord, net: Net): Transaction {
  assertAmount(rec.tonnes, "RetirementRecord.tonnes");
  return builder(holder, net, Memo.hash(sha256(canonicalJson(rec))))
    .addOperation(Operation.payment({ destination: c.issuer, asset: asset(c), amount: rec.tonnes }))
    .build();
}

/** 6. Clawback for invalidated credits or fraud (issuer only). */
export function buildClawback(issuer: Account, c: CreditClass, from: string, tonnes: number, reason: string, net: Net): Transaction {
  return builder(issuer, net, Memo.hash(sha256(reason)))
    .addOperation(Operation.clawback({ asset: asset(c), from, amount: toAmount(tonnes) }))
    .build();
}

/** Optional local signing, only when the secret is provided at runtime on the operator's machine. */
export function maybeSign(tx: Transaction, role: string): { signed: boolean; xdr: string } {
  const secret = process.env[`STELLAR_SECRET_${role.toUpperCase()}`];
  if (secret) { tx.sign(Keypair.fromSecret(secret)); return { signed: true, xdr: tx.toXDR() }; }
  return { signed: false, xdr: tx.toXDR() };
}

/** Submit a signed XDR to Horizon (run from a machine with network access). */
export async function submit(xdr: string, net: Net) {
  const res = await fetch(`${HORIZON[net]}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tx: xdr }),
  });
  const j: any = await res.json().catch(() => ({}));
  // Report result codes only; the Horizon error body also echoes the full envelope XDR, which we do not need to print.
  if (!res.ok) throw new Error(`Horizon ${res.status}: ${JSON.stringify(j.extras?.result_codes ?? j.title ?? j.detail ?? "no body")}`);
  return j.hash as string;
}

export async function loadAccount(pub: string, net: Net): Promise<Account> {
  const r = await fetch(`${HORIZON[net]}/accounts/${pub}`);
  if (r.status === 404) throw new Error(`account ${pub} not found on ${net} (fund it first)`);
  if (!r.ok) throw new Error(`Horizon ${r.status} loading ${pub} on ${net}${r.status === 429 ? " (rate limited; retry later)" : ""}`);
  const j: any = await r.json();
  if (typeof j.sequence !== "string") throw new Error(`Horizon returned no sequence for ${pub}`);
  return new Account(pub, j.sequence);
}
