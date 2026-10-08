import type { Profession } from "@gw1/engine";

/** Profession icon; `null`/undefined profession renders nothing (common skills). */
export function ProfessionIcon({
  profession,
  size = 18,
  withLabel = false,
  title,
}: {
  profession: Profession | null | undefined;
  size?: number;
  withLabel?: boolean;
  /** Hover text; defaults to the profession's name. */
  title?: string;
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
        title={title ?? profession}
        loading="lazy"
        onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
      />
      {withLabel && <span>{profession}</span>}
    </span>
  );
}
