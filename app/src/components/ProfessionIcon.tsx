import type { Profession } from "@gw1/engine";

/** Profession icon; `null`/undefined profession renders nothing (common skills). */
export function ProfessionIcon({
  profession,
  size = 16,
  withLabel = false,
}: {
  profession: Profession | null | undefined;
  size?: number;
  withLabel?: boolean;
}) {
  if (!profession) return withLabel ? <span className="muted">Common</span> : null;
  return (
    <span className="prof">
      <img
        className="prof-icon"
        src={`${import.meta.env.BASE_URL}icons/professions/${profession}.png`}
        width={size}
        height={size}
        alt={profession}
        title={profession}
        loading="lazy"
        onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
      />
      {withLabel && <span>{profession}</span>}
    </span>
  );
}
