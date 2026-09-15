import { useState } from "react";
import type { SyncStatus } from "../save";

const STATUS: Record<SyncStatus, string> = {
  local: "",
  loading: "loading…",
  saving: "saving…",
  saved: "saved",
  error: "not saved",
};

/**
 * Sign in by emailed magic link (no passwords), and show whether saves are
 * reaching the account. Renders nothing when accounts aren't configured.
 */
export function AccountBar({
  account,
}: {
  account: {
    enabled: boolean;
    email: string | null;
    status: SyncStatus;
    error: string | null;
    signIn: (email: string) => Promise<string | null>;
    signOut: () => Promise<void>;
  };
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!account.enabled) return null;

  if (account.email) {
    return (
      <span className="account small">
        <span className="muted">{account.email}</span>
        {STATUS[account.status] && (
          <span className={account.status === "error" ? "account-status error" : "account-status muted"}>
            {" · "}
            {STATUS[account.status]}
          </span>
        )}{" "}
        <button className="small" onClick={account.signOut}>
          Sign out
        </button>
        {account.error && <div className="error small">{account.error}</div>}
      </span>
    );
  }

  if (sent) {
    return (
      <span className="account small muted">
        Check {email} for a sign-in link.{" "}
        <button className="linkish" onClick={() => setSent(false)}>
          use a different email
        </button>
      </span>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    const err = await account.signIn(email.trim());
    setBusy(false);
    if (err) setProblem(err);
    else {
      setProblem(null);
      setSent(true);
    }
  };

  return (
    <form className="account small" onSubmit={submit}>
      <span className="muted">Saving in this browser.</span>{" "}
      <input
        type="email"
        required
        placeholder="email to sync characters"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />{" "}
      <button type="submit" disabled={busy}>
        {busy ? "Sending…" : "Email me a sign-in link"}
      </button>
      {problem && <div className="error small">{problem}</div>}
    </form>
  );
}
