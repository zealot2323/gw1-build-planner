import type { Proximity } from "@gw1/engine";

const LABEL: Record<Proximity, string> = {
  now: "Reachable now",
  near: "1–2 zones away",
  mid: "3–5 zones away",
  far: "6 or more zones away",
  unknown: "No known route",
};

/** Green/yellow/red proximity marker: how far off is this skill? */
export function ProximityDot({
  proximity,
  distance,
}: {
  proximity: Proximity;
  distance: number | null;
}) {
  return (
    <span
      className={`prox prox-${proximity}`}
      title={distance === null ? LABEL[proximity] : `${LABEL[proximity]} (${distance})`}
    >
      ●
    </span>
  );
}
