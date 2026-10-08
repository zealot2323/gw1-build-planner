/**
 * Skill tags: what a skill IS and what it DOES, as filterable facets.
 *
 * Pure functions, no I/O. `parse` runs `skillTags` over every skill and
 * stores the result in skills.json, so the app only reads it.
 *
 * Two sources, and the split matters:
 *  - The game client (api.gwtoolbox.com) says who a skill TARGETS and which
 *    dagger combo position it holds. Those are structured fields there and
 *    are read as-is.
 *  - Everything else — type, conditions, damage types, effects and what a
 *    skill works with — is read from the description. Neither the client nor
 *    the wiki has a structured field for "inflicts Bleeding" or "bonus
 *    against hexed foes", so this is text parsing with judgement calls,
 *    each noted where it is made.
 */
import type { Skill } from "./types.js";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The game's own type words, from the first sentence of the description. */
export const SKILL_TYPE_TAGS = [
  "Attack", "Spell", "Hex", "Enchantment", "Flash enchantment", "Signet",
  "Skill", "Stance", "Shout", "Chant", "Echo", "Preparation", "Glyph",
  "Ward", "Well", "Item spell", "Weapon spell", "Ritual", "Trap", "Form",
  "Pet attack", "Title",
] as const;
export type SkillTypeTag = (typeof SKILL_TYPE_TAGS)[number];

/** Which weapon an attack skill needs. */
export const WEAPON_TAGS = [
  "Axe", "Bow", "Dagger", "Hammer", "Scythe", "Spear", "Sword", "Melee", "Ranged",
] as const;
export type WeaponTag = (typeof WEAPON_TAGS)[number];

export const TARGET_TAGS = [
  "Foe", "Ally", "Other ally", "Dead ally", "Spirit", "Minion", "Corpse",
  "Animal", "Touch", "No target",
] as const;
export type TargetTag = (typeof TARGET_TAGS)[number];

export const CONDITION_TAGS = [
  "Bleeding", "Blind", "Burning", "Cracked Armor", "Crippled", "Dazed",
  "Deep Wound", "Disease", "Poison", "Weakness",
] as const;
export type ConditionTag = (typeof CONDITION_TAGS)[number];

export const DAMAGE_TAGS = [
  "Fire", "Cold", "Lightning", "Earth", "Holy", "Shadow", "Chaos", "Dark",
  "Piercing", "Slashing", "Blunt", "Physical", "Elemental", "Untyped",
] as const;
export type DamageTag = (typeof DAMAGE_TAGS)[number];

export const EFFECT_TAGS = [
  "Healing", "Health regeneration", "Health degeneration", "Life stealing",
  "Health sacrifice", "Energy gain", "Energy denial", "Adrenaline gain",
  "Interrupt", "Knockdown", "Skill disabling", "Slows attacks", "Condition removal",
  "Hex removal", "Enchantment removal", "Condition transfer", "Resurrection",
  "Block", "Armor bonus", "Damage reduction", "Speed boost", "Slows movement",
  "Faster attacks", "Faster casting", "Faster recharge", "Armor-ignoring damage",
  "Unblockable", "Critical hits", "Area effect", "Party-wide", "Shadow Step",
  "Creates a spirit", "Minions", "Uses a corpse", "Summon", "Maintained",
  "Self condition", "Exhaustion",
] as const;
export type EffectTag = (typeof EFFECT_TAGS)[number];

/**
 * What a skill is better with or needs: the target's state, your own state,
 * or the skill before it in a dagger chain.
 */
export const WORKS_WITH_TAGS = [
  "Hexed foe", "Enchanted foe", "Target with a condition", "Bleeding", "Blind",
  "Burning", "Cracked Armor", "Crippled", "Dazed", "Deep Wound", "Disease",
  "Poison", "Weakness", "Knocked-down foe", "Attacking foe", "Casting foe",
  "Moving foe", "Low Health", "Your enchantments", "Your hexes",
  "Your stance", "Your shouts and chants", "Your preparations",
  "Your weapon spells", "Nearby spirits", "Lead attack", "Off-hand attack",
  "Dual attack",
] as const;
export type WorksWithTag = (typeof WORKS_WITH_TAGS)[number];

export interface SkillTags {
  types: SkillTypeTag[];
  weapon: WeaponTag[];
  target: TargetTag[];
  /** Conditions this skill puts on someone else. */
  inflicts: ConditionTag[];
  damage: DamageTag[];
  effects: EffectTag[];
  worksWith: WorksWithTag[];
}

/** One facet of the tag filter, in display order. */
export type SkillTagFacet = keyof SkillTags;

export const SKILL_TAG_FACETS: Array<{ key: SkillTagFacet; label: string; values: readonly string[] }> = [
  { key: "types", label: "Type", values: SKILL_TYPE_TAGS },
  { key: "weapon", label: "Weapon", values: WEAPON_TAGS },
  { key: "target", label: "Target", values: TARGET_TAGS },
  { key: "inflicts", label: "Inflicts", values: CONDITION_TAGS },
  { key: "damage", label: "Damage type", values: DAMAGE_TAGS },
  { key: "effects", label: "Effect", values: EFFECT_TAGS },
  { key: "worksWith", label: "Works with", values: WORKS_WITH_TAGS },
];

/** The client's structured fields that tagging reads. All optional. */
export interface ClientSkillFields {
  /** GW::Constants target type: 1 misc, 3 ally, 4 other ally, 5 foe, 6 dead ally, 14 minion, 16 foe's location. */
  target?: number;
  /** Dagger chain position this skill counts as: 1 lead, 2 off-hand, 3 dual. */
  combo?: number;
  /** Chain position it must follow (bitmask): 1 dual, 2 lead, 4 off-hand. */
  comboReq?: number;
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

const TYPE_WORDS: Array<[RegExp, SkillTypeTag[]]> = [
  [/^Flash Enchantment Spell$/, ["Enchantment", "Flash enchantment", "Spell"]],
  [/^Enchantment Spell$/, ["Enchantment", "Spell"]],
  [/^Hex Spell$/, ["Hex", "Spell"]],
  [/^Well Spell$/, ["Well", "Spell"]],
  [/^Ward Spell$/, ["Ward", "Spell"]],
  [/^Item Spell$/, ["Item spell", "Spell"]],
  [/^Weapon Spell$/, ["Weapon spell", "Spell"]],
  [/^Spell$/, ["Spell"]],
  [/Ritual$/, ["Ritual"]],
  [/^Pet Attack$/, ["Pet attack"]],
  [/Attack$/, ["Attack"]],
  [/^(Signet|Skill|Stance|Shout|Chant|Echo|Preparation|Glyph|Trap|Form|Title)$/, []],
];

const WEAPON_WORDS: Record<string, WeaponTag[]> = {
  Axe: ["Axe", "Melee"],
  Bow: ["Bow", "Ranged"],
  Hammer: ["Hammer", "Melee"],
  Scythe: ["Scythe", "Melee"],
  Spear: ["Spear", "Ranged"],
  Sword: ["Sword", "Melee"],
  // Assassin chains are dagger attacks, named by their chain position.
  Lead: ["Dagger", "Melee"],
  "Off-Hand": ["Dagger", "Melee"],
  Dual: ["Dagger", "Melee"],
  Melee: ["Melee"],
  Ranged: ["Ranged"],
};

/** "Elite Flash Enchantment Spell." -> the type words without "Elite". */
export function skillTypeLine(description: string): string {
  return description.split(".")[0].replace(/^Elite\s+/, "").trim();
}

function typeTags(line: string): { types: SkillTypeTag[]; weapon: WeaponTag[] } {
  for (const [re, tags] of TYPE_WORDS) {
    if (!re.test(line)) continue;
    if (tags.length === 0) return { types: [line as SkillTypeTag], weapon: [] };
    if (tags[0] === "Attack") {
      const word = line.replace(/\s*Attack$/, "");
      return { types: ["Attack"], weapon: WEAPON_WORDS[word] ?? [] };
    }
    return { types: [...tags], weapon: [] };
  }
  return { types: [], weapon: [] };
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** Every way the text names a condition. Order matters: "Deep Wound" before "Wound". */
const CONDITION_WORDS: Array<[ConditionTag, RegExp]> = [
  ["Bleeding", /\bbleed(ing|s)?\b/],
  ["Blind", /\bblind(ed|ness|s)?\b/],
  ["Burning", /\bburning\b|\bset on fire\b|\bon fire\b|\bafflicted with burning\b/],
  ["Cracked Armor", /\bcracked armor\b/],
  ["Crippled", /\bcrippl(e|ed|es|ing)\b/],
  ["Dazed", /\bdazed?\b/],
  ["Deep Wound", /\bdeep wound\b/],
  ["Disease", /\bdiseas(e|ed)\b/],
  ["Poison", /\bpoison(ed|s|ing)?\b/],
  ["Weakness", /\bweak(ness|ened)\b/],
];

/** A condition named as the TARGET'S STATE rather than something done to it. */
const STATE_OF_TARGET =
  /\b(if|while|whenever|unless)\b|\bsuffering from\b|\bwith (a |an )?(cracked armor|deep wound|condition)|\bhas (a |an )?(cracked armor|deep wound)|\bwas (already )?(suffering|bleeding|burning|crippled|blinded|dazed|poisoned|diseased|weakened)/;

/** Sentences that take a condition away (or keep it off) rather than apply it. */
const REMOVAL =
  /\b(remove[sd]?|lose[s]?|cure[sd]?|cleanse|relieved|immune|cannot be|no longer|reduce[sd]? the duration|end[s]? (the )?(bleeding|poison|disease)|transferred from)\b/;

/** Adjective before a creature noun: "Bleeding foes", "Burning creatures", "a Crippled foe". */
function conditionAsAdjective(clause: string, re: RegExp): boolean {
  const src = re.source;
  return new RegExp(`(${src})\\s+(foes?|creatures?|targets?|enemies|attackers?)\\b`).test(clause)
    || new RegExp(`(foes?|target|creature|enemies) (that|who) (is|are|was|were) (already )?(${src})`).test(clause);
}

/** Split a sentence at its first comma when it opens with a condition clause. */
function splitConditional(sentence: string): { condition: string; main: string } {
  const m = /^(if|when|whenever|while|for each|unless)\b([^,]*),(.*)$/.exec(sentence);
  if (!m) return { condition: "", main: sentence };
  // "When X ends," and "When X is triggered," describe timing, not a requirement.
  if (/^when\b/.test(sentence) && /\b(ends?|triggered|dies|cast|activate)\b/.test(m[2])) {
    return { condition: "", main: m[3].trim() };
  }
  return { condition: m[1] + m[2], main: m[3].trim() };
}

// ---------------------------------------------------------------------------
// Effects and interactions
// ---------------------------------------------------------------------------

const AREA = /\b(all adjacent|adjacent foes|adjacent to|all nearby|nearby foes|nearby allies|foes near|in the area|in this area|in that area|in its range|within its range|in earshot|within earshot|all foes|all allies|party members|in the well|at (your|target foe's|its|that) location)\b/;
const PARTY = /\b(party members|all allies|allies (in|within) earshot|each ally within earshot|each party member|party-wide|your party)\b/;

/** Effect patterns run over the whole (lowercased) description. */
const EFFECT_PATTERNS: Array<[EffectTag, RegExp]> = [
  // Word-anchored: a bare "heal" also matches "Health".
  ["Healing", /\bheal(s|ed|ing)?\b|\b(gain|gains)\b (up to )?\d[\d_-]* health\b/],
  ["Health regeneration", /\+\d[\d_-]* health regeneration|gains? [^.]*health regeneration/],
  ["Life stealing", /\bsteals?\b[^.]*\bhealth\b|\blife steal/],
  ["Energy gain", /\b(gain|gains|regain)[^.]*\benergy\b|\+\d[^.]*energy regeneration|\benergy\b[^.]*\bis restored/],
  ["Energy denial", /\b(lose|loses)\b[^.]*\benergy\b(?! regeneration)|\bsteals?\b[^.]*\benergy\b|\bdrain/],
  ["Adrenaline gain", /\b(gain|gains)\b[^.]*\badrenaline\b|strikes? of adrenaline/],
  ["Interrupt", /\binterrupt(s|ed|ing)?\b(?<!easily interrupted)/],
  ["Condition removal", /\b(remove[sd]?|lose[s]?|cure[sd]?|cleanse|relieved of)\b[^.]*\bconditions?\b/],
  ["Hex removal", /\b(remove[sd]?|lose[s]?)\b[^.]*\bhex(es)?\b|\bhex(es)? (is |are )?removed|\bconvert hexes/],
  ["Condition transfer", /\btransfer[^.]*\bconditions?\b|\bconditions?\b[^.]*\btransferred/],
  ["Resurrection", /(?<!cannot (activate |use )?)\bresurrect(?!ion skills)|\breturned to life|\bback to life\b/],
  ["Block", /\b(chance to block|block the next|blocks? (the next |all |incoming |)\w* ?attacks?|you block|chance to evade|evade)/],
  ["Armor bonus", /\+\d[\d_-]* armor\b|\bhave \+\d[^.]*\barmor\b/],
  ["Damage reduction", /\b(take|takes|receive)s? [^.]*\bless damage\b|\bdamage[^.]*\bis reduced\b|\breduce[sd]? (the )?damage|\btake half damage/],
  ["Speed boost", /\bmoves? (\d[\d_-]*% )?faster\b/],
  ["Slows movement", /\bmoves? (\d[\d_-]*% )?slower\b|\bcrippl/],
  ["Slows attacks", /\battacks? (\d[\d_-]*% )?slower\b|\battack speed[^.]*(reduced|slowed)/],
  ["Faster attacks", /\battacks? (\d[\d_-]*% )?faster\b|\battack speed[^.]*(increased|faster)/],
  ["Faster casting", /\bcasts? (\d[\d_-]*% )?faster\b|\bcast (\d[\d_-]*% )?faster|\bcasting time[^.]*(halved|reduced)/],
  ["Faster recharge", /\brecharges? (\d[\d_-]*% )?faster\b|\brecharges? instantly\b|\bare recharged\b|\bis recharged\b|\brecharge (twice|\d+%) as fast/],
  ["Unblockable", /\bunblockable\b|\bcannot be blocked\b/],
  ["Critical hits", /\bcritical\b/],
  ["Shadow Step", /\bshadow steps?\b|\bteleport/],
  ["Minions", /\bminions?\b|\banimate\b|\bundead servants?\b|\bundead allies\b|\banimated undead\b/],
  ["Uses a corpse", /\bcorpse\b|\bexploit/],
  ["Summon", /\bsummon/],
  ["Maintained", /\bwhile you maintain\b/],
];

/** Interaction patterns, run over the conditional clause of each sentence. */
const WORKS_WITH_PATTERNS: Array<[WorksWithTag, RegExp]> = [
  ["Hexed foe", /\b(foe|target(?! ally)|that foe|it)\b[^,]*\b(is |are )?(hexed|(suffering from|under the effects? of|has|have) (a|an|another|any|\d+ or more)\b[^,]*\bhex(es)?\b)|\bhexed foes?\b|\bmust strike a hexed\b/],
  ["Enchanted foe", /\b(foe|target(?! ally))\b[^,]*\b((is|was) enchanted|under (the effects? of )?(an?|any) ([\w ]*)?enchantment|has (an?|any) enchantments?)|\benchanted foes?\b/],
  ["Target with a condition", /\bif suffering from a condition\b|\b(foe|ally|target)[^,]*(suffering from a (hex or )?condition|has (a|two or more|\d+ or more) conditions?|already suffering from a condition)|\bconditioned (foe|all)(y|ies|s)?\b/],
  ["Knocked-down foe", /\bknocked[ -]down (foes?|targets?)|\b(foe|target|creature)s? (that |who )?(is|are|was) (moving or )?knocked down\b|\bif knocked down\b|\bmust strike a knocked/],
  ["Attacking foe", /\b(foe|target(?! ally))\b[^,]*\b(is|was|are) (not )?attacking\b|\battacking foes?\b|\bif attacking\b|\bwhile attacking or moving\b|\bfoes using attack skills\b/],
  ["Casting foe", /\b(foe|target(?! ally))\b[^,]*\b(is|was|are) (not )?(attacking or )?casting\b|\bcasting foes?\b/],
  ["Moving foe", /\b(foe|target(?! ally))s?\b[^,]*\b(is|was|are) moving\b|\bmoving (foes?|targets?)\b|\bnon-moving\b|\b(attacking or )?moving\b(?= are)/],
  ["Low Health", /\b(below|less than|under) \d[\d_-]*%/],
  ["Your enchantments", /\byou are (enchanted|under the effects? of an enchantment)|\bif you are not (enchanted|under the effects? of an enchantment)|\bfor each enchantment on you/],
  ["Your hexes", /\bif you are hexed|\byou are suffering from a hex/],
  ["Your stance", /\b(if|while) you are (currently )?(not )?in a stance/],
  ["Your shouts and chants", /\byou are under the effects? of a (shout or chant|chant or (a )?shout)/],
  ["Your preparations", /\byou are under the effects? of a preparation/],
  ["Your weapon spells", /\byou are under the effects? of a weapon spell|\bwhile you have a weapon spell/],
  ["Nearby spirits", /\b(within|in) earshot of a spirit|\bspirits? (are |is )?within earshot|\bnear a spirit/],
];

/**
 * The same states named outside an "if" clause: "Knocked down foes are
 * struck for additional damage", "All nearby foes that are moving".
 */
const STATE_IN_MAIN: WorksWithTag[] = [
  "Hexed foe", "Enchanted foe", "Target with a condition", "Knocked-down foe",
  "Attacking foe", "Casting foe", "Moving foe", "Low Health",
];

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

function targetTags(text: string, client: ClientSkillFields): TargetTag[] {
  const out = new Set<TargetTag>();
  switch (client.target) {
    case 5:
    case 16:
      out.add("Foe");
      break;
    case 3:
      out.add("Ally");
      break;
    case 4:
      out.add("Other ally");
      break;
    case 6:
      out.add("Dead ally");
      break;
    case 14:
      out.add("Minion");
      break;
    case 1:
    case 11:
    case 15:
      // The client's catch-all: corpses, spirits, animals, and a few that
      // take either side. The description says which.
      if (/\bcorpse\b/.test(text)) out.add("Corpse");
      if (/\b(target|allied) spirit\b|\btarget (allied )?spirit/.test(text)) out.add("Spirit");
      if (/\btarget (animal|pet)\b/.test(text)) out.add("Animal");
      if (/\btarget (other )?ally\b/.test(text)) out.add(/target other ally/.test(text) ? "Other ally" : "Ally");
      if (/\btarget foe\b/.test(text)) out.add("Foe");
      break;
  }
  // Pet attacks carry no target of their own but name the foe they hit.
  if (out.size === 0 && /\btarget foe\b/.test(text)) out.add("Foe");
  if (out.size === 0) out.add("No target");
  if (/\btarget touched (foe|ally)|\btouch(ed)? (the |target )/.test(text)) out.add("Touch");
  return [...out];
}

// ---------------------------------------------------------------------------
// The whole thing
// ---------------------------------------------------------------------------

/**
 * "Target foe is knocked down" uses the state's words to describe what the
 * skill DOES. Only the knockdown state needs telling apart this way.
 */
function mainIsAction(tag: WorksWithTag, main: string): boolean {
  if (tag !== "Knocked-down foe") return false;
  return !/\bknocked[ -]down (foes?|targets?)\b|\b(that|who) (is|are) knocked down\b|\bif knocked down\b|\bmust strike/.test(main);
}

/** Order a tag set by its facet's vocabulary so stored tags diff cleanly. */
function ordered<T extends string>(vocab: readonly T[], set: Set<T>): T[] {
  return vocab.filter((v) => set.has(v));
}

/** Damage types named in the text. Attacks deal their weapon's damage, which the text does not name. */
function damageTags(text: string): DamageTag[] {
  const out = new Set<DamageTag>();
  for (const m of text.matchAll(/\b(fire|cold|lightning|earth|holy|shadow|chaos|dark|piercing|slashing|blunt|physical|elemental) damage\b/g)) {
    // "+20 armor against physical damage", "whenever you take fire damage":
    // a damage type the skill defends against, not one it deals.
    if (/\b(against|from|you take|you receive|reduces?|less)\s+(\w+\s+)?$/.test(text.slice(Math.max(0, m.index - 24), m.index))) continue;
    out.add((m[1][0].toUpperCase() + m[1].slice(1)) as DamageTag);
  }
  // "Target foe takes 10...40 damage": no type named. In GW1 untyped skill
  // damage ignores armor, and it is how most Mesmer damage is written.
  // Attack bonuses ("+10 damage") and damage reductions are not it.
  if (/\b(takes?|suffers?|struck for|strikes? for|deals?|dealing) (an additional |up to )?\d[\d_-]* damage\b/.test(text)) {
    out.add("Untyped");
  }
  return ordered(DAMAGE_TAGS, out);
}

/**
 * Derive every tag for one skill. `client` is the game client's record for
 * it, when there is one (the target and combo fields live there).
 */
export function skillTags(
  skill: Pick<Skill, "name" | "description" | "sacrificePercent" | "exhaustion">,
  client: ClientSkillFields = {},
): SkillTags {
  const line = skillTypeLine(skill.description);
  const { types, weapon } = typeTags(line);

  // Lowercase, and replace the skill's own name with "this skill" so
  // "If Poison Arrow hits" or "Weakness Trap ends" don't read as conditions.
  const ownName = skill.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const text = skill.description
    .toLowerCase()
    .replace(new RegExp(`\\b${ownName}\\b`, "g"), "this skill")
    // Any other skill named in the text ("Mantra of Earth", "Ward of Weakness").
    .replace(/\b(ward|illusion|signet|mantra|spirit|trap) of [a-z]+\b/g, "a skill")
    // "5...20" and "0.5" would otherwise end a sentence for every [^.] below.
    .replace(/(\d)\.\.\.(\d)/g, "$1-$2")
    .replace(/(\d)\.(\d)/g, "$1_$2")
    // A hex naming itself ("foes are hexed with Panic") is not a hexed-foe bonus.
    .replace(/\b(while )?hexed with\b/g, "affected by")
    .replace(/\bwhile hexed\b/g, "while affected")
    // Anti-healing is not healing.
    .replace(/\b(less|reduced) benefit from heal\w*/g, "less benefit")
    // A Dervish ending its own enchantments pays a cost; it strips no foe.
    .replace(/\b(you )?(lose|remove)s? (\d+|a|one|your|all)( of your)? dervish enchantments?\b/g, "you spend an own enchantment")
    .replace(/\b(\d+|a|one|your|all)( of your)? dervish enchantments?\b/g, "an own enchantment");
  // Drop the type line itself: "Hex Spell." is not a hex interaction.
  const body = text.slice(text.indexOf(".") + 1);
  const sentences = body.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);

  const inflicts = new Set<ConditionTag>();
  const effects = new Set<EffectTag>();
  const worksWith = new Set<WorksWithTag>();

  for (const sentence of sentences) {
    const { condition, main } = splitConditional(sentence);
    // What the skill wants sits in its "if" clauses, leading or trailing:
    // "... and an additional 20 Health if that ally is suffering from a condition."
    const wants = `${condition} ${/\b(if|while|unless)\b[^,]*/.exec(main)?.[0] ?? ""}`;
    for (const [tag, re] of WORKS_WITH_PATTERNS) {
      if (re.test(wants) || (STATE_IN_MAIN.includes(tag) && re.test(main) && !mainIsAction(tag, main))) worksWith.add(tag);
    }

    // A removal sentence lists conditions by name: "Remove one condition
    // (Poison, Disease, Blindness, ...)". None of those are inflicted.
    const listsForRemoval = /\b(remove[sd]?|cleanse|lose[s]?)\b[^.]*\bconditions?\b|\bcleanse yourself of\b/.test(main);

    for (const [cond, re] of CONDITION_WORDS) {
      // A condition in the "if ..." clause is something the skill wants.
      if (re.test(condition) && !/\b(you|your)\b[^,]*\b(remove|lose)/.test(condition)) worksWith.add(cond);
      if (!re.test(main)) continue;
      if (listsForRemoval) {
        effects.add("Condition removal");
        continue;
      }
      if (conditionAsAdjective(main, re)) {
        // "Bleeding foes take more damage", "a foe that is Crippled"
        worksWith.add(cond);
        continue;
      }
      // Each mention is judged by the clause it sits in: "You are immune
      // to Disease and inflict Disease on all adjacent foes" does both.
      type Use = "inflict" | "self" | "state" | "removal";
      let previous: Use | null = null;
      for (const m of main.matchAll(new RegExp(re.source, "g"))) {
        const pre = main.slice(0, m.index);
        const clause = pre.split(/[,;]/).pop()!.split(/\band\b/).map((c) => c.trim()).filter(Boolean).pop() ?? "";
        let kind: Use;
        if (!clause) kind = previous ?? "inflict";
        else if (/\b(if|while|unless|whenever)\b/.test(clause) || /\b(that foe has|suffering from|already suffering)\b/.test(clause) && STATE_OF_TARGET.test(clause)) kind = "state";
        else if (REMOVAL.test(clause)) kind = "removal";
        else if (/^(you|you also|you will)\s+(suffer|become|are|begin|get)\b/.test(clause)) kind = "self";
        else kind = "inflict";
        previous = kind;
        if (kind === "state") worksWith.add(cond);
        else if (kind === "removal") {
          if (!/\b(immune|cannot be|no longer)\b/.test(clause)) effects.add("Condition removal");
        } else if (kind === "self") effects.add("Self condition");
        else inflicts.add(cond);
      }
    }

    // Generic "a condition" / "conditions" pressure: Signet of... "suffers
    // from one of the following conditions" names them all, which the loop
    // above already caught.
  }

  for (const [tag, re] of EFFECT_PATTERNS) if (re.test(body)) effects.add(tag);

  // Health degeneration on someone else is pressure; "-1 Health
  // degeneration" on yourself is a cost. Both are worth finding, but only
  // the first is what a player searches for.
  if (/health degeneration/.test(body) && !/^\s*you (suffer|have)[^.]*health degeneration/m.test(body)) {
    if (!/\+\d[\d_-]* health regeneration/.test(body) || /-\d[^.]*health degeneration/.test(body)) {
      effects.add("Health degeneration");
    }
  }
  // Hex removal is a removal from an ally; foes "losing" a hex is rare
  // enough that the pattern above does not try to tell them apart.
  // Enchantment removal means stripping a FOE: Dervish skills that end
  // their own enchantments are a cost, not this.
  if (
    /\b(remove[sd]?|strip)\b[^.]*\benchantments?\b[^.]*\b(foe|target)\b|\b(foe|target)[^.]*\b(loses?|lose)\b[^.]*\benchantments?\b|\bremoves? (one|an|all|\d+) (of target foe's )?enchantments?\b|\benchantment removal\b/.test(body)
    && !/\byour (dervish )?enchantments?\b[^.]*\b(removed|ends?)\b/.test(body.match(/[^.]*\benchantments?\b[^.]*/)?.[0] ?? "")
  ) {
    effects.add("Enchantment removal");
  }
  if (/\bknock(s|ed)?[ -]?down\b|\bknockdown\b/.test(body) && /\b(is|are|be|becomes?) knocked down\b|\bknocks? (down )?(target|that|your|all|the)|\bknockdown\b/.test(body)) {
    // Knocking something down, not "cannot be knocked down" or a
    // knocked-down requirement.
    const kd = sentences.some((s) => {
      const { main } = splitConditional(s);
      return /\b(is|are|becomes?) knocked down\b|\bknocks? (down )?(target|that|your|all|the)|\bknockdown\b/.test(main)
        && !/\bcannot be knocked down\b|\bknocked[ -]down (foe|target)|\bwho is knocked down\b|\bthat (are|is) knocked down\b/.test(main);
    });
    if (kd) effects.add("Knockdown");
  }
  // Disabling a FOE's skills. "This skill is disabled for 10 seconds" and
  // "your Protection Prayers are disabled" are the caster's own cost.
  if (sentences.some((s) => /\bdisabled?\b/.test(s) && !/\b(this skill|your|you|all of your)\b[^.]*\bdisabled\b/.test(s))) {
    effects.add("Skill disabling");
  }
  if (skill.sacrificePercent || /\bsacrifice\b/.test(body)) effects.add("Health sacrifice");
  if (skill.exhaustion) effects.add("Exhaustion");
  if (types.includes("Ritual") || /\bcreate[^.]*\bspirit\b|\bsummons? a spirit/.test(body)) effects.add("Creates a spirit");
  if (AREA.test(body)) effects.add("Area effect");
  if (PARTY.test(body)) effects.add("Party-wide");

  const damage = damageTags(body);
  if (
    effects.has("Life stealing")
    || damage.some((d) => d === "Holy" || d === "Shadow" || d === "Chaos" || d === "Dark" || d === "Untyped")
    || /\bloses? \d[\d_-]* health\b|\barmor-ignoring\b|\bignores? armor\b/.test(body)
  ) {
    effects.add("Armor-ignoring damage");
  }

  // Dagger chains: what this skill must follow comes from the client.
  const req = client.comboReq ?? 0;
  if (req & 2 || /\bmust follow a lead attack\b/.test(body)) worksWith.add("Lead attack");
  if (req & 4 || /\bmust follow an off-hand attack\b/.test(body)) worksWith.add("Off-hand attack");
  if (req & 1 || /\bmust follow a dual attack\b/.test(body)) worksWith.add("Dual attack");
  if (/\bmust strike a knocked[ -]down foe\b/.test(body)) worksWith.add("Knocked-down foe");

  return {
    types,
    weapon,
    target: targetTags(text, client),
    inflicts: ordered(CONDITION_TAGS, inflicts),
    damage,
    effects: ordered(EFFECT_TAGS, effects),
    worksWith: ordered(WORKS_WITH_TAGS, worksWith),
  };
}

/** Every tag on a skill, flattened as "facet:value" keys for filtering. */
export function tagKeys(tags: SkillTags | undefined): Set<string> {
  const out = new Set<string>();
  if (!tags) return out;
  for (const { key } of SKILL_TAG_FACETS) for (const v of tags[key]) out.add(`${key}:${v}`);
  return out;
}

/** Cost buckets for the skill browser's cost filter. */
export const COST_BUCKETS = ["free", "5", "10", "15", "25", "adrenaline"] as const;
export type CostBucket = (typeof COST_BUCKETS)[number];

export const COST_BUCKET_LABEL: Record<CostBucket, string> = {
  free: "No energy",
  "5": "1–5 Energy",
  "10": "10 Energy",
  "15": "15 Energy",
  "25": "25 Energy",
  adrenaline: "Adrenaline",
};

/**
 * Which cost bucket a skill falls in. The game's energy costs are 1, 3, 5,
 * 10, 15 and 25; the handful of 1s and 3s sit with the 5s.
 */
export function costBucket(skill: Pick<Skill, "energyCost" | "adrenalineCost">): CostBucket {
  if (skill.adrenalineCost) return "adrenaline";
  const e = skill.energyCost ?? 0;
  if (e === 0) return "free";
  if (e <= 5) return "5";
  if (e <= 10) return "10";
  if (e <= 15) return "15";
  return "25";
}
