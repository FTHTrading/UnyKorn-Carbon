import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/stellar/args.ts";

describe("parseArgs", () => {
  test("--net testnet --class x.json --submit", () => {
    assert.deepEqual(parseArgs(["--net", "testnet", "--class", "x.json", "--submit"]), {
      net: "testnet", class: "x.json", submit: "true",
    });
  });
  test("trailing flag with no value is 'true'", () => {
    assert.deepEqual(parseArgs(["--submit"]), { submit: "true" });
  });
  test("a flag followed by another flag is 'true'; the next flag still parses", () => {
    assert.deepEqual(parseArgs(["--submit", "--net", "mainnet"]), { submit: "true", net: "mainnet" });
  });
  test("positional tokens are ignored; empty argv gives {}", () => {
    assert.deepEqual(parseArgs(["stray", "--a", "1", "stray2"]), { a: "1" });
    assert.deepEqual(parseArgs([]), {});
  });
  test("repeated flag: last one wins (documents current behaviour)", () => {
    assert.deepEqual(parseArgs(["--net", "testnet", "--net", "mainnet"]), { net: "mainnet" });
  });
});
