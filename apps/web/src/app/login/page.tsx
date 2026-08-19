import type { Metadata } from "next";

import { safeRedirectPath } from "@/lib/auth";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · Reminder",
  description: "Sign in to manage your reminders.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = params.next;
  // Sanitised on the server so the value handed to the client is already safe to
  // navigate to, whatever was in the query string.
  const redirectTo = safeRedirectPath(typeof next === "string" ? next : null);

  return <LoginForm redirectTo={redirectTo} />;
}
