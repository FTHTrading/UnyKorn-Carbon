import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GRID_KG_CO2_PER_KWH, OFFSET_PRICE_USD_PER_TCO2E } from "../src/factors.ts";
import { toAmount, sha256hex } from "../src/stellar/rail.ts";
import { OffsetMeter, quoteOffset, x402PriceWithOffset, type MeteredCall } from "../src/stellar/offset.ts";

const MID = (OFFSET_PRICE_USD_PER_TCO2E.methane_capture.low + OFFSET_PRICE_USD_PER_TCO2E.methane_capture.high) / 2;
const AMOUNT_RE = /^(0|[1-9]\d*)(\.\d{1,7})?$/;
const approx = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ~ ${b}`);

describe("quoteOffset", () => {
  test("price key methane_capture exists in factors (else PRICE is undefined at import)", () => {
    assert.ok(OFFSET_PRICE_USD_PER_TCO2E.methane_capture);
    assert.equal(MID, 15);
  });
  test("1000 kWh in SRSO: kg = 1000*0.409, tonnes = toAmount(0.409), usd = ceil(t*mid*1e6)/1e6", () => {
    const q = quoteOffset(1000, "SRSO");
    approx(q.kgCO2e, 1000 * 0.409);
    assert.equal(q.tonnes, toAmount(0.409));
    assert.equal(q.tonnes, "0.409");
    assert.equal(q.usd, Math.ceil(0.409 * MID * 1e6) / 1e6);
    assert.equal(q.usd, 6.135);
  });
  test("unknown region falls back to US_AVG", () => {
    const q = quoteOffset(10, "NOWHERE");
    approx(q.kgCO2e, 10 * GRID_KG_CO2_PER_KWH.US_AVG);
  });
  test("zero kWh -> usd 0, tonnes '0'", () => {
    const q = quoteOffset(0, "ERCT");
    assert.equal(q.usd, 0);
    assert.equal(q.tonnes, "0");
    assert.equal(q.kgCO2e, 0);
  });
  test("usd never rounds down (ceil to 1e-6)", () => {
    const q = quoteOffset(0.0029, "ERCT");
    const exactUsd = (0.0029 * 0.401 / 1000) * MID;
    assert.ok(q.usd >= exactUsd);
    assert.ok(q.usd - exactUsd < 1e-6);
  });
});

describe("x402PriceWithOffset", () => {
  test("(0.001, 0.0029, ERCT): maxAmountRequired has 6 decimals and equals service + offset", () => {
    const p = x402PriceWithOffset(0.001, 0.0029, "ERCT");
    assert.match(p.maxAmountRequired, /^\d+\.\d{6}$/);
    assert.equal(p.maxAmountRequired, (0.001 + p.breakdown.offsetUsd).toFixed(6));
    assert.equal(p.breakdown.offsetUsd, 0.000018);
    assert.equal(p.maxAmountRequired, "0.001018");
    assert.equal(p.breakdown.region, "ERCT");
    assert.equal(p.extra.retirementRail, "stellar");
    assert.equal(p.extra.carbonNeutral, true);
  });
  test("offsetUsd >= 1e-6 even for a 0-kWh call", () => {
    const p = x402PriceWithOffset(0.001, 0, "ERCT");
    assert.ok(p.breakdown.offsetUsd >= 0.000001);
    assert.equal(p.maxAmountRequired, "0.001001");
  });
});

describe("OffsetMeter", () => {
  const asset = "UKCO2:GISSUER";
  const call = (agentId: string, i: number, kwh = 0.1, region = "SRSO"): MeteredCall => ({
    paymentRef: `ref${i}`, rail: i % 2 ? "x402" : "mpp", agentId, endpoint: "/e", kwh, gridRegion: region, at: "2026-09-27T00:00:00Z",
  });

  test("calls below threshold return null and stay pending; the crossing call flushes with EVERY ref", () => {
    const m = new OffsetMeter(asset, 0.0005);
    // 0.1 kWh * 0.409 = 0.0409 kg = 4.09e-5 t per call; 13 calls = 5.317e-4 t >= 5e-4.
    for (let i = 0; i < 12; i++) {
      assert.equal(m.record(call("base:1", i)), null, `call ${i} below threshold`);
      assert.deepEqual(m.pending(), ["base:1"]);
    }
    const r = m.record(call("base:1", 12));
    assert.ok(r);
    assert.equal(r.kind, "retirement");
    assert.equal(r.asset, asset);
    assert.equal(r.agentId, "base:1");
    assert.equal(r.paymentRefs?.length, 13);
    for (let i = 0; i < 13; i++) assert.ok(r.paymentRefs!.includes(`${i % 2 ? "x402" : "mpp"}:ref${i}`), `ref${i} present`);
    assert.match(r.tonnes, AMOUNT_RE);
    assert.ok(Number(r.tonnes) >= 0.0005);
    approx(r.energyKwh!, 1.3, 1e-6);
    approx(r.kgCO2e!, 13 * 0.0409, 1e-6);
    assert.equal(r.gridRegion, "SRSO");
    assert.deepEqual(m.pending(), []);
    assert.equal(m.flush("base:1"), null, "nothing left after flush");
  });

  test("flush on an unknown agent returns null", () => {
    const m = new OffsetMeter(asset, 0.0005);
    assert.equal(m.flush("nobody"), null);
  });

  test("two agents are batched independently; regions are listed unique", () => {
    const m = new OffsetMeter(asset, 0.0005);
    // B: 11 x 0.0401 kg (ERCT) + 1 x 0.0409 kg (SRSO) = 0.482 kg < 0.5 kg threshold -> stays pending.
    for (let i = 0; i < 12; i++) { m.record(call("A", i)); if (i < 11) m.record(call("B", 100 + i, 0.1, "ERCT")); }
    assert.equal(m.record(call("B", 200, 0.1, "SRSO")), null);
    assert.deepEqual(m.pending().sort(), ["A", "B"]);
    const rA = m.record(call("A", 12));
    assert.ok(rA);
    assert.equal(rA.paymentRefs?.length, 13);
    assert.ok(rA.paymentRefs!.every(p => /ref(\d|1[0-2])$/.test(p)), "A never receives B's refs");
    assert.deepEqual(m.pending(), ["B"]);
    const rB = m.flush("B");
    assert.ok(rB);
    assert.equal(rB.paymentRefs?.length, 12);
    assert.equal(rB.gridRegion, "ERCT,SRSO");
    assert.deepEqual(m.pending(), []);
  });

  test("manual flush below threshold still returns a record covering all calls", () => {
    const m = new OffsetMeter(asset, 1);
    m.record(call("C", 1)); m.record(call("C", 2));
    const r = m.flush("C");
    assert.ok(r);
    assert.equal(r.paymentRefs?.length, 2);
    assert.match(r.tonnes, AMOUNT_RE);
  });

  test("mass accounting: toAmount flooring drops < 1e-7 t per retirement; cumulative under-retirement over the demo's 1,000 calls is reported", (t) => {
    // Mirrors the demo loop in src/stellar/cli.ts so the number below is the demo's number.
    const m = new OffsetMeter(asset, 0.0005);
    const endpoints = [
      { kwh: 0.0029, region: "ERCT" },
      { kwh: 0.00004, region: "SRSO" },
      { kwh: 0.0003, region: "RFCE" },
    ];
    const agents = ["base:95721", "base:120044", "base:131377"];
    const recs = [];
    let exactKg = 0;
    for (let i = 0; i < 1000; i++) {
      const e = endpoints[i % 3], agentId = agents[i % 3 === 0 ? 0 : i % 7 === 0 ? 2 : 1];
      exactKg += e.kwh * GRID_KG_CO2_PER_KWH[e.region];
      const r = m.record({ paymentRef: `0x${sha256hex(`pay${i}`).slice(0, 16)}`, rail: i % 5 === 0 ? "mpp" : "x402", agentId, endpoint: "/e", kwh: e.kwh, gridRegion: e.region, at: "2026-09-27T00:00:00Z" });
      if (r) recs.push(r);
    }
    for (const a of m.pending()) { const r = m.flush(a); if (r) recs.push(r); }
    const refs = recs.flatMap(r => r.paymentRefs ?? []);
    assert.equal(refs.length, 1000, "no call dropped");
    assert.equal(new Set(refs).size, 1000, "no call double-counted");
    let retiredT = 0, sumKgField = 0;
    for (const r of recs) {
      assert.match(r.tonnes, AMOUNT_RE);
      const exactT = r.kgCO2e! / 1000;
      const drop = exactT - Number(r.tonnes);
      assert.ok(drop >= -1e-12, `never retires more than measured: ${r.tonnes} vs ${exactT}`);
      assert.ok(drop < 1e-7, `flooring drops less than one stroop per retirement: ${drop}`);
      retiredT += Number(r.tonnes);
      sumKgField += r.kgCO2e!;
    }
    approx(sumKgField, exactKg, 1e-4); // kgCO2e fields are toFixed(6) per record
    const underKg = exactKg - retiredT * 1000;
    t.diagnostic(`retirements=${recs.length} exactKg=${exactKg.toFixed(6)} retiredKg=${(retiredT * 1000).toFixed(6)} underRetiredKg=${underKg.toFixed(6)} (${(underKg / exactKg * 100).toFixed(4)}%)`);
    assert.ok(underKg >= 0);
    assert.ok(underKg < recs.length * 1e-4, "cumulative under-retirement < 0.1 g per retirement");
  });
});
