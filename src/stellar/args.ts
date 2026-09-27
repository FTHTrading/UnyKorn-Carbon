/**
 * Minimal `--flag value` parser for the Stellar CLI.
 * A flag followed by another flag, or by nothing, gets the string "true".
 * Positional tokens are ignored. Behaviour is identical to the inline
 * one-liner it replaced; it lives here so tests can import it without
 * triggering the CLI's module-level side effects.
 */
export function parseArgs(argv: string[]): Record<string, string> {
  return Object.fromEntries(
    argv
      .map((a, i, all) =>
        a.startsWith("--")
          ? [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]]
          : [],
      )
      .filter((x) => x.length),
  );
}
