import type { Skill, SkillPlan } from "@gw1/engine";
import { SkillIcon } from "./SkillIcon";
import { ProfessionIcon } from "./ProfessionIcon";
import { ProximityDot } from "./ProximityDot";
import { wikiHref } from "../wiki";

const has = (n: number | null | undefined): n is number => n !== null && n !== undefined;

/** One cost/timing stat; `tone` colours the value (energy blue, sac red). */
function Stat({ label, value, unit, tone }: { label: string; value: number; unit?: string; tone?: string }) {
  return (
    <span className="stat">
      <span className="muted">{label}</span>{" "}
      <b className={tone}>
        {value}
        {unit}
      </b>
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
 * Inline skill card: costs, description, and where it comes from.
 * `plan` adds the "how far away is this" line; omit it for known skills,
 * which have nothing left to travel for.
 */
export function SkillDetails({ skill, plan }: { skill: Skill; plan?: SkillPlan }) {
  const acq = skill.acquisition;
  return (
    <div className="skill-details">
      <div className="row">
        <SkillIcon page={skill.wikiPage} size={40} />
        <div className="grow">
          <div>
            <a href={wikiHref(skill.wikiPage)} target="_blank" rel="noreferrer">
              <strong>{skill.name}</strong>
            </a>
            {skill.isElite && <span className="elite"> ★ elite</span>}{" "}
            <span className="muted small">
              <ProfessionIcon profession={skill.profession} withLabel />
              {skill.attribute ? ` · ${skill.attribute}` : ""}
            </span>
          </div>
          <div className="skill-stats small">
            {has(skill.energyCost) && <Stat label="energy" value={skill.energyCost} tone="energy" />}
            {has(skill.adrenalineCost) && <Stat label="adrenaline" value={skill.adrenalineCost} tone="adrenaline" />}
            {has(skill.sacrificePercent) && (
              <Stat label="sacrifice" value={skill.sacrificePercent} unit="%" tone="sacrifice" />
            )}
            {has(skill.upkeep) && <Stat label="upkeep" value={skill.upkeep} tone="energy" />}
            {has(skill.activation) && skill.activation > 0 && (
              <Stat label="activation" value={skill.activation} unit="s" />
            )}
            {skill.recharge > 0 && <Stat label="recharge" value={skill.recharge} unit="s" />}
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
      <SourceList label="Capture from" items={acq.captureBosses} />
      <SourceList label="Capture (quest/event only)" items={acq.conditionalCaptureBosses ?? []} />
    </div>
  );
}
