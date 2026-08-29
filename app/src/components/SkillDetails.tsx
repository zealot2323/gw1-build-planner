import type { Skill } from "@gw1/engine";
import { SkillIcon } from "./SkillIcon";
import { wikiHref } from "../wiki";

const num = (n: number | null | undefined) => (n === null || n === undefined ? null : n);

/** Inline skill card: costs, description, and where it comes from. */
export function SkillDetails({ skill }: { skill: Skill }) {
  const stats: Array<[string, string]> = [];
  if (num(skill.energyCost) !== null) stats.push(["energy", String(skill.energyCost)]);
  if (num(skill.adrenalineCost) !== null) stats.push(["adrenaline", String(skill.adrenalineCost)]);
  if (num(skill.activation) !== null) stats.push(["activation", `${skill.activation}s`]);
  if (skill.recharge) stats.push(["recharge", `${skill.recharge}s`]);

  const acq = skill.acquisition;
  const sources: string[] = [];
  if (acq.trainers.length > 0) sources.push(`Trainers: ${acq.trainers.join(", ")}`);
  if (acq.quests.length > 0) sources.push(`Quests: ${acq.quests.join(", ")}`);
  if (acq.captureBosses.length > 0) sources.push(`Capture from: ${acq.captureBosses.join(", ")}`);

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
              {skill.profession ?? "Common"}
              {skill.attribute ? ` · ${skill.attribute}` : ""}
            </span>
          </div>
          <div className="skill-stats muted small">
            {stats.map(([k, v]) => (
              <span key={k}>
                <span className="muted">{k}</span> {v}
              </span>
            ))}
          </div>
        </div>
      </div>
      {skill.description && <p className="skill-desc">{skill.description}</p>}
      {sources.map((s) => (
        <p key={s} className="muted small no-margin">
          {s}
        </p>
      ))}
    </div>
  );
}
