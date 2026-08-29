import type { Skill } from "@gw1/engine";
import { index } from "./data";

/** Link back to the wiki page an entity was scraped from. */
export function wikiHref(page: string): string {
  return `https://wiki.guildwars.com/wiki/${encodeURIComponent(page.replace(/ /g, "_"))}`;
}

/** Local skill icon downloaded by `npm run icons` (keyed by gwSkillId). */
export function iconUrl(skill: Skill | null | undefined): string | null {
  if (!skill || skill.gwSkillId === null || skill.gwSkillId === undefined) return null;
  return `${import.meta.env.BASE_URL}icons/${skill.gwSkillId}.jpg`;
}

export function iconForSkillPage(page: string): string | null {
  return iconUrl(index.skillByPage.get(page));
}

/** Attribute group heading for a skill ("Axe Mastery", "No attribute"). */
export function attributeOf(page: string): string {
  return index.skillByPage.get(page)?.attribute ?? "No attribute";
}
