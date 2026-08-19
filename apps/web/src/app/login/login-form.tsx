"use client";

import { Bell, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, useToast } from "@reminder/ui";

const GENERIC_ERROR = "Something went wrong. Try again.";

async function errorMessageFor(response: Response): Promise<string> {
  if (response.status === 401) return "That password is incorrect.";
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After") ?? 0);
    const minutes = Math.max(1, Math.ceil(retryAfter / 60));
    return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  if (response.status === 503) return "No password is configured on the server.";
  return GENERIC_ERROR;
}

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const message = await errorMessageFor(response);
        setError(message);
        toast(message);
        setPassword("");
        setPending(false);
        return;
      }
      // refresh() clears the router cache so the dashboard is fetched with the new
      // cookie rather than served from a pre-login cache entry.
      router.replace(redirectTo);
      router.refresh();
    } catch {
      setError(GENERIC_ERROR);
      toast(GENERIC_ERROR);
      setPending(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <span className="login-mark" aria-hidden="true">
          <Bell size={28} />
        </span>
        <div className="login-heading">
          <h1>Reminder</h1>
          <p>Enter the password to open your dashboard.</p>
        </div>

        <label className="field field--wide login-field" htmlFor="login-password">
          Password
          <span className="login-input">
            <input
              id="login-password"
              name="password"
              type={revealed ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              required
              disabled={pending}
              aria-invalid={error ? true : undefined}
            />
            <button
              type="button"
              className="login-reveal"
              onClick={() => setRevealed((current) => !current)}
              aria-label={revealed ? "Hide password" : "Show password"}
              aria-pressed={revealed}
            >
              {revealed ? (
                <EyeOff aria-hidden="true" size={18} />
              ) : (
                <Eye aria-hidden="true" size={18} />
              )}
            </button>
          </span>
        </label>

        <Button type="submit" variant="primary" className="login-submit" disabled={pending}>
          {pending ? (
            <>
              <LoaderCircle aria-hidden="true" className="spin" size={18} />
              Signing in
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </main>
  );
}
