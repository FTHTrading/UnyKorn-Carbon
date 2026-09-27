# Review — Task 1: Stellar carbon rail (UKCO2)

- **Repo / branch:** `C:\Users\Kevan\dev\platforms\UnyKorn-Carbon`, `stellar-rail` (moved from D:\ mid-review; D:\ is a failing FAT32 stick where `npm ci` could not write `node_modules`. All files below are byte-identical between the two trees except this review, which exists only on C:.)
- **Reviewer:** Claude (FORGE Phase 4, adversarial), second context to the authoring session of 2026-09-27
- **Files reviewed:** `src/stellar/rail.ts`, `src/stellar/offset.ts`, `src/stellar/cli.ts`, `src/factors.ts`, `well-known/stellar.toml`, `classes/ukco2.example.json`, `batches/batch.example.json`, README § "Carbon Rail on Stellar"
- **Tests written:** `test/rail.test.ts` (24), `test/offset.test.ts` (12), `test/cli-args.test.ts` (5) = 41 new; plus pre-existing `test/accounts.test.ts` (19) = 60 total, 14 `describe` suites (matches `npm test`: tests 60 / suites 14)
- **Source changed by reviewer:** `src/stellar/rail.ts`, `src/stellar/cli.ts`, new `src/stellar/args.ts`. Every change is tied to a test that was RED before it (noted per finding).
- **Not touched:** `package.json`, `.gitignore`, `scripts/`, `test/accounts.test.ts`, `README.md`, `well-known/stellar.toml`, anything on D:\
- **SDK verified on disk (item 9):** `@stellar/stellar-sdk` 13.3.0 / `@stellar/stellar-base` 13.1.0. `Operation.clawback` (`types/index.d.ts:854`), `Operation.setTrustLineFlags` (`:874`), `AuthClawbackEnabledFlag: 8` (`:255`), `SetOptions.setFlags?: AuthFlag` (`:472`) all present.

## Security properties — how each was EXERCISED

| Property | Exercised by |
|---|---|
| P1 never signs without `STELLAR_SECRET_<ROLE>` | `rail.test.ts › maybeSign`: env unset → `signed=false`, decoded XDR has 0 signatures; env = `Keypair.random().secret()` → 1 signature, `Keypair.fromPublicKey(pub).verify(tx.hash(), sig)` true and false for a different key; empty-string env → treated as absent. Env restored in `finally`. |
| P2 memo commits to record bytes | `rail.test.ts › buildMint / buildRetire`: memo == `sha256(canonicalJson(record))`; mutate one field (`tonnes`, `agentId`) → memo differs; reorder keys → memo identical. |
| P3 `toAmount` valid Stellar amount | `rail.test.ts › toAmount`: regex `^(0|[1-9]\d*)(\.\d{1,7})?$` over 9 awkward inputs (`0.1+0.2`, `1e9`, `1234.56789012`, `1e-8`, `3.9999999999`…); `Number(out) <= input` (floor); `-1`, `NaN`, `Infinity` throw. |
| P4 demo prints no secret | Demo stdout and `out/stellar/demo-report.json` grepped for `S[A-Z2-7]{55}` → 0 / 0. `grep "\.secret(" src/stellar/*.ts` → no matches. See M-8. |

---

## Findings

### Critical (both fixed on branch)

**C-1 — `buildIssuerSetup` capped manage_data values in CHARACTERS, not BYTES → build-time throw on non-ASCII methodology/registry.** `rail.ts` (orig. lines 65-66) used `.slice(0, 64)`. `manage_data.js:33` in stellar-base 13.1.0 enforces `dataValue.length > 64` on the UTF-8 **Buffer** and throws `value cannot be longer that 64 bytes`. Failure path: `npm run stellar:issue --submit` with a registry name like `"Méthodologie BCarbon MEEWP v2.1 — capture de méthane"` loads both accounts, then throws inside `buildIssuerSetup` — before anything is submitted in the current plan order, but any future reordering (or a class file edited after a partial run) leaves the flow half-applied. **Fix:** `utf8Cap(s, 64)` iterates code points and stops before exceeding 64 bytes, so no code point is split. Test: 80 × `é` (160 bytes) → value ≤ 64 bytes, decodes without U+FFFD. RED (SDK threw) → GREEN.

**C-2 — Memo hash = `sha256(JSON.stringify(record))`, insertion-order dependent → a verifier cannot reproduce the on-chain memo from the published record.** `rail.ts` orig. 88, 109; `cli.ts` orig. 121, 131. A retirement record re-serialised from a DB row, spreadsheet export, or Python `json.dumps` will in general order keys differently and hash differently — the exact failure a carbon-retirement audit would hit, on a claims=REGULATED surface ("retirement record hash as memo"). **Fix:** `canonicalJson()` — recursive sorted keys, no whitespace, `undefined` props dropped, `[undefined]` → `[null]` (matches `JSON.stringify`). Used in `buildMint`, `buildRetire`, and both CLI hash printouts so `batchHash` / `recordHash` equal the memo bytes. Tests: reorder → identical memo; one field changed → different. Follow-up (not code): publish the canonical form in the public record spec.

### Important

**I-1 — `issue()` sequence handling (item 1): NOT a duplicate-sequence Critical.** Verified from SDK source, `node_modules/@stellar/stellar-base/lib/transaction_builder.js:623`: `build()` sets the tx sequence to `source.sequenceNumber()+1` then calls `this.source.incrementSequenceNumber()`. So `authorize-treasury` and `mint`, built from the same `issuer2` object, carry consecutive sequences. Cases: (a) no `--submit`: `issuer2 === issuer`, so setup = N+1, authorize = N+2, mint = N+3 — correct **only if** all three are submitted in that order; a wallet submitting `mint.xdr` alone gets `tx_bad_seq`. (b) `--submit`: issuer reloaded after setup (Horizon seq N+1) → authorize N+2, mint N+3 — correct. (c) treasury `Account` used once — correct. **Recommend (not fixed, operator-UX decision):** write `out/stellar/plan.json` listing submission order and each tx's sequence; or refuse to write unsigned XDRs for more than one tx per source account without `--seq-start`.

**I-2 — `.setTimeout(0)` (item 3): unsigned XDRs on disk are valid forever.** `rail.ts` builder. Sequence numbers prevent *replay* of a submitted tx, not *late first submission*. A stale `mint.xdr` for 500 t signed months later mints against a batch that may since have been invalidated (F-4). **Recommend:** default `TIMEOUT_SEC = 3600` for the unsigned-for-wallet path with `--timeout 0` as an explicit opt-in for multisig ceremonies; then assert `timeBounds.maxTime > 0` in tests. Not fixed — changes operator behaviour; Kevan's call (a 1-hour bound breaks a ceremony that takes a day).

**I-3 — `well-known/stellar.toml` REGULATED strings (item 7) — founder-gated F-3, file not edited.** `regulated = true`, `is_asset_anchored = true`, `anchor_asset = "Verified carbon credits …"`, `ORG_PHYSICAL_ADDRESS = "5655 Peachtree Pkwy NW, Norcross, GA 30099"` (a deal property in memory, not a verified UnyKorn LLC address — UNVERIFIED). Additional technical point: SEP-1 `regulated = true` tells wallets to expect a SEP-8 `approval_server`; none is listed and none exists, so compliant wallets will refuse to build payments for UKCO2. Either build the SEP-8 approval flow or drop `regulated = true` before the file is ever served. Counsel + marketing-copy ADR first.

**I-4 — `toAmount` emitted invalid amounts for negative / NaN / Infinity, and floored IEEE-754 noise into real mass loss.** Original returned `"-1"`, `"NaN"`, `"Infinity"` (fail only later, inside the SDK, with an unrelated message). Separately — found by `offset.test.ts` — `quoteOffset(1000, "SRSO").tonnes` returned `"0.4089999"`: `409/1000*1e7 = 4089999.9999999995`, floored. That drops 0.1 g to float representation, not to measurement, and on a 1 GWh quote the displayed `"409"` t only appears because the noise happened to fall the other way. **Fix:** throws on non-finite/negative; computes in integer stroops and snaps to the nearest stroop when within 1e-6 stroop (1e-13 t) of it, floors otherwise. Tests: `toAmount(1000*0.409/1000) === "0.409"`, `toAmount(0.40899999) === "0.4089999"` (genuine sub-stroop mass still floors), floor invariant over 9 inputs. RED → GREEN.

**I-5 — `buildRetire` trusted `rec.tonnes` verbatim.** The memo commits to the *string*; the SDK's BigNumber parser accepts `"1e-7"` and encodes the same on-chain amount as `"0.0000001"` → two different memos for one on-chain retirement. **Fix:** `assertAmount()` — canonical regex and `> 0`. Tests: `"1e-7"`, `"-1"`, `"0"` throw.

**I-6 — `serialRoot` / `dataRoomHash` accepted anything.** `Buffer.from(h, "hex")` silently stops at the first non-hex char and accepts any length, so a typo becomes a short or empty on-chain proof entry. **Fix:** `hex32()` requires exactly 64 hex chars. Tests: `"abc"` and `"zz"×32` throw.

### Minor

**M-1 — `setFlags: (…) as any` (item 4).** SDK type is `setFlags?: AuthFlag` where `AuthFlag = 1|2|4|8` (a union of single flags, which is why the OR'd 11 needed a cast). Replaced with `as AuthFlag`, which still compiles and is narrower than `any`. `AuthImmutableFlag` (4) is deliberately excluded and now **asserted absent** in the test: setting it makes the flag set and `homeDomain` permanent — the issuer could never recover from a mistaken flag or move the SEP-1 domain. Keep excluded.

**M-2 — `submit()` / `loadAccount()` error paths (item 5).** Horizon 400 bodies echo `extras.envelope_xdr` (the signed envelope — public once submitted, but noisy); now prints `result_codes ?? title ?? detail`. `res.json()` failure no longer masks the HTTP status. `loadAccount` treated every non-2xx as "not found"; it now distinguishes 404 / 429 ("rate limited; retry later") / other, and checks `sequence` is a string. No secret can reach either path.

**M-3 — Flooring loss in `OffsetMeter` (correctness question, measured).** Per retirement the floor drops `< 1e-7 t`. Over the demo's 1,000 calls: `exactKg = 0.423627`, `retiredKg = 0.423500`, **under-retirement = 0.127 g (0.0299 %)** across 3 retirements (≈0.042 g each, i.e. 4.2e-8 t < 1e-7 t). Direction is conservative (never over-claims). Recommend carrying each agent's sub-stroop remainder into its next batch so the shortfall does not accumulate across thousands of batches. Not fixed.

**M-4 — Demo never exercises the threshold path.** `crossed-threshold retirements: 0`; all 3 demo retirements are end-of-run `flush()` calls (`base:95721` 0.0003884 t / 334 calls, `base:120044` 0.0000302 t / 571 calls, `base:131377` 0.0000049 t / 95 calls). The README's "13 transactions" therefore depends on there being exactly 3 agents, not on the meter logic. The threshold path is covered by `offset.test.ts` (12 sub-threshold nulls, 13th call flushes with all 13 refs). Consider raising demo kWh so at least one threshold flush happens.

**M-5 — `record()` recomputes the batch kg on every call (O(n²) per batch).** Fine at ~600 calls/batch; cache the running total if batches grow.

**M-6 — `classes/ukco2.example.json` roots are all-zero.** Still valid 64-hex, so a copied example issues unchanged. Consider rejecting all-zero roots in `issue()`.

**M-7 — README "13 Stellar transactions built" (item 10): confirmed.** 7 `add(` call sites in `demo()`: 1 issuer setup + 3×(trustline + authorize) + 1 mint + 1 fund + `min(3, retirements)` retire + 1 clawback = 13 iff `retirements.length >= 3`. Demo run: 13 step lines, each `sigs=1`. README numbers (1.08 kWh, 0.42 kg, $0.007, $0.000018/call, 409 t / $6,135 per GWh) match the run.

**M-8 — P4 grep proof (item 6).** `grep -n "\.secret(" src/stellar/*.ts` → none. Only `secret` reference is `process.env[...]` inside `maybeSign`, which never returns it. `console.log` sites: `cli.ts:91` (report: labels, op types, memo prefix, sig counts, public keys), `:122` (asset id, batch hash, results), `:132` (record hash, signed flag, tx hash). `console.error(e.message)`: `Keypair.fromSecret` on malformed input throws `invalid encoded string` — does not echo the input. Demo stdout and `out/stellar/demo-report.json`: 0 matches for `S[A-Z2-7]{55}`.

**M-9 — `factors.ts` key (item 8).** `OFFSET_PRICE_USD_PER_TCO2E.methane_capture = { low: 8, high: 22 }` exists (`src/factors.ts`). No import-time crash; test asserts the key and midpoint 15. Price basis itself stays founder-gated (F-5).

**M-10 — `cli.ts` arg parser extracted to `src/stellar/args.ts` (`parseArgs`)**, not into `cli.ts` as suggested, because importing `cli.ts` runs `mkdirSync("out/stellar")` and the command dispatcher at module load. Behaviour is unchanged (same expression); 5 tests including trailing flag, flag-then-flag, positional ignored, last-wins.

---

## Verdict: **merge-with-fixes**

Both Criticals are fixed on the branch with tests. Merge to `main` remains blocked by founder flags F-1..F-5 (unchanged by this review). Before any `--submit`, resolve I-1 (submission-order artefact) and I-2 (timeout default) — both are one-line decisions for Kevan, not engineering risk. I-3 (SEP-8 / `regulated = true`) must be settled before `stellar.toml` is ever served.

---

## Verification — commands run on C:\Users\Kevan\dev\platforms\UnyKorn-Carbon, real output

```
$ npm test
  ℹ retirements=3 exactKg=0.423627 retiredKg=0.423500 underRetiredKg=0.000127 (0.0299%)
ℹ tests 60
ℹ suites 14
ℹ pass 60
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 790.9165
exit=0
```
(First run before fixes: `pass 54 / fail 5` — 3 decode-formatting expectation errors in my tests, 1 test-math error in the two-agent case, and the real `0.4089999` defect in I-4.)

```
$ npm run typecheck
> tsc --noEmit
exit=0
```

```
$ npm run stellar:demo        (exit=0; tail)
    "calls": 1000,
    "totalKwh": 1.0818,
    "retirements": 3,
    "retiredTonnes": 0.0004235,
    "retiredKg": 0.423,
    "offsetSurchargeUsd": 0.007
  "exampleX402Challenge": { "maxAmountRequired": "0.001018", … "offsetUsd": 0.000018 … }
  "quoteAt1GWh": { "kgCO2e": 409000, "tonnes": "409", "usd": 6135 }
steps (13):
"Issuer: regulated flags + proof entries [setOptions,manageData,manageData,manageData,manageData] sigs=1"
"Treasury: trustline [changeTrust] sigs=1"
"Issuer: KYB-authorize Treasury [setTrustLineFlags] sigs=1"
"Offtake buyer: trustline [changeTrust] sigs=1"
"Issuer: KYB-authorize Offtake buyer [setTrustLineFlags] sigs=1"
"Agent operator: trustline [changeTrust] sigs=1"
"Issuer: KYB-authorize Agent operator [setTrustLineFlags] sigs=1"
"Issuer: MINT 500 t to treasury (memo = batch hash) [payment] sigs=1"
"Treasury: fund agent operator 1 t offset inventory [payment] sigs=1"
"Agent operator: RETIRE 0.0003884 t for base:95721 [payment] sigs=1"
"Agent operator: RETIRE 0.0000302 t for base:120044 [payment] sigs=1"
"Agent operator: RETIRE 0.0000049 t for base:131377 [payment] sigs=1"
"Issuer: CLAWBACK 1 t from buyer (example: invalidated batch) [clawback] sigs=1"
$ grep -cE "S[A-Z2-7]{55}" demo-stdout out/stellar/demo-report.json   → 0, 0
```

SDK source checks (node_modules on C:):
```
stellar-sdk 13.3.0 / stellar-base 13.1.0
lib/transaction_builder.js:623   this.source.incrementSequenceNumber();      (I-1)
lib/operations/manage_data.js:33 if (dataValue.length > 64) throw 'value cannot be longer that 64 bytes'  (C-1)
types/index.d.ts:472             setFlags?: AuthFlag;                          (M-1)
types/index.d.ts:854 / :874      function clawback( / function setTrustLineFlags(   (item 9)
```

Nothing committed; nothing on D:\ touched after the move.
