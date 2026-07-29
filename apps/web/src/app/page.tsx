import { Button } from "@reminder/ui";
import { Settings } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link href="/" className="app-brand" aria-label="Reminder home">
          Reminde<span className="app-brand-accent">r</span>
        </Link>
        <div className="app-header-actions">
          <Button variant="secondary" type="button" aria-label="Settings" disabled>
            <Settings aria-hidden="true" size={18} />
            <span>Settings</span>
          </Button>
          <Button variant="primary" type="button" disabled>
            Add reminder
          </Button>
        </div>
      </header>
      <main className="app-main">
        <section className="app-hero">
          <h1>Never miss what comes around.</h1>
          <p>
            Phase 1 foundation is live. Dashboard cards, reminder editing, and notification delivery
            arrive in later phases.
          </p>
        </section>
        <section className="app-panel" aria-labelledby="empty-heading">
          <h2 id="empty-heading">No reminders yet</h2>
          <p>
            The Compose stack, health checks, and shared packages are ready. Add/edit flows unlock
            in Phase 3 after the domain and API land.
          </p>
          <Button variant="primary" type="button" disabled>
            Add reminder
          </Button>
        </section>
      </main>
    </div>
  );
}
