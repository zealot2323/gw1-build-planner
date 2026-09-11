import { DEFAULT_ALLEGIANCE, type Allegiance, type Skill } from "@gw1/engine";
import { index } from "./data";

/** Link back to the wiki page an entity was scraped from. */
export function wikiHref(page: string): string {
  return `https://wiki.guildwars.com/wiki/${encodeURIComponent(page.replace(/ /g, "_"))}`;
}

/**
 * Local skill icon downloaded by `npm run icons` (keyed by gwSkillId).
 * Allegiance skills have one icon per side, so the character's allegiance
 * picks between them; Kurzick is the default.
 */
export function iconUrl(
  skill: Skill | null | undefined,
  allegiance: Allegiance = DEFAULT_ALLEGIANCE,
): string | null {
  if (!skill) return null;
  const id = skill.allegianceSkillIds?.[allegiance] ?? skill.gwSkillId;
  if (id === null || id === undefined) return null;
  return `${import.meta.env.BASE_URL}icons/${id}.jpg`;
}

export function iconForSkillPage(page: string, allegiance?: Allegiance): string | null {
  return iconUrl(index.skillByPage.get(page), allegiance);
}

/** Attribute group heading for a skill ("Axe Mastery", "No attribute"). */
export function attributeOf(page: string): string {
  return index.skillByPage.get(page)?.attribute ?? "No attribute";
}
