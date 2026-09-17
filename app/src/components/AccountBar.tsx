import { useState } from "react";
import type { SyncStatus } from "../save";

const STATUS: Record<SyncStatus, string> = {
  local: "",
  loading: "Loading your characters…",
  saving: "Saving…",
  saved: "Saved to your account",
  error: "Not saved",
};

/**
 * Guest play, sign-in by emailed magic link (no passwords), and whether
 * saves are reaching the account. Renders nothing when accounts aren't
 * configured.
 *
 * Signed out is guest mode: characters work fully but live only in this
 * browser, so the bar says so and offers to keep them. Signing in merges
 * them into the account.
 */
export function AccountBar({
  account,
}: {
  account: {
    enabled: boolean;
    email: string | null;
    status: SyncStatus;
    error: string | null;
    notice: string | null;
    dismissNotice: () => void;
    guestCharacters: number;
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
        {account.notice && (
          <div className="account-notice">
            {account.notice}{" "}
            <button className="linkish" onClick={account.dismissNotice}>
              dismiss
            </button>
          </div>
        )}
      </span>
    );
  }

  if (sent) {
    return (
      <span className="account small muted">
        A sign-in link has been sent to {email}. Open it in this browser
        {account.guestCharacters > 0 ? ", so these characters are added to your account" : ""}.{" "}
        <button className="linkish" onClick={() => setSent(false)}>
          Use a different address
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
      {account.guestCharacters > 0 ? (
        <span
          className="guest-badge"
          title="These characters are saved in this browser only. Sign in to store them in an account; they will be added to it."
        >
          Not signed in · {account.guestCharacters} character{account.guestCharacters === 1 ? "" : "s"} saved in
          this browser
        </span>
      ) : (
        <span className="muted">Not signed in. Characters are saved in this browser.</span>
      )}{" "}
      <input
        type="email"
        required
        placeholder="Your email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />{" "}
      <button type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send a sign-in link"}
      </button>
      {problem && <div className="error small">{problem}</div>}
    </form>
  );
}
