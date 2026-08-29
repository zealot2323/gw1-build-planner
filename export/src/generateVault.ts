/**
 * Obsidian vault generator (stub).
 *
 * Will read the committed JSON datasets from /data and emit an Obsidian vault:
 * one note per skill/location/monster, wikilinked by wiki page name (the same
 * stable key used across the datasets), plus build notes with template codes
 * (all attributes at 0 — attribute spreads are out of scope, see CLAUDE.md).
 */
export function generateVault(outDir: string): void {
  throw new Error(`not implemented yet (would write vault to ${outDir})`);
}
