"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {});

  if (state.sent) {
    return (
      <div className="space-y-2" role="status">
        <p className="font-semibold">Check your inbox</p>
        <p className="subtext">
          If {state.sent} has access, a sign-in link is on its way. Open it in this browser.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="field-label">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="you@example.com"
          className="field-input"
        />
      </label>
      {state.error && <p className="text-sm text-coral">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
