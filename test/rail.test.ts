import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Account, Keypair, Networks, TransactionBuilder, Transaction } from "@stellar/stellar-sdk";
import {
  toAmount, sha256, sha256hex, PASSPHRASE, canonicalJson,
  buildIssuerSetup, buildTrustline, buildAuthorize, buildMint, buildRetire, buildClawback,
  maybeSign, type CreditClass, type RetirementRecord, type Net,
} from "../src/stellar/rail.ts";

// Offline only: throwaway keys, sequence "0", no Horizon.
const issuerKp = Keypair.random();
const treasuryKp = Keypair.random();
const holderKp = Keypair.random();
const acct = (kp: Keypair) => new Account(kp.publicKey(), "0");
const klass: CreditClass = {
  code: "UKCO2",
  issuer: issuerKp.publicKey(),
  homeDomain: "carbon.unykorn.ai",
  methodology: "BCarbon MEEWP v2.1 (example)",
  registry: "UnyKorn Harbor",
  serialRoot: sha256hex("serials"),
  dataRoomHash: sha256hex("data room"),
};
const decode = (tx: Transaction, net: Net = "testnet") =>
  TransactionBuilder.fromXDR(tx.toXDR(), PASSPHRASE[net]) as Transaction;
const AMOUNT_RE = /^(0|[1-9]\d*)(\.\d{1,7})?$/; // valid Stellar amount string: no exponent, no sign, <= 7 decimals
// fromXDR renders amounts with 7 decimals ("500.0000000"); compare decoded amounts numerically.
const sameAmount = (decoded: string, expected: string) => assert.equal(Number(decoded), Number(expected), `${decoded} vs ${expected}`);

describe("toAmount (P3)", () => {
  test("integers and exact 7-decimal values round-trip", () => {
    assert.equal(toAmount(500), "500");
    assert.equal(toAmount(0.0000001), "0.0000001");
    assert.equal(toAmount(1), "1");
  });
  test("below 7-decimal resolution floors to 0", () => {
    assert.equal(toAmount(1e-8), "0");
    assert.equal(toAmount(0.00000009), "0");
  });
  test("never more than 7 decimals, never exponent, never negative, never rounds up", () => {
    for (const v of [1234.56789012, 0.1 + 0.2, 1e9, 1e9 + 0.12345678, 0.000123456789, 3.9999999999, 1e-7, 5e-8, 12345678.9]) {
      const s = toAmount(v);
      assert.match(s, AMOUNT_RE, `toAmount(${v}) = ${s}`);
      assert.ok(!s.includes("e"), `no exponent notation: ${s}`);
      assert.ok(!s.startsWith("-"), `not negative: ${s}`);
      assert.ok(Number(s) <= v + 1e-12, `floor, not round-up: ${s} <= ${v}`);
      assert.ok(v - Number(s) < 1e-7, `drops less than one stroop of mass: ${v} -> ${s}`);
    }
  });
  test("float representation noise snaps to the stroop instead of flooring a real 0.1 g away", () => {
    assert.equal(toAmount(1000 * 0.409 / 1000), "0.409"); // 4089999.9999999995 stroops
    assert.equal(toAmount(0.1 + 0.2), "0.3");
    assert.equal(toAmount(0.40899999), "0.4089999"); // genuine sub-stroop mass still floors
  });
  test("very large values are valid amounts (no exponent) and floor holds", () => {
    assert.equal(toAmount(1e9), "1000000000");
    assert.equal(toAmount(0.1 + 0.2), "0.3");
  });
  test("negative or non-finite input is rejected rather than emitted as an amount", () => {
    assert.throws(() => toAmount(-1));
    assert.throws(() => toAmount(NaN));
    assert.throws(() => toAmount(Infinity));
  });
});

describe("canonicalJson", () => {
  test("key order does not change the bytes; values do", () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } });
    const b = canonicalJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 });
    assert.equal(a, b);
    assert.equal(a, '{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}');
    assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
  });
});

describe("common tx invariants", () => {
  const rec: RetirementRecord = { kind: "retirement", asset: `UKCO2:${klass.issuer}`, tonnes: "0.001", beneficiary: "b", purpose: "p", at: "2026-09-27T00:00:00Z" };
  const all = (net: Net) => [
    buildIssuerSetup(acct(issuerKp), klass, net),
    buildTrustline(acct(holderKp), klass, net),
    buildAuthorize(acct(issuerKp), klass, holderKp.publicKey(), true, net),
    buildMint(acct(issuerKp), klass, treasuryKp.publicKey(), 500, { x: 1 }, net),
    buildRetire(acct(holderKp), klass, rec, net),
    buildClawback(acct(issuerKp), klass, holderKp.publicKey(), 1, "r", net),
  ];
  test("fee == 1000 * opCount; passphrase follows net", () => {
    for (const tx of all("testnet")) {
      assert.equal(tx.fee, String(1000 * tx.operations.length));
      assert.equal(tx.networkPassphrase, Networks.TESTNET);
      assert.doesNotThrow(() => TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET));
    }
    for (const tx of all("mainnet")) {
      assert.equal(tx.networkPassphrase, Networks.PUBLIC);
      assert.doesNotThrow(() => TransactionBuilder.fromXDR(tx.toXDR(), Networks.PUBLIC));
    }
  });
  test("every built tx is unsigned (0 signatures)", () => {
    for (const tx of all("testnet")) assert.equal(decode(tx).signatures.length, 0);
  });
});

describe("buildIssuerSetup", () => {
  test("5 ops: setOptions with AuthRequired|AuthRevocable|AuthClawbackEnabled + homeDomain, then 4 manageData proofs", () => {
    const tx = decode(buildIssuerSetup(acct(issuerKp), klass, "testnet"));
    assert.equal(tx.operations.length, 5);
    const op0 = tx.operations[0] as any;
    assert.equal(op0.type, "setOptions");
    assert.equal(op0.setFlags, 1 | 2 | 8);
    assert.equal(op0.setFlags & 4, 0, "AUTH_IMMUTABLE must not be set (would lock the flags forever)");
    assert.equal(op0.homeDomain, klass.homeDomain);
    const names = tx.operations.slice(1).map((o: any) => o.name);
    assert.deepEqual(names, ["UKCO2:methodology", "UKCO2:registry", "UKCO2:serialRoot", "UKCO2:dataRoom"]);
    for (const o of tx.operations.slice(1) as any[]) assert.equal(o.type, "manageData");
    const root = (tx.operations[3] as any).value as Buffer;
    const room = (tx.operations[4] as any).value as Buffer;
    assert.equal(root.length, 32);
    assert.equal(room.length, 32);
    assert.equal(Buffer.from(root).toString("hex"), klass.serialRoot);
    assert.equal(Buffer.from(room).toString("hex"), klass.dataRoomHash);
  });
  test("methodology/registry values are capped at 64 BYTES even for long multi-byte strings", () => {
    const long = "é".repeat(80); // 80 chars, 160 bytes in UTF-8
    const c = { ...klass, methodology: long, registry: "ü".repeat(40) + "x".repeat(40) };
    const tx = decode(buildIssuerSetup(acct(issuerKp), c, "testnet"));
    const meth = Buffer.from((tx.operations[1] as any).value);
    const reg = Buffer.from((tx.operations[2] as any).value);
    assert.ok(meth.length <= 64, `methodology ${meth.length} bytes`);
    assert.ok(reg.length <= 64, `registry ${reg.length} bytes`);
    // Byte cap must not split a multi-byte code point (decoded text is still well-formed).
    assert.ok(!meth.toString("utf8").includes("�"));
    assert.ok(!reg.toString("utf8").includes("�"));
  });
  test("malformed hex roots are rejected instead of silently shortened", () => {
    assert.throws(() => buildIssuerSetup(acct(issuerKp), { ...klass, serialRoot: "abc" }, "testnet"));
    assert.throws(() => buildIssuerSetup(acct(issuerKp), { ...klass, dataRoomHash: "zz".repeat(32) }, "testnet"));
  });
});

describe("buildTrustline", () => {
  test("one changeTrust op for the asset; default limit when none given", () => {
    const tx = decode(buildTrustline(acct(holderKp), klass, "testnet"));
    assert.equal(tx.operations.length, 1);
    const op = tx.operations[0] as any;
    assert.equal(op.type, "changeTrust");
    assert.equal(op.line.code, "UKCO2");
    assert.equal(op.line.issuer, klass.issuer);
    assert.equal(op.limit, "922337203685.4775807"); // SDK default = max int64 / 1e7
    const lim = decode(buildTrustline(acct(holderKp), klass, "testnet", "1000")).operations[0] as any;
    sameAmount(lim.limit, "1000");
  });
});

describe("buildAuthorize", () => {
  test("authorized=true -> setTrustLineFlags authorized, memo 'KYB approved'", () => {
    const tx = decode(buildAuthorize(acct(issuerKp), klass, holderKp.publicKey(), true, "testnet"));
    const op = tx.operations[0] as any;
    assert.equal(op.type, "setTrustLineFlags");
    assert.equal(op.trustor, holderKp.publicKey());
    assert.equal(op.asset.code, "UKCO2");
    assert.equal(op.asset.issuer, klass.issuer);
    assert.equal(op.flags.authorized, true);
    assert.equal(tx.memo.type, "text");
    assert.equal(tx.memo.value?.toString(), "KYB approved");
  });
  test("authorized=false -> flag cleared, memo 'frozen'", () => {
    const tx = decode(buildAuthorize(acct(issuerKp), klass, holderKp.publicKey(), false, "testnet"));
    const op = tx.operations[0] as any;
    assert.equal(op.flags.authorized, false);
    assert.equal(tx.memo.value?.toString(), "frozen");
  });
});

describe("buildMint (P2)", () => {
  const batch = { batch: "OK-2026-B1", serials: "OK-2026-000001..000500", tonnes: 500, lockEvidence: "h" };
  test("payment to treasury of toAmount(t); memo hash == sha256(canonicalJson(batch))", () => {
    const tx = decode(buildMint(acct(issuerKp), klass, treasuryKp.publicKey(), 500, batch, "testnet"));
    assert.equal(tx.operations.length, 1);
    const op = tx.operations[0] as any;
    assert.equal(op.type, "payment");
    assert.equal(op.destination, treasuryKp.publicKey());
    sameAmount(op.amount, toAmount(500));
    assert.equal(op.asset.code, "UKCO2");
    assert.equal(tx.memo.type, "hash");
    const expect = createHash("sha256").update(canonicalJson(batch)).digest();
    assert.deepEqual(Buffer.from(tx.memo.value as Buffer), expect);
    assert.deepEqual(Buffer.from(tx.memo.value as Buffer), sha256(canonicalJson(batch)));
  });
  test("changing one batch field changes the memo; reordering keys does not", () => {
    const m1 = Buffer.from(decode(buildMint(acct(issuerKp), klass, treasuryKp.publicKey(), 500, batch, "testnet")).memo.value as Buffer);
    const m2 = Buffer.from(decode(buildMint(acct(issuerKp), klass, treasuryKp.publicKey(), 500, { ...batch, tonnes: 501 }, "testnet")).memo.value as Buffer);
    assert.notDeepEqual(m1, m2);
    const reordered = { lockEvidence: "h", tonnes: 500, serials: batch.serials, batch: batch.batch };
    const m3 = Buffer.from(decode(buildMint(acct(issuerKp), klass, treasuryKp.publicKey(), 500, reordered, "testnet")).memo.value as Buffer);
    assert.deepEqual(m1, m3);
  });
});

describe("buildRetire (P2)", () => {
  const rec: RetirementRecord = {
    kind: "retirement", asset: `UKCO2:${klass.issuer}`, tonnes: "0.0005123", beneficiary: "agent base:95721",
    purpose: "offset", agentId: "base:95721", paymentRefs: ["x402:0xabc"], energyKwh: 1.2, gridRegion: "ERCT", kgCO2e: 0.48, at: "2026-09-27T00:00:00Z",
  };
  test("destination is the ISSUER (burn); amount == rec.tonnes; memo == sha256(canonicalJson(rec))", () => {
    const tx = decode(buildRetire(acct(holderKp), klass, rec, "testnet"));
    const op = tx.operations[0] as any;
    assert.equal(op.type, "payment");
    assert.equal(op.destination, klass.issuer);
    sameAmount(op.amount, rec.tonnes);
    assert.equal(tx.memo.type, "hash");
    assert.deepEqual(Buffer.from(tx.memo.value as Buffer), sha256(canonicalJson(rec)));
  });
  test("mutating rec.agentId changes the memo", () => {
    const m1 = Buffer.from(decode(buildRetire(acct(holderKp), klass, rec, "testnet")).memo.value as Buffer);
    const m2 = Buffer.from(decode(buildRetire(acct(holderKp), klass, { ...rec, agentId: "base:1" }, "testnet")).memo.value as Buffer);
    assert.notDeepEqual(m1, m2);
  });
  test("a record whose tonnes is not a valid amount is rejected", () => {
    assert.throws(() => buildRetire(acct(holderKp), klass, { ...rec, tonnes: "1e-7" }, "testnet"));
    assert.throws(() => buildRetire(acct(holderKp), klass, { ...rec, tonnes: "-1" }, "testnet"));
    assert.throws(() => buildRetire(acct(holderKp), klass, { ...rec, tonnes: "0" }, "testnet"));
  });
});

describe("buildClawback", () => {
  test("one clawback op with from/asset/amount; memo == sha256(reason)", () => {
    const tx = decode(buildClawback(acct(issuerKp), klass, holderKp.publicKey(), 1.5, "invalidated", "testnet"));
    assert.equal(tx.operations.length, 1);
    const op = tx.operations[0] as any;
    assert.equal(op.type, "clawback");
    assert.equal(op.from, holderKp.publicKey());
    assert.equal(op.asset.code, "UKCO2");
    assert.equal(op.asset.issuer, klass.issuer);
    sameAmount(op.amount, "1.5");
    assert.deepEqual(Buffer.from(tx.memo.value as Buffer), sha256("invalidated"));
  });
});

describe("maybeSign (P1)", () => {
  const ENV = "STELLAR_SECRET_TESTROLE";
  test("without the env secret: signed=false and XDR has 0 signatures", () => {
    const prev = process.env[ENV];
    delete process.env[ENV];
    try {
      const tx = buildTrustline(acct(holderKp), klass, "testnet");
      const r = maybeSign(tx, "testrole");
      assert.equal(r.signed, false);
      assert.equal((TransactionBuilder.fromXDR(r.xdr, Networks.TESTNET) as Transaction).signatures.length, 0);
    } finally {
      if (prev !== undefined) process.env[ENV] = prev;
    }
  });
  test("with the env secret: signed=true, exactly 1 signature, and it verifies against that key", () => {
    const kp = Keypair.random();
    const prev = process.env[ENV];
    process.env[ENV] = kp.secret();
    try {
      const tx = buildTrustline(acct(holderKp), klass, "testnet");
      const r = maybeSign(tx, "TESTROLE");
      assert.equal(r.signed, true);
      const back = TransactionBuilder.fromXDR(r.xdr, Networks.TESTNET) as Transaction;
      assert.equal(back.signatures.length, 1);
      const sig = back.signatures[0].signature();
      assert.ok(Keypair.fromPublicKey(kp.publicKey()).verify(back.hash(), sig));
      // A different key must NOT verify.
      assert.ok(!Keypair.random().verify(back.hash(), sig));
    } finally {
      if (prev === undefined) delete process.env[ENV]; else process.env[ENV] = prev;
    }
  });
  test("an empty-string env value is treated as absent", () => {
    const prev = process.env[ENV];
    process.env[ENV] = "";
    try {
      const r = maybeSign(buildTrustline(acct(holderKp), klass, "testnet"), "testrole");
      assert.equal(r.signed, false);
    } finally {
      if (prev === undefined) delete process.env[ENV]; else process.env[ENV] = prev;
    }
  });
});
