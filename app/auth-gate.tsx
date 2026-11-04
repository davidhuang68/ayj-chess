"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Boardroom from "./boardroom";
type AuthStatus = {
  ready: boolean;
  setupAllowed: boolean;
  setupKeyRequired?: boolean;
  user: { name: string; role: string } | null;
  error?: string;
};
export default function AuthGate() {
  const [auth, setAuth] = useState<AuthStatus | null>(null),
    [demo, setDemo] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [show, setShow] = useState(false);
  const setupKey = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/auth", {
        cache: "no-store",
        headers: setupKey.current
          ? { "x-boardroom-setup-key": setupKey.current }
          : {},
      });
      const d = (await r.json()) as AuthStatus;
      if (!r.ok) throw new Error(d.error ?? "Could not connect.");
      setAuth(d);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    }
  }, []);
  useEffect(() => {
    const key = new URLSearchParams(location.hash.slice(1)).get("owner-setup");
    if (key && /^[a-f0-9]{64}$/.test(key)) {
      setupKey.current = key;
      history.replaceState(null, "", location.pathname + location.search);
    }
    if (new URLSearchParams(location.search).get("demo") === "1") {
      setDemo(true);
      return;
    }
    void refresh();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh]);
  const setup = !!auth && !auth.ready && auth.setupAllowed;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setError("");
    if (setup && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(setup && setupKey.current
            ? { "x-boardroom-setup-key": setupKey.current }
            : {}),
        },
        body: JSON.stringify({
          action: setup ? "setup" : "login",
          username,
          password,
        }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Could not sign in.");
      setPassword("");
      setConfirmation("");
      setupKey.current = null;
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in.");
    } finally {
      setPending(false);
    }
  };
  if (demo || auth?.user) return <Boardroom />;
  return (
    <main className="login">
      <section className="panel">
        <h1>AYJ Chess</h1>
        <h2>{setup ? "Create admin account" : "Sign in"}</h2>
        {!auth && !error ? (
          <p>Loading…</p>
        ) : auth && !auth.ready && !setup ? (
          <p>Use the private setup link to create the admin account.</p>
        ) : (
          auth && (
            <form onSubmit={submit}>
              <label>
                Username
                <input
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  minLength={3}
                  maxLength={32}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}"
                  required
                  disabled={pending}
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type={show ? "text" : "password"}
                  autoComplete={setup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={72}
                  required
                  disabled={pending}
                />
              </label>
              {setup && (
                <>
                  <label>
                    Confirm password
                    <input
                      type={show ? "text" : "password"}
                      autoComplete="new-password"
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      maxLength={72}
                      required
                      disabled={pending}
                    />
                  </label>
                </>
              )}
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={show}
                  onChange={(e) => setShow(e.target.checked)}
                />
                Show password
              </label>
              <button className="primary" disabled={pending}>
                {pending
                  ? "Please wait…"
                  : setup
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>
          )
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {error && !auth && (
          <button onClick={() => void refresh()}>Retry</button>
        )}
      </section>
    </main>
  );
}
