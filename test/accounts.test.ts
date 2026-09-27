import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAccountsFile,
  isPublicKey,
  parseHorizonAccount,
  suggestRole,
  pickCandidates,
  toCsv,
  CSV_HEADER,
  type AccountRecord,
  type AccountInfo,
} from "../scripts/check-accounts.ts";

// Syntactically valid public keys (Horizon-shaped, never funded on purpose).
const G1 = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const G2 = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const G3 = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const G4 = "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
// Secret-shaped line (S + 55 base32 chars). Not a real key.
const S1 = "S" + "A".repeat(55);

function info(over: Partial<AccountInfo> = {}): AccountInfo {
  return {
    xlm_balance: "3.0000000",
    sequence: "1",
    subentry_count: 0,
    num_trustlines: 0,
    num_signers: 1,
    thresholds: { low: 0, med: 0, high: 0 },
    flags: { auth_required: false, auth_revocable: false, auth_clawback_enabled: false, auth_immutable: false },
    home_domain: "",
    data_entries: 0,
    last_modified_time: "",
    ...over,
  };
}
function rec(key: string, i: AccountInfo | null, status: number | "ERROR" = i ? 200 : 404): AccountRecord {
  return { key, exists: i !== null, status, info: i, note: "" };
}

test("isPublicKey accepts G + 55 base32, rejects everything else", () => {
  assert.equal(isPublicKey(G1), true);
  assert.equal(isPublicKey(G1.toLowerCase()), false);
  assert.equal(isPublicKey(G1.slice(0, 55)), false);
  assert.equal(isPublicKey(G1 + "A"), false);
  assert.equal(isPublicKey("G" + "1".repeat(55)), false); // '1' is not in the base32 alphabet
  assert.equal(isPublicKey(S1), false);
});

test("parseAccountsFile skips blanks/comments, trims, rejects invalid with line numbers", () => {
  const text = [
    "# header comment",
    "",
    `  ${G1}  `,
    "   ",
    "not-a-key",
    `${G2}`,
    "# trailing",
  ].join("\n");
  const r = parseAccountsFile(text);
  assert.deepEqual(r.keys, [
    { line: 3, key: G1 },
    { line: 6, key: G2 },
  ]);
  assert.equal(r.invalid.length, 1);
  assert.equal(r.invalid[0].line, 5);
  assert.match(r.invalid[0].reason, /not a Stellar public key/);
  assert.deepEqual(r.secretLines, []);
});

test("parseAccountsFile detects secret-shaped lines and never echoes them", () => {
  const text = `${G1}\n${S1}\n${G2}\n`;
  const r = parseAccountsFile(text);
  assert.deepEqual(r.secretLines, [2]);
  assert.deepEqual(r.keys.map((k) => k.key), [G1, G2]);
  assert.equal(r.invalid.length, 0);
  assert.ok(!JSON.stringify(r).includes(S1), "secret must not appear anywhere in the parsed structure");
  assert.ok(!JSON.stringify(r).includes(S1.slice(0, 12)), "not even a prefix of it");
});

test("parseAccountsFile handles CRLF and duplicate keys", () => {
  const r = parseAccountsFile(`${G1}\r\n${G1}\r\n`);
  assert.deepEqual(r.keys.map((k) => k.key), [G1]);
  assert.equal(r.invalid.length, 1);
  assert.match(r.invalid[0].reason, /duplicate/);
});

test("parseHorizonAccount maps a Horizon account JSON fixture", () => {
  const fixture = {
    id: G1,
    account_id: G1,
    sequence: "182563089281777664",
    subentry_count: 3,
    home_domain: "example.org",
    last_modified_ledger: 42,
    last_modified_time: "2026-09-01T12:00:00Z",
    thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
    flags: { auth_required: true, auth_revocable: true, auth_immutable: false, auth_clawback_enabled: true },
    balances: [
      {
        balance: "100.0000000",
        limit: "922337203685.4775807",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: G2,
      },
      { balance: "12.5000000", buying_liabilities: "0.0000000", selling_liabilities: "0.0000000", asset_type: "native" },
    ],
    signers: [
      { weight: 1, key: G1, type: "ed25519_public_key" },
      { weight: 1, key: G3, type: "ed25519_public_key" },
    ],
    data: { a: "MQ==", b: "Mg==" },
  };
  const a = parseHorizonAccount(fixture);
  assert.equal(a.xlm_balance, "12.5000000");
  assert.equal(a.sequence, "182563089281777664");
  assert.equal(a.subentry_count, 3);
  assert.equal(a.num_trustlines, 1);
  assert.equal(a.num_signers, 2);
  assert.deepEqual(a.thresholds, { low: 1, med: 2, high: 3 });
  assert.deepEqual(a.flags, { auth_required: true, auth_revocable: true, auth_clawback_enabled: true, auth_immutable: false });
  assert.equal(a.home_domain, "example.org");
  assert.equal(a.data_entries, 2);
  assert.equal(a.last_modified_time, "2026-09-01T12:00:00Z");
});

test("parseHorizonAccount tolerates missing optional fields", () => {
  const a = parseHorizonAccount({ sequence: "5", balances: [], signers: [], thresholds: {}, flags: {} });
  assert.equal(a.xlm_balance, "0");
  assert.equal(a.num_trustlines, 0);
  assert.equal(a.num_signers, 0);
  assert.equal(a.data_entries, 0);
  assert.equal(a.home_domain, "");
  assert.equal(a.last_modified_time, "");
});

test("suggestRole: clean account with 3 XLM is an issuer candidate", () => {
  assert.equal(suggestRole(rec(G1, info())), "issuer");
});
test("suggestRole: 2.9 XLM clean account is not an issuer, but is a treasury candidate", () => {
  assert.equal(suggestRole(rec(G1, info({ xlm_balance: "2.9000000" }))), "treasury");
});
test("suggestRole: a trustline disqualifies issuer, still treasury", () => {
  assert.equal(suggestRole(rec(G1, info({ num_trustlines: 1 }))), "treasury");
});
test("suggestRole: data entries / home_domain / extra signer disqualify issuer", () => {
  assert.equal(suggestRole(rec(G1, info({ data_entries: 1 }))), "treasury");
  assert.equal(suggestRole(rec(G1, info({ home_domain: "x.org" }))), "treasury");
  assert.equal(suggestRole(rec(G1, info({ num_signers: 2 }))), "treasury");
});
test("suggestRole: any flag set disqualifies issuer and treasury -> agent_operator", () => {
  const f = { auth_required: true, auth_revocable: false, auth_clawback_enabled: false, auth_immutable: false };
  assert.equal(suggestRole(rec(G1, info({ flags: f }))), "agent_operator");
});
test("suggestRole: >5 trustlines with >=1 XLM -> agent_operator", () => {
  assert.equal(suggestRole(rec(G1, info({ num_trustlines: 6 }))), "agent_operator");
});
test("suggestRole: below 1 XLM -> other; 404 -> unfunded", () => {
  assert.equal(suggestRole(rec(G1, info({ xlm_balance: "0.9999999" }))), "other");
  assert.equal(suggestRole(rec(G1, null)), "unfunded");
  assert.equal(suggestRole(rec(G1, null, "ERROR")), "unfunded");
});

test("pickCandidates: highest-balance clean account is issuer, next clean is treasury, next is agent", () => {
  const recs = [
    rec(G1, info({ xlm_balance: "5.0000000" })),
    rec(G2, info({ xlm_balance: "50.0000000" })),
    rec(G3, info({ xlm_balance: "7.0000000", num_trustlines: 2 })),
    rec(G4, null),
  ];
  const p = pickCandidates(recs);
  assert.equal(p.issuer?.key, G2);
  assert.equal(p.treasury?.key, G3); // 7 XLM with trustlines: qualifies as treasury, not issuer
  assert.equal(p.agent_operator?.key, G1);
  assert.match(p.issuer!.reason, /clean/);
});

test("pickCandidates: a single clean account is used once, as issuer only", () => {
  const p = pickCandidates([rec(G1, info())]);
  assert.equal(p.issuer?.key, G1);
  assert.equal(p.treasury, null);
  assert.equal(p.agent_operator, null);
});

test("pickCandidates: nothing suitable returns nulls", () => {
  const p = pickCandidates([rec(G1, null), rec(G2, info({ xlm_balance: "0.5000000" }))]);
  assert.deepEqual(p, { issuer: null, treasury: null, agent_operator: null });
});

test("pickCandidates: ties broken by balance then input order", () => {
  const p = pickCandidates([rec(G1, info({ xlm_balance: "4.0000000" })), rec(G2, info({ xlm_balance: "4.0000000" }))]);
  assert.equal(p.issuer?.key, G1);
  assert.equal(p.treasury?.key, G2);
});

test("CSV header is exact and fields with commas/quotes are quoted", () => {
  assert.equal(
    CSV_HEADER,
    "key,exists,xlm_balance,sequence,subentries,trustlines,signers,thresh_low,thresh_med,thresh_high,auth_required,auth_revocable,auth_clawback,auth_immutable,home_domain,data_entries,last_modified,suggested_role,note",
  );
  const r = rec(G1, info({ home_domain: "a,b" }));
  r.note = 'says "hi"';
  const csv = toCsv([{ rec: r, role: "issuer" }]);
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines[0], CSV_HEADER);
  assert.equal(
    lines[1],
    `${G1},true,3.0000000,1,0,0,1,0,0,0,false,false,false,false,"a,b",0,,issuer,"says ""hi"""`,
  );
});

test("CSV row for an unfunded account has empty numeric fields", () => {
  const csv = toCsv([{ rec: rec(G2, null), role: "unfunded" }]);
  assert.equal(csv.trimEnd().split("\n")[1], `${G2},false,,,,,,,,,,,,,,,,unfunded,`);
});
