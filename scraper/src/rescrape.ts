/**
 * Rescrape job:  npm run rescrape
 *
 * The post-patch update path — game updates show up as wiki edits.
 * Batch-queries current revids for every cached title (50 per request),
 * compares against cached revids, refetches only the changed pages, and
 * prints a report of what changed.
 */
import {
  fetchWikitext,
  invalidateCache,
  listCachedPages,
  queryCurrentRevids,
} from "./client.js";

const cached = await listCachedPages();
if (cached.length === 0) {
  console.log("cache is empty — nothing to rescrape");
  process.exit(0);
}

console.log(`checking ${cached.length} cached page(s) against the wiki...`);
const current = await queryCurrentRevids(cached.map((p) => p.title));

const unchanged: string[] = [];
const changed: Array<{ title: string; oldRevid: number; newRevid: number }> = [];
const missing: string[] = [];

for (const page of cached) {
  const newRevid = current.get(page.title);
  if (newRevid === undefined) missing.push(page.title);
  else if (newRevid === page.revid) unchanged.push(page.title);
  else changed.push({ title: page.title, oldRevid: page.revid, newRevid });
}

for (const { title } of changed) {
  await invalidateCache(title);
  await fetchWikitext(title);
}

console.log("\nrescrape report");
console.log(`  unchanged: ${unchanged.length}`);
for (const { title, oldRevid, newRevid } of changed) {
  console.log(`  UPDATED:   ${title} (revid ${oldRevid} -> ${newRevid})`);
}
if (changed.length === 0) console.log("  updated:   0");
for (const title of missing) {
  console.log(`  MISSING:   ${title} (no longer on the wiki — cache kept, investigate)`);
}
