import { PROFESSIONS } from "@gw1/engine";

export function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>GW1 Build Planner</h1>
      <p>Guild Wars 1 (Prophecies, normal mode) build planning — scaffold.</p>
      <p>Professions: {PROFESSIONS.join(", ")}</p>
    </main>
  );
}
