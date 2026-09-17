import type { Skill, SkillPlan } from "@gw1/engine";
import { useData } from "../DataContext";
import { SkillIcon } from "./SkillIcon";
import { ProfessionIcon } from "./ProfessionIcon";
import { ProximityDot } from "./ProximityDot";
import { wikiHref } from "../wiki";

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
 * which have nothing left to travel for.
 */
export function SkillDetails({ skill, plan }: { skill: Skill; plan?: SkillPlan }) {
  const acq = skill.acquisition;
  return (
    <div className="skill-details">
      <div className="skill-card-head">
        <span className={skill.isElite ? "skill-card-icon elite-icon" : "skill-card-icon"}>
          <SkillIcon page={skill.wikiPage} size={48} />
        </span>
        <div className="grow">
          <div className={skill.isElite ? "skill-card-name elite" : "skill-card-name"}>
            <a href={wikiHref(skill.wikiPage)} target="_blank" rel="noreferrer">
              {skill.name}
            </a>
            {skill.isElite && <span className="elite-tag">[Elite]</span>}
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
            {has(skill.activation) && skill.activation > 0 && (
              <CostStat type="activation" value={skill.activation} unit="s" />
            )}
            {skill.recharge > 0 && <CostStat type="recharge" value={skill.recharge} unit="s" />}
          </div>
        </div>
      </div>
      {skill.description && <p className="skill-desc">{skill.description}</p>}
      {plan && (
        <p className="small no-margin">
          <ProximityDot proximity={plan.proximity} distance={plan.distance} />
          {plan.distance === null
            ? "No route to any known source."
            : plan.distance === 0
              ? "Reachable now — you can go get it."
              : `${plan.distance} zone${plan.distance === 1 ? "" : "s"} away`}
          {plan.route.length > 0 && (
            <span className="muted"> · via {plan.route.join(" → ")}</span>
          )}
        </p>
      )}
      <SourceList label="Trainers" items={acq.trainers} />
      <SourceList label="Quests" items={acq.quests} />
      <CaptureList label="Capture from" bosses={acq.captureBosses} locations={acq.captureLocations} />
      <CaptureList
        label="Capture (quest/event only)"
        bosses={acq.conditionalCaptureBosses ?? []}
        locations={acq.captureLocations}
      />
    </div>
  );
}
