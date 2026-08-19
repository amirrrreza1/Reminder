import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppProviders } from "./providers";

import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Reminder",
  description: "Self-hosted recurring reminders for birthdays, bills, and obligations.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className={GeistSans.className}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
