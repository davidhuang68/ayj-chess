"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  KeyRound,
  Plus,
  ShieldCheck,
  CheckCircle2,
  X,
  LogOut,
} from "lucide-react";
import type { Club } from "@/lib/chess";
type Account = {
  id: string;
  username: string;
  member_id: string;
  active: number;
};
export default function ManagerAccounts({
  club,
  isOwner,
  demo,
  onChanged,
}: {
  club: Club;
  isOwner: boolean;
  demo: boolean;
  onChanged: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [memberId, setMemberId] = useState(""),
    [resetId, setResetId] = useState(""),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [oldPassword, setOldPassword] = useState(""),
    [newPassword, setNewPassword] = useState("");
  const refresh = useCallback(async () => {
    if (demo || !isOwner) return;
    try {
      const r = await fetch("/api/auth", { cache: "no-store" });
      const d = (await r.json()) as { accounts?: Account[]; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Could not refresh accounts.");
      setAccounts(d.accounts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh accounts.");
    }
  }, [demo, isOwner]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const save = async (action: Record<string, unknown>, success: string) => {
    if (pending || demo) return false;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Could not save the account.");
      setMessage(success);
      setPassword("");
      setNewPassword("");
      setOldPassword("");
      setUsername("");
      setMemberId("");
      setResetId("");
      await refresh();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setPending(false);
    }
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    void save(
      resetId
        ? { action: "resetPassword", accountId: resetId, password }
        : {
            action: "createAccount",
            username,
            password,
            ...(memberId ? { memberId } : {}),
          },
      resetId ? "Password reset." : "Account created.",
    );
  };
  if (demo)
    return (
      <section className="panel account-panel">
        <div className="panel-heading">
          <div>
            <h3>Manager accounts</h3>
            <p></p>
          </div>
          <ShieldCheck size={19} />
        </div>
        <p className="account-note">Demo accounts are disabled.</p>
      </section>
    );
  return (
    <div>
      <section className="panel account-panel">
        <div className="panel-heading">
          <div>
            <h3>Manager accounts</h3>
            <p></p>
          </div>
          <ShieldCheck size={19} />
        </div>
        {isOwner ? (
          <>
            <div className="manager-list">
              {club.members.map((member) => {
                const account = accounts.find((a) => a.member_id === member.id);
                return (
                  <div className="manager-row" key={member.id}>
                    <span className="avatar">
                      <KeyRound size={16} />
                    </span>
                    <div>
                      <strong>
                        {account?.username ?? member.username ?? member.email}
                      </strong>
                      <small>
                        {member.role === "owner"
                          ? "Admin"
                          : "Tournament manager"}
                        {!account
                          ? " · login not created"
                          : account.active
                            ? ""
                            : " · disabled"}
                      </small>
                    </div>
                    {account && member.role === "manager" ? (
                      <div className="account-actions">
                        <button
                          className="text-button"
                          onClick={() => {
                            setResetId(account.id);
                            setMemberId("");
                            setUsername(account.username);
                            setPassword("");
                            setMessage("");
                            setError("");
                          }}
                        >
                          Reset password
                        </button>
                        <button
                          className="text-button"
                          disabled={pending}
                          onClick={() =>
                            void save(
                              {
                                action: "setAccountActive",
                                accountId: account.id,
                                active: !account.active,
                              },
                              account.active
                                ? "Manager login disabled."
                                : "Manager login enabled.",
                            )
                          }
                        >
                          {account.active ? "Disable login" : "Enable login"}
                        </button>
                      </div>
                    ) : !account && member.role === "manager" ? (
                      <button
                        className="text-button"
                        onClick={() => {
                          setMemberId(member.id);
                          setResetId("");
                          setUsername(
                            member.email
                              .split("@")[0]
                              .replace(/[^a-zA-Z0-9._-]/g, ""),
                          );
                          setPassword("");
                          setMessage("");
                          setError("");
                        }}
                      >
                        Create login
                      </button>
                    ) : (
                      <CheckCircle2 size={17} color="#819d72" />
                    )}
                  </div>
                );
              })}
            </div>
            <form className="account-form" onSubmit={create}>
              <h3>
                {resetId
                  ? "Reset manager password"
                  : memberId
                    ? "Create login for existing manager"
                    : "Add manager"}
              </h3>
              {(memberId || resetId) && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setMemberId("");
                    setResetId("");
                    setUsername("");
                    setPassword("");
                  }}
                >
                  Cancel selection <X size={12} />
                </button>
              )}
              <label>
                Username
                <input
                  name="manager-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  minLength={3}
                  maxLength={32}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}"
                  disabled={pending || !!resetId}
                  required
                />
              </label>
              <label>
                {resetId ? "New password" : "Initial password"}
                <input
                  name="manager-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  maxLength={72}
                  required
                  disabled={pending}
                />
              </label>
              <p className="form-help"></p>
              <button
                className="button primary"
                type="submit"
                disabled={pending}
              >
                {resetId ? <KeyRound size={15} /> : <Plus size={15} />}{" "}
                {pending
                  ? "Saving…"
                  : resetId
                    ? "Reset password"
                    : "Create account"}
              </button>
            </form>
          </>
        ) : (
          <p className="account-note">Admin access required.</p>
        )}
        {message && (
          <p className="account-success" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="login-error account-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="panel account-panel personal-password">
        <div className="panel-heading">
          <div>
            <h3>Your password</h3>
            <p>Other sessions will be signed out.</p>
          </div>
          <KeyRound size={18} />
        </div>
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              { action: "changePassword", oldPassword, password: newPassword },
              "Your password has been changed.",
            );
          }}
        >
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              required
              disabled={pending}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              maxLength={72}
              required
              disabled={pending}
            />
          </label>
          <button className="button secondary" type="submit" disabled={pending}>
            Change password
          </button>
        </form>
        <button
          className="text-button account-signout"
          onClick={async () => {
            await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "logout" }),
            });
            window.location.reload();
          }}
        >
          <LogOut size={15} />
          Sign out
        </button>
      </section>
    </div>
  );
}
