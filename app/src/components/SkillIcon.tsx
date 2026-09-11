import { iconForSkillPage } from "../wiki";
import { useAllegiance } from "../DataContext";

/** Small skill icon; renders nothing when no icon exists. */
export function SkillIcon({ page, size = 24 }: { page: string; size?: number }) {
  const url = iconForSkillPage(page, useAllegiance());
  if (!url) return null;
  return (
    <img
      className="skill-icon"
      src={url}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
    />
  );
}
