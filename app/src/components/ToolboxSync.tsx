import { useEffect, useState } from "react";
import {
  createPairingCode,
  listDevices,
  revokeDevice,
  uploaderSettings,
  type LinkedDevice,
} from "../completion";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";

/**
 * Linking a machine to this account so GWToolbox progress arrives on its
 * own: skills learned, places unlocked, missions done in both modes, and
 * areas vanquished.
 *
 * The machine never holds account credentials. A code shown here is traded
 * once for a token that can do exactly one thing — replace this account's
 * pending upload — and revoking it here is the end of it.
 */
export function ToolboxSync({
  signedIn,
  onSync,
  syncing,
}: {
  signedIn: boolean;
  onSync: () => Promise<string>;
  syncing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<LinkedDevice[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (open && signedIn) void listDevices().then(setDevices);
  }, [open, signedIn]);

  if (!signedIn) return null;

  const pair = async () => {
    setProblem(null);
    try {
      const { code: fresh } = await createPairingCode();
      setCode(fresh);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };

  const revoke = async (device: LinkedDevice) => {
    const failure = await revokeDevice(device.id);
    if (failure) setProblem(failure);
    else setDevices(await listDevices());
  };

  const command = `./gw1-upload.py --pair ${code ?? "CODE"} \\
  --url ${uploaderSettings.url || "<your Supabase URL>"} \\
  --anon-key ${uploaderSettings.anonKey || "<your anon key>"}`;

  return (
    <div className="card">
      <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="caret">{open ? "▾" : "▸"}</span> GWToolbox sync
        {devices.length > 0 && <span className="muted"> ({devices.length} linked)</span>}
      </button>

      {open && (
        <div className="slide-down">
          <p className="muted small">
            The uploader in <code>uploader/</code> sends GWToolbox's completion file to this account, and the
            planner reads skills, unlocked places, missions (normal and hard mode) and vanquishes out of it.
            Nothing you set here by hand is overwritten — an import only ever adds.
          </p>

          <div className="row wrap">
            <button onClick={() => void pair()}>Link a machine</button>
            <button
              onClick={async () => {
                setProblem(null);
                setMessage(await onSync());
              }}
              disabled={syncing}
            >
              {syncing ? "Checking…" : "Check for an upload now"}
            </button>
          </div>

          {code && (
            <div className="pairing">
              <p className="small no-margin">
                On the machine running Guild Wars, within 15 minutes:
              </p>
              <pre className="pairing-code">{command}</pre>
              <p className="muted small no-margin">
                Then <code>./gw1-upload.py --watch</code> to keep it up to date. The code works once.
              </p>
            </div>
          )}

          {message && <p className="small ok">{message}</p>}
          {problem && <p className="small warn">{problem}</p>}

          {devices.length > 0 && (
            <table className="small device-table">
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td>{d.label}</td>
                    <td className="muted">last upload {when(d.lastUsedAt)}</td>
                    <td>
                      <button className="small" onClick={() => void revoke(d)}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
