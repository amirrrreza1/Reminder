import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { TooltipProvider } from "@reminder/ui";

import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Reminder",
  description: "Self-hosted recurring reminders for birthdays, bills, and obligations.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className={GeistSans.className}>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
