/**
 * Ad-hoc page fetch for development:  npm run fetch -- "Page Name"
 * Serves from cache when present (says so), fetches and caches otherwise.
 */
import { fetchWikitext, getCached } from "./client.js";

const title = process.argv.slice(2).join(" ").trim();
if (!title) {
  console.error('usage: npm run fetch -- "Page Name"');
  process.exit(1);
}

const wasCached = (await getCached(title)) !== null;
const page = await fetchWikitext(title);

console.log(`${wasCached ? "[cache]" : "[fetched]"} ${page.title}`);
console.log(`  pageid: ${page.pageid}  revid: ${page.revid}  timestamp: ${page.timestamp}`);
console.log(`  wikitext: ${page.wikitext.length} chars`);
console.log("---");
console.log(page.wikitext.split("\n").slice(0, 12).join("\n"));
