import { balanceChanges, diffVersion, type Skill, type SkillChangeRecord } from "@gw1/engine";
import { agoLabel } from "./ChangeBadge";

const KIND_LABEL: Record<string, string> = {
  balance: "balance change",
  bugfix: "bug fix",
  ai: "AI behaviour",
  note: "wiki note",
};

/**
 * The "what changed" panel for one skill: the patch notes themselves, then
 * the previous version pulled from the wiki's /Skill history subpage.
 *
 * The two are presented separately on purpose. The patch note is the
 * authoritative statement of what changed; the snapshot is only as current
 * as the wiki's history page, which lags the notes — so it is labelled with
 * its own date and flagged when it predates an intervening change, rather
 * than being passed off as the exact pre-patch skill.
 */
export function SkillChanges({ record, skill }: { record: SkillChangeRecord; skill: Skill }) {
  const balance = balanceChanges(record);
  const other = record.changes.filter((c) => c.kind !== "balance");
  const diffs = record.previous ? diffVersion(record.previous, skill) : [];

  return (
    <div className="skill-changes">
      <div className="changes-head">
        Recently changed
        {balance[0] && <span className="muted"> · {agoLabel(balance[0].date)}</span>}
      </div>
      <ul className="change-list">
        {[...balance, ...other].map((c, i) => (
          <li key={i} className={c.kind === "balance" ? "" : "muted"}>
            <span className="change-date">{c.date}</span>
            {c.kind !== "balance" && <span className="change-kind">{KIND_LABEL[c.kind] ?? c.kind}</span>}{" "}
            {c.note}
            {c.section && <span className="muted small"> — {c.section}</span>}
          </li>
        ))}
      </ul>

      {record.previous && diffs.length > 0 && (
        <>
          <div className="changes-head">
            Before <span className="muted">· wiki snapshot, {record.previous.label}</span>
          </div>
          {record.previousIsStale && (
            <p className="muted small no-margin">
              Note: the wiki's skill history has not been updated for every change listed above, so this
              snapshot may be older than the version immediately before the most recent change.
            </p>
          )}
          <table className="diff-table">
            <tbody>
              {diffs.map((d) => (
                <tr key={d.field}>
                  <td className="muted">{d.field}</td>
                  <td className="diff-before">{d.before}</td>
                  <td className="diff-after">{d.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {record.previous && diffs.length === 0 && (
        <p className="muted small no-margin">
          The wiki's last recorded version ({record.previous.label}) matches the skill's current values, so its
          history page has not been updated for this change yet.
        </p>
      )}
      {!record.previous && (
        <p className="muted small no-margin">
          No earlier version is recorded: this skill has no history page on the wiki.
        </p>
      )}
    </div>
  );
}
