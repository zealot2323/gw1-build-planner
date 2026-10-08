/**
 * Small line icons for the per-skill actions. Drawn inline so they inherit
 * the button's text colour (accent on hover, muted when disabled) and need
 * no icon font or extra request.
 *
 * - build-add / build-in: a skill slot, with a plus or a tick in it.
 * - todo-add / todo-in: a checklist, with a plus or a tick beside it.
 */
export type ActionIconName = "build-add" | "build-in" | "todo-add" | "todo-in";

export function ActionIcon({ name }: { name: ActionIconName }) {
  return (
    <svg
      className="action-icon"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === "build-add" && (
        <>
          <rect x="2.5" y="2.5" width="15" height="15" rx="2.5" />
          <path d="M10 6.5v7M6.5 10h7" />
        </>
      )}
      {name === "build-in" && (
        <>
          <rect x="2.5" y="2.5" width="15" height="15" rx="2.5" fill="currentColor" fillOpacity="0.18" />
          <path d="M6.3 10.2l2.5 2.5 4.9-5.2" />
        </>
      )}
      {(name === "todo-add" || name === "todo-in") && <path d="M2.5 5h8M2.5 10h8M2.5 15h5" />}
      {name === "todo-add" && <path d="M15 9.5v7M11.5 13h7" />}
      {name === "todo-in" && <path d="M11.3 13.2l2.3 2.3 4.2-4.6" />}
    </svg>
  );
}
