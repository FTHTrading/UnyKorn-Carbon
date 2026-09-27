/**
 * UnyKorn Carbon Rail CLI (Stellar)
 *
 *   npm run stellar:demo                          offline end-to-end run: builds + signs every tx with throwaway keys, meters 1,000 agent calls
 *   npm run stellar:issue  -- --net testnet --class classes/ukco2.json --batch batches/b1.json
 *   npm run stellar:retire -- --net testnet --class classes/ukco2.json --record out/retirement.json
 *
 * issue/retire read public keys from the class file. Signing:
 *   - set STELLAR_SECRET_ISSUER / STELLAR_SECRET_TREASURY in your shell (never in files) to sign locally, or
 *   - leave them unset and sign the XDRs written to out/stellar/ in your wallet or command hub.
 *   Add --submit to post signed XDRs to Horizon.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Account, Asset, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  CreditClass, Net, PASSPHRASE, buildAuthorize, buildIssuerSetup, buildMint, buildRetire, buildTrustline,
  buildClawback, loadAccount, maybeSign, sha256hex, submit, RetirementRecord, canonicalJson,
} from "./rail.ts";
import { OffsetMeter, x402PriceWithOffset, quoteOffset, MeteredCall } from "./offset.ts";
import { parseArgs } from "./args.ts";

const args = parseArgs(process.argv.slice(3));
const cmd = process.argv[2];
const OUT = "out/stellar";
mkdirSync(OUT, { recursive: true });
const decode = (xdr: string, net: Net) => TransactionBuilder.fromXDR(xdr, PASSPHRASE[net]);

async function demo() {
  const net: Net = "testnet";
  // Throwaway keys that exist only in memory for this offline run. Secrets are never printed or saved.
  const issuerKp = Keypair.random(), treasuryKp = Keypair.random(), buyerKp = Keypair.random(), agentOpKp = Keypair.random();
  const acct = (kp: Keypair) => new Account(kp.publicKey(), "0");
  const klass: CreditClass = {
    code: "UKCO2", issuer: issuerKp.publicKey(), homeDomain: "carbon.unykorn.ai",
    methodology: "BCarbon MEEWP v2.1 (example)", registry: "UnyKorn Harbor",
    serialRoot: sha256hex("example serials OK-2026-000001..000500"), dataRoomHash: sha256hex("example data room v1"),
  };
  const steps: any[] = [];
  const add = (label: string, kp: Keypair, tx: any) => {
    tx.sign(kp);
    const back = decode(tx.toXDR(), net) as any;
    steps.push({ label, source: back.source, ops: back.operations.map((o: any) => o.type), memo: back.memo.type === "none" ? null : (back.memo.type === "hash" ? `hash:${Buffer.from(back.memo.value).toString("hex").slice(0, 16)}…` : `${back.memo.type}:${back.memo.value}`), signatures: back.signatures.length, xdrBytes: tx.toXDR().length });
  };

  add("Issuer: regulated flags + proof entries", issuerKp, buildIssuerSetup(acct(issuerKp), klass, net));
  for (const [who, kp] of [["Treasury", treasuryKp], ["Offtake buyer", buyerKp], ["Agent operator", agentOpKp]] as const) {
    add(`${who}: trustline`, kp, buildTrustline(acct(kp), klass, net));
    add(`Issuer: KYB-authorize ${who}`, issuerKp, buildAuthorize(acct(issuerKp), klass, kp.publicKey(), true, net));
  }
  const batch = { batch: "OK-2026-B1", serials: "OK-2026-000001..000500", tonnes: 500, lockedAt: "registry lock evidence hash" };
  add("Issuer: MINT 500 t to treasury (memo = batch hash)", issuerKp, buildMint(acct(issuerKp), klass, treasuryKp.publicKey(), 500, batch, net));

  // Meter 1,000 paid machine calls from three ERC-8004 agents across regions
  const meter = new OffsetMeter(`${klass.code}:${klass.issuer}`, 0.0005);
  const endpoints = [
    { endpoint: "/v1/chat/completions", kwh: 0.0029, region: "ERCT" },   // large-model inference (example estimate)
    { endpoint: "/defi/yields", kwh: 0.00004, region: "SRSO" },         // data read
    { endpoint: "/web/extract", kwh: 0.0003, region: "RFCE" },          // crawl + parse
  ];
  const agents = ["base:95721", "base:120044", "base:131377"];
  const retirements: RetirementRecord[] = [];
  let totalKwh = 0, calls = 0, surchargeUsd = 0;
  for (let i = 0; i < 1000; i++) {
    const e = endpoints[i % 3], agentId = agents[i % 3 === 0 ? 0 : i % 7 === 0 ? 2 : 1];
    const call: MeteredCall = { paymentRef: `0x${sha256hex(`pay${i}`).slice(0, 16)}`, rail: i % 5 === 0 ? "mpp" : "x402", agentId, endpoint: e.endpoint, kwh: e.kwh, gridRegion: e.region, at: new Date().toISOString() };
    totalKwh += e.kwh; calls++;
    surchargeUsd += Number(x402PriceWithOffset(0.001, e.kwh, e.region).breakdown.offsetUsd);
    const r = meter.record(call);
    if (r) retirements.push(r);
  }
  for (const a of meter.pending()) { const r = meter.flush(a); if (r) retirements.push(r); }

  // Treasury moves offset inventory to the agent operator, which retires on the agents' behalf
  const retiredT = retirements.reduce((s, r) => s + Number(r.tonnes), 0);
  const fund = new TransactionBuilder(acct(treasuryKp), { fee: "1000", networkPassphrase: PASSPHRASE[net] }).setTimeout(0)
    .addOperation(Operation.payment({ destination: agentOpKp.publicKey(), asset: new Asset(klass.code, klass.issuer), amount: "1" })).build();
  add("Treasury: fund agent operator 1 t offset inventory", treasuryKp, fund);
  retirements.forEach((r, i) => i < 3 && add(`Agent operator: RETIRE ${r.tonnes} t for ${r.agentId}`, agentOpKp, buildRetire(acct(agentOpKp), klass, r, net)));
  add("Issuer: CLAWBACK 1 t from buyer (example: invalidated batch)", issuerKp, buildClawback(acct(issuerKp), klass, buyerKp.publicKey(), 1, "batch OK-2026-B1 partial invalidation (example)", net));

  const example = x402PriceWithOffset(0.001, 0.0029, "ERCT");
  const report = {
    network: "stellar testnet (offline build: every transaction built, signed and decoded; not submitted)",
    asset: `${klass.code}:${klass.issuer}`, issuerFlags: ["AUTH_REQUIRED", "AUTH_REVOCABLE", "AUTH_CLAWBACK_ENABLED"],
    steps, metering: { calls, totalKwh: Number(totalKwh.toFixed(4)), retirements: retirements.length, retiredTonnes: Number(retiredT.toFixed(7)),
      retiredKg: Number((retiredT * 1000).toFixed(3)), offsetSurchargeUsd: Number(surchargeUsd.toFixed(4)) },
    exampleX402Challenge: example, sampleRetirement: retirements[0],
    quoteAt1GWh: quoteOffset(1_000_000, "SRSO"),
  };
  writeFileSync(`${OUT}/demo-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, steps: steps.map(s => `${s.label} [${s.ops.join(",")}] sigs=${s.signatures}`) }, null, 2));
}

async function issue() {
  const net = (args.net ?? "testnet") as Net;
  const klass: CreditClass & { treasury: string } = JSON.parse(readFileSync(args.class, "utf8"));
  if (!args.batch) throw new Error("--batch is required: every minted unit maps to a batch record (serial range, registry, lock evidence)");
  const batch = JSON.parse(readFileSync(args.batch, "utf8"));
  for (const k of ["batch", "serials", "tonnes", "registry", "lockEvidence"]) if (batch[k] === undefined) throw new Error(`batch file missing "${k}"`);
  const issuer = await loadAccount(klass.issuer, net);
  const treasury = await loadAccount(klass.treasury, net);
  const plan = [
    ["issuer-setup", "ISSUER", buildIssuerSetup(issuer, klass, net)],
    ["treasury-trustline", "TREASURY", buildTrustline(treasury, klass, net)],
  ] as const;
  const results: any[] = [];
  for (const [name, role, tx] of plan) {
    const { signed, xdr } = maybeSign(tx as any, role);
    writeFileSync(`${OUT}/${name}.xdr`, xdr);
    results.push({ name, signed, hash: signed && args.submit ? await submit(xdr, net) : null });
  }
  // sequence numbers advanced above only if submitted; reload before issuer's next txs
  const issuer2 = args.submit ? await loadAccount(klass.issuer, net) : issuer;
  for (const [name, tx] of [
    ["authorize-treasury", buildAuthorize(issuer2, klass, klass.treasury, true, net)],
    ["mint", buildMint(issuer2, klass, klass.treasury, Number(batch.tonnes), batch, net)],
  ] as const) {
    const { signed, xdr } = maybeSign(tx as any, "ISSUER");
    writeFileSync(`${OUT}/${name}.xdr`, xdr);
    results.push({ name, signed, hash: signed && args.submit ? await submit(xdr, net) : null });
  }
  console.log(JSON.stringify({ net, asset: `${klass.code}:${klass.issuer}`, batchHash: sha256hex(canonicalJson(batch)), results, xdrDir: OUT }, null, 2));
}

async function retire() {
  const net = (args.net ?? "testnet") as Net;
  const klass: CreditClass & { treasury: string } = JSON.parse(readFileSync(args.class, "utf8"));
  const rec: RetirementRecord = JSON.parse(readFileSync(args.record, "utf8"));
  const holder = await loadAccount(args.holder ?? klass.treasury, net);
  const { signed, xdr } = maybeSign(buildRetire(holder, klass, rec, net) as any, args.role ?? "TREASURY");
  writeFileSync(`${OUT}/retire.xdr`, xdr);
  console.log({ recordHash: sha256hex(canonicalJson(rec)), signed, hash: signed && args.submit ? await submit(xdr, net) : null });
}

({ demo, issue, retire } as Record<string, () => Promise<void>>)[cmd]?.().catch(e => { console.error(e.message); process.exit(1); })
  ?? console.log("commands: demo | issue | retire");
