import { skillInMode, type Skill, type SkillPlan } from "@gw1/engine";
import { useData } from "../DataContext";
import { SkillIcon } from "./SkillIcon";
import { ProfessionIcon } from "./ProfessionIcon";
import { ProximityDot } from "./ProximityDot";
import { wikiHref } from "../wiki";
import { SkillTagList } from "./SkillTagFilter";

const has = (n: number | null | undefined): n is number => n !== null && n !== undefined;

type CostType = "energy" | "adrenaline" | "activation" | "recharge" | "sacrifice" | "upkeep" | "overcast";

/**
 * One cost as "value + tango icon", the way the game and the wiki show it —
 * layout borrowed from gw1tools/gw1builds (MIT). The icon carries the
 * meaning, so the number leads and the glyph follows.
 */
function CostStat({ type, value, unit }: { type: CostType; value: number; unit?: string }) {
  return (
    <span className="cost-stat" title={type}>
      <span className="cost-value">
        {value}
        {unit}
      </span>
      <img src={`${import.meta.env.BASE_URL}icons/cost/${type}.png`} alt={type} width={16} height={16} />
    </span>
  );
}

/** A "Trainers: A, B" style line whose entries link to the wiki. */
function SourceList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <p className="muted small no-margin">
      {label}:{" "}
      {items.map((item, i) => (
        <span key={item}>
          {i > 0 && ", "}
          <a href={wikiHref(item)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            {item}
          </a>
        </span>
      ))}
    </p>
  );
}

/**
 * Capture sources, zone first: "where do I go" is the question, and the
 * boss is how you get it once you're there. Several bosses in one zone are
 * listed under it together. The zone comes from the skill's acquisition
 * line, falling back to the boss's own page for the handful that omit it.
 */
function CaptureList({
  label,
  bosses,
  locations,
}: {
  label: string;
  bosses: string[];
  locations: Record<string, string | null> | undefined;
}) {
  const index = useData();
  if (bosses.length === 0) return null;

  const byZone = new Map<string, string[]>();
  for (const boss of bosses) {
    const zone = locations?.[boss] ?? index.monsterByPage.get(boss)?.locations?.[0] ?? "";
    if (!byZone.has(zone)) byZone.set(zone, []);
    byZone.get(zone)!.push(boss);
  }
  const zones = [...byZone.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));

  return (
    <p className="muted small no-margin">
      {label}:{" "}
      {zones.map(([zone, list], i) => (
        <span key={zone || "unknown"}>
          {i > 0 && "; "}
          {zone ? (
            <a href={wikiHref(zone)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              {zone}
            </a>
          ) : (
            <span className="muted">zone unknown</span>
          )}
          {" · "}
          {list.map((boss, j) => (
            <span key={boss}>
              {j > 0 && ", "}
              <a href={wikiHref(boss)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                {boss}
              </a>
            </span>
          ))}
        </span>
      ))}
    </p>
  );
}

/**
 * Inline skill card: costs, description, and where it comes from.
 * `plan` adds the "how far away is this" line; omit it for known skills,
 * which have nothing left to travel for. `pvp` shows the skill's PvP split
 * in place of the PvE version, for the skills that have one.
 */
export function SkillDetails({
  skill: pve,
  plan,
  pvp = false,
  onTagPick,
}: {
  skill: Skill;
  plan?: SkillPlan;
  pvp?: boolean;
  /** Makes the tag chips filter the skill list. */
  onTagPick?: (key: string) => void;
}) {
  const skill = skillInMode(pve, pvp);
  const showingPvp = pvp && pve.pvp !== undefined;
  const acq = skill.acquisition;
  return (
    <div className="skill-details">
      <div className="skill-card-head">
        <span className={skill.isElite ? "skill-card-icon elite-icon" : "skill-card-icon"}>
          <SkillIcon page={skill.wikiPage} size={48} />
        </span>
        <div className="grow">
          <div className={skill.isElite ? "skill-card-name elite" : "skill-card-name"}>
            <a href={wikiHref(showingPvp ? pve.pvp!.wikiPage : skill.wikiPage)} target="_blank" rel="noreferrer">
              {skill.name}
            </a>
            {skill.isElite && <span className="elite-tag">[Elite]</span>}
            {showingPvp && <span className="pvp-tag">PvP version</span>}
          </div>
          <div className="skill-card-type">
            <ProfessionIcon profession={skill.profession} withLabel />
            {skill.attribute ? <span> • {skill.attribute}</span> : null}
          </div>
          <div className="skill-costs">
            {has(skill.energyCost) && skill.energyCost > 0 && (
              <CostStat type="energy" value={skill.energyCost} />
            )}
            {has(skill.adrenalineCost) && skill.adrenalineCost > 0 && (
              <CostStat type="adrenaline" value={skill.adrenalineCost} />
            )}
            {has(skill.sacrificePercent) && skill.sacrificePercent > 0 && (
              <CostStat type="sacrifice" value={skill.sacrificePercent} unit="%" />
            )}
            {has(skill.upkeep) && skill.upkeep !== 0 && <CostStat type="upkeep" value={skill.upkeep} />}
            {has(skill.exhaustion) && skill.exhaustion > 0 && (
              <CostStat type="overcast" value={skill.exhaustion} />
            )}
            {has(skill.activation) && skill.activation > 0 && (
              <CostStat type="activation" value={skill.activation} unit="s" />
            )}
            {skill.recharge > 0 && <CostStat type="recharge" value={skill.recharge} unit="s" />}
          </div>
        </div>
      </div>
      {skill.description && <p className="skill-desc">{skill.description}</p>}
      <SkillTagList tags={skill.tags} onPick={onTagPick} />
      {pve.pvp && !pvp && <p className="muted small no-margin">Has a separate PvP version.</p>}
      {plan && (
        <p className="small no-margin">
          <ProximityDot proximity={plan.proximity} distance={plan.distance} />
          {plan.distance === null
            ? "No known route to a source."
            : plan.distance === 0
              ? "Reachable now."
              : `${plan.distance} zone${plan.distance === 1 ? "" : "s"} away`}
          {plan.route.length > 0 && (
            <span className="muted"> · via {plan.route.join(" → ")}</span>
          )}
        </p>
      )}
      <SourceList label="Sold by" items={acq.trainers} />
      <SourceList label="Quest rewards" items={acq.quests} />
      <CaptureList label="Captured from" bosses={acq.captureBosses} locations={acq.captureLocations} />
      <CaptureList
        label="Captured from (during a quest or event only)"
        bosses={acq.conditionalCaptureBosses ?? []}
        locations={acq.captureLocations}
      />
    </div>
  );
}
