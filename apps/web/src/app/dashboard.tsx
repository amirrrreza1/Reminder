"use client";

import {
  Bell,
  CalendarDays,
  CircleAlert,
  Edit3,
  LoaderCircle,
  Mail,
  MessageCircle,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Switch,
} from "@reminder/ui";
import { createReminderSchema } from "@reminder/domain";

type CalendarSystem = "gregorian" | "jalali";
type Currency = "IRR" | "USD";
type ReminderType =
  | "birthday"
  | "subscription"
  | "debt"
  | "rent"
  | "bill"
  | "insurance"
  | "membership"
  | "maintenance"
  | "medication_refill"
  | "tax_license"
  | "custom";
type ReminderState = "active" | "paused" | "completed";
type Frequency = "once" | "daily" | "weekly" | "monthly" | "yearly";

type Reminder = {
  id: string;
  title: string;
  description: string | null;
  type: ReminderType;
  customTypeLabel: string | null;
  state: ReminderState;
  schedule: {
    calendar: CalendarSystem;
    anchorDate: { year: number; month: number; day: number };
    frequency: Frequency;
    interval: number;
    nextOccurrenceDate: string | null;
  };
  amount: { currency: Currency; minor: string } | null;
  remindBeforeDays: number;
  channels: { email: boolean; telegram: boolean };
  updatedAt: string;
};

type Provider = { available: boolean; status: "configured" | "not_configured" };
type SettingsRecord = {
  calendarSystem: CalendarSystem;
  defaultCurrency: Currency;
  emailEnabled: boolean;
  telegramEnabled: boolean;
  updatedAt: string;
  providers: { email: Provider; telegram: Provider };
};
type ListResponse = {
  items: Reminder[];
  summary: {
    activeCount: number;
    dueWithinSevenDaysCount: number;
    amountsByCurrency: { IRR: string; USD: string };
  };
};

type SchedulePreview = { nextOccurrenceDate: string; nextNotificationAt: string };

class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly meta: unknown,
  ) {
    super(message);
  }
}

type Draft = {
  title: string;
  description: string;
  type: ReminderType;
  customTypeLabel: string;
  state: ReminderState;
  calendar: CalendarSystem;
  year: string;
  month: string;
  day: string;
  frequency: Frequency;
  interval: string;
  amount: string;
  currency: Currency;
  remindBeforeDays: string;
  email: boolean;
  telegram: boolean;
};

const typeLabels: Record<ReminderType, string> = {
  birthday: "Birthday",
  subscription: "Subscription",
  debt: "Debt / installment",
  rent: "Rent",
  bill: "Bill / utility",
  insurance: "Insurance",
  membership: "Membership",
  maintenance: "Maintenance",
  medication_refill: "Medication refill",
  tax_license: "Tax / license",
  custom: "Custom",
};
const presets: Record<ReminderType, { frequency: Frequency; interval: number; amount: boolean }> = {
  birthday: { frequency: "yearly", interval: 1, amount: false },
  subscription: { frequency: "monthly", interval: 1, amount: true },
  debt: { frequency: "monthly", interval: 1, amount: true },
  rent: { frequency: "monthly", interval: 1, amount: true },
  bill: { frequency: "monthly", interval: 1, amount: true },
  insurance: { frequency: "yearly", interval: 1, amount: true },
  membership: { frequency: "yearly", interval: 1, amount: true },
  maintenance: { frequency: "monthly", interval: 3, amount: false },
  medication_refill: { frequency: "monthly", interval: 1, amount: false },
  tax_license: { frequency: "yearly", interval: 1, amount: true },
  custom: { frequency: "monthly", interval: 1, amount: false },
};

function apiError(payload: unknown): { message: string; code: string | null; meta: unknown } {
  if (typeof payload === "object" && payload && "error" in payload) {
    const error = (payload as { error?: { message?: unknown; code?: unknown; meta?: unknown } })
      .error;
    if (typeof error?.message === "string")
      return {
        message: error.message,
        code: typeof error.code === "string" ? error.code : null,
        meta: error.meta ?? null,
      };
  }
  return { message: "Something went wrong. Please try again.", code: null, meta: null };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = apiError(body);
    throw new ApiError(error.message, error.code, error.meta);
  }
  return body as T;
}

function isConnectionFailure(cause: unknown): boolean {
  return (
    cause instanceof TypeError || (cause instanceof Error && cause.message === "Failed to fetch")
  );
}

function formatMoney(amount: { currency: Currency; minor: string } | null): string | null {
  if (!amount) return null;
  const fractionDigits = amount.currency === "USD" ? 2 : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: amount.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(amount.minor) / 10 ** fractionDigits);
}

function amountForInput(amount: Reminder["amount"]): string {
  if (!amount) return "";
  if (amount.currency === "IRR") return amount.minor;
  return (Number(amount.minor) / 100).toFixed(2);
}

function parseAmount(
  value: string,
  currency: Currency,
): { currency: Currency; minor: string } | null {
  const clean = value.trim();
  if (!clean) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean))
    throw new Error("Enter a non-negative amount with no currency symbol.");
  const [whole = "", fraction = ""] = clean.split(".");
  const minor = currency === "USD" ? `${whole}${fraction.padEnd(2, "0")}` : whole;
  if (BigInt(minor) > 9_999_999_999_999n)
    throw new Error("Amount exceeds the maximum supported value.");
  return { currency, minor };
}

function formatDate(iso: string | null, calendar: CalendarSystem): string {
  if (!iso) return "No future occurrence";
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat(calendar === "jalali" ? "en-US-u-ca-persian" : "en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

function countdown(iso: string | null): string {
  if (!iso) return "Completed";
  const today = new Date();
  const localToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const occurrence = Date.parse(`${iso}T00:00:00Z`);
  const days = Math.round((occurrence - localToday) / 86_400_000);
  if (days === 0) return "Today";
  if (days < 0) return "Overdue";
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

function recurrenceLabel(schedule: Reminder["schedule"]): string {
  const unit =
    schedule.frequency === "once"
      ? "Once"
      : schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1);
  if (schedule.frequency === "once" || schedule.interval === 1) return unit;
  return `Every ${schedule.interval} ${schedule.frequency}`;
}

function initialDraft(settings: SettingsRecord | null): Draft {
  const today = new Date();
  return {
    title: "",
    description: "",
    type: "custom",
    customTypeLabel: "",
    state: "active",
    calendar: settings?.calendarSystem ?? "gregorian",
    year: String(today.getFullYear()),
    month: String(today.getMonth() + 1),
    day: String(today.getDate()),
    frequency: "monthly",
    interval: "1",
    amount: "",
    currency: settings?.defaultCurrency ?? "IRR",
    remindBeforeDays: "1",
    email: Boolean(settings?.emailEnabled && settings.providers.email.available),
    telegram: Boolean(settings?.telegramEnabled && settings.providers.telegram.available),
  };
}

function draftFromReminder(reminder: Reminder): Draft {
  return {
    title: reminder.title,
    description: reminder.description ?? "",
    type: reminder.type,
    customTypeLabel: reminder.customTypeLabel ?? "",
    state: reminder.state,
    calendar: reminder.schedule.calendar,
    year: String(reminder.schedule.anchorDate.year),
    month: String(reminder.schedule.anchorDate.month),
    day: String(reminder.schedule.anchorDate.day),
    frequency: reminder.schedule.frequency,
    interval: String(reminder.schedule.interval),
    amount: amountForInput(reminder.amount),
    currency: reminder.amount?.currency ?? "IRR",
    remindBeforeDays: String(reminder.remindBeforeDays),
    email: reminder.channels.email,
    telegram: reminder.channels.telegram,
  };
}

function updateUrl(values: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  window.history.replaceState(null, "", query ? `/?${query}` : "/");
}

export function Dashboard() {
  const [items, setItems] = useState<Reminder[]>([]);
  const [summary, setSummary] = useState<ListResponse["summary"] | null>(null);
  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [mutationsBlocked, setMutationsBlocked] = useState(false);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [state, setState] = useState("active");
  const [sort, setSort] = useState("nextOccurrence");
  const [reminderModal, setReminderModal] = useState<Reminder | "new" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (type) params.set("type", type);
    if (state !== "active") params.set("state", state);
    if (sort !== "nextOccurrence") params.set("sort", sort);
    try {
      setError(null);
      const [list, currentSettings] = await Promise.all([
        request<ListResponse>(`/api/v1/reminders?${params.toString()}`),
        request<SettingsRecord>("/api/v1/settings"),
      ]);
      setItems(list.items);
      setSummary(list.summary);
      setSettings(currentSettings);
    } catch (cause) {
      if (isConnectionFailure(cause)) {
        setOffline(true);
        setMutationsBlocked(true);
      }
      setError(cause instanceof Error ? cause.message : "Could not load reminders.");
    } finally {
      setLoading(false);
    }
  }, [search, state, sort, type]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearch(params.get("q") ?? "");
    setType(params.get("type") ?? "");
    setState(params.get("state") ?? "active");
    setSort(params.get("sort") ?? "nextOccurrence");
    setSettingsOpen(params.get("modal") === "settings");
    firstLoad.current = false;
  }, []);
  useEffect(() => {
    if (!firstLoad.current) {
      updateUrl({
        q: search || null,
        type: type || null,
        state: state === "active" ? null : state,
        sort: sort === "nextOccurrence" ? null : sort,
      });
      load();
    }
  }, [load, search, state, sort, type]);
  useEffect(() => {
    const online = () => {
      setOffline(false);
      setMutationsBlocked(false);
      load();
    };
    const offline = () => setOffline(true);
    setOffline(!navigator.onLine);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [load]);

  const calendar = settings?.calendarSystem ?? "gregorian";
  const saveReminder = async (draft: Draft, editing: Reminder | null) => {
    if (offline || mutationsBlocked)
      throw new Error("You’re offline. Reconnect before saving changes.");
    const body = {
      title: draft.title,
      description: draft.description || null,
      type: draft.type,
      customTypeLabel: draft.type === "custom" ? draft.customTypeLabel || null : null,
      state: draft.state,
      schedule: {
        calendar: draft.calendar,
        anchorDate: {
          year: Number(draft.year),
          month: Number(draft.month),
          day: Number(draft.day),
        },
        frequency: draft.frequency,
        interval: Number(draft.interval),
      },
      amount: parseAmount(draft.amount, draft.currency),
      remindBeforeDays: Number(draft.remindBeforeDays),
      channels: { email: draft.email, telegram: draft.telegram },
    };
    const validation = createReminderSchema.safeParse(body);
    if (!validation.success)
      throw new Error(validation.error.issues[0]?.message ?? "Check the form fields.");
    if (editing)
      await request<Reminder>(`/api/v1/reminders/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...body, expectedUpdatedAt: editing.updatedAt }),
      });
    else
      await request<Reminder>("/api/v1/reminders", { method: "POST", body: JSON.stringify(body) });
    setReminderModal(null);
    setNotice(editing ? "Reminder updated." : "Reminder created.");
    await load();
  };
  const saveSettings = async (input: SettingsRecord) => {
    if (offline || mutationsBlocked)
      throw new Error("You’re offline. Reconnect before saving changes.");
    try {
      const next = await request<SettingsRecord>("/api/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({
          calendarSystem: input.calendarSystem,
          defaultCurrency: input.defaultCurrency,
          emailEnabled: input.emailEnabled,
          telegramEnabled: input.telegramEnabled,
          expectedUpdatedAt: input.updatedAt,
        }),
      });
      setSettings(next);
      setSettingsOpen(false);
      setNotice("Settings saved.");
      await load();
    } catch (cause) {
      if (isConnectionFailure(cause)) {
        setOffline(true);
        setMutationsBlocked(true);
      }
      throw cause;
    }
  };
  const openReminder = (value: Reminder | "new") => {
    setReminderModal(value);
    updateUrl({ modal: "reminder", id: value === "new" ? null : value.id });
  };
  const closeReminder = () => {
    setReminderModal(null);
    updateUrl({ modal: null, id: null });
  };
  const openSettings = () => {
    setSettingsOpen(true);
    updateUrl({ modal: "settings", id: null });
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    updateUrl({ modal: null });
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <a href="/" className="app-brand" aria-label="Reminder home">
          Reminde<span className="app-brand-accent">r</span>
        </a>
        <div className="app-header-actions">
          <Button variant="secondary" onClick={openSettings} aria-label="Open settings">
            <Settings aria-hidden="true" size={18} />
            <span>Settings</span>
          </Button>
          <Button variant="primary" onClick={() => openReminder("new")}>
            <Plus aria-hidden="true" size={18} />
            Add reminder
          </Button>
        </div>
      </header>
      <main className="app-main">
        <section className="dashboard-intro" aria-labelledby="page-title">
          <p className="eyebrow">Your recurring essentials</p>
          <h1 id="page-title">Never miss what comes around.</h1>
          <p>Track dates, amounts, and reminders in one calm place.</p>
        </section>
        {notice && (
          <p className="sr-only" role="status">
            {notice}
          </p>
        )}
        {offline && (
          <div className="status-banner">
            <CircleAlert aria-hidden="true" size={18} />
            You’re offline. Showing the last available reminders.
          </div>
        )}
        {error && (
          <div className="status-banner status-banner--error">
            <CircleAlert aria-hidden="true" size={18} />
            {error}
            <Button variant="ghost" onClick={load}>
              Retry
            </Button>
          </div>
        )}
        <section className="summary-grid" aria-label="Reminder summary">
          <Summary label="Active reminders" value={summary?.activeCount ?? "—"} loading={loading} />
          <Summary
            label="Due within 7 days"
            value={summary?.dueWithinSevenDaysCount ?? "—"}
            loading={loading}
          />
          <Summary
            label="Amounts"
            value={
              summary
                ? `${formatMoney({ currency: "IRR", minor: summary.amountsByCurrency.IRR })} · ${formatMoney({ currency: "USD", minor: summary.amountsByCurrency.USD })}`
                : "—"
            }
            loading={loading}
          />
        </section>
        <section className="toolbar" aria-label="Reminder controls">
          <label className="search-field">
            <Search aria-hidden="true" size={18} />
            <span className="sr-only">Search reminders</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search reminders"
            />
          </label>
          <label>
            <span className="sr-only">Filter by type</span>
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="">All types</option>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by state</span>
            <select value={state} onChange={(event) => setState(event.target.value)}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="all">All states</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Sort reminders</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="nextOccurrence">Next occurrence</option>
              <option value="title">Title</option>
              <option value="amount">Amount</option>
            </select>
          </label>
        </section>
        {loading ? (
          <div className="card-grid" aria-label="Loading reminders">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="reminder-card reminder-card--skeleton" key={index}>
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : items.length ? (
          <div className="card-grid">
            {items.map((item) => (
              <ReminderCard
                key={item.id}
                reminder={item}
                calendar={calendar}
                onEdit={() => openReminder(item)}
              />
            ))}
          </div>
        ) : (
          <section className="empty-state">
            <Bell aria-hidden="true" size={32} />
            <h2>No reminders found</h2>
            <p>
              {search || type || state !== "active"
                ? "Try changing your search or filters."
                : "Add a recurring moment to see what’s coming and get ready in time."}
            </p>
            {!search && !type && state === "active" && (
              <Button variant="primary" onClick={() => openReminder("new")}>
                <Plus aria-hidden="true" size={18} />
                Add reminder
              </Button>
            )}
          </section>
        )}
      </main>
      <ReminderModal
        open={reminderModal !== null}
        reminder={reminderModal === "new" ? null : reminderModal}
        settings={settings}
        onOpenChange={(open) => {
          if (!open) closeReminder();
        }}
        onSave={saveReminder}
        mutationsBlocked={offline || mutationsBlocked}
        onConnectionFailure={() => {
          setOffline(true);
          setMutationsBlocked(true);
        }}
        onDeleted={async () => {
          closeReminder();
          setNotice("Reminder deleted.");
          await load();
        }}
      />
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onOpenChange={(open) => {
          if (!open) closeSettings();
        }}
        onSave={saveSettings}
        mutationsBlocked={offline || mutationsBlocked}
      />
    </div>
  );
}

function Summary({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | number;
  loading: boolean;
}) {
  return (
    <article className="summary-card">
      <p>{label}</p>
      <strong className={loading ? "loading-text" : ""}>{value}</strong>
    </article>
  );
}

function ReminderCard({
  reminder,
  calendar,
  onEdit,
}: {
  reminder: Reminder;
  calendar: CalendarSystem;
  onEdit: () => void;
}) {
  const amount = formatMoney(reminder.amount);
  return (
    <article className="reminder-card">
      <div className="card-heading">
        <div>
          <p className="type-label">
            {reminder.type === "custom" && reminder.customTypeLabel
              ? reminder.customTypeLabel
              : typeLabels[reminder.type]}
          </p>
          <h2>{reminder.title}</h2>
        </div>
        <span className={`state-badge state-badge--${reminder.state}`}>{reminder.state}</span>
      </div>
      {reminder.description && (
        <p className="card-description" title={reminder.description}>
          {reminder.description}
        </p>
      )}
      <div className="date-block">
        <CalendarDays aria-hidden="true" size={18} />
        <div>
          <strong>{formatDate(reminder.schedule.nextOccurrenceDate, calendar)}</strong>
          <span>{countdown(reminder.schedule.nextOccurrenceDate)}</span>
        </div>
      </div>
      <div className="card-meta">
        <span>{recurrenceLabel(reminder.schedule)}</span>
        {amount && (
          <span>
            {amount} {reminder.amount?.currency}
          </span>
        )}
      </div>
      <div className="card-footer">
        <div className="channel-list" aria-label="Notification channels">
          {reminder.channels.email && (
            <span title="Email enabled">
              <Mail aria-hidden="true" size={16} />
              Email
            </span>
          )}
          {reminder.channels.telegram && (
            <span title="Telegram enabled">
              <MessageCircle aria-hidden="true" size={16} />
              Telegram
            </span>
          )}
          {!reminder.channels.email && !reminder.channels.telegram && <span>No channels</span>}
        </div>
        <Button variant="secondary" onClick={onEdit} aria-label={`Edit ${reminder.title}`}>
          <Edit3 aria-hidden="true" size={16} />
          Edit
        </Button>
      </div>
    </article>
  );
}

function ReminderModal({
  open,
  reminder,
  settings,
  onOpenChange,
  onSave,
  onDeleted,
  mutationsBlocked,
  onConnectionFailure,
}: {
  open: boolean;
  reminder: Reminder | null;
  settings: SettingsRecord | null;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: Draft, reminder: Reminder | null) => Promise<void>;
  onDeleted: () => Promise<void>;
  mutationsBlocked: boolean;
  onConnectionFailure: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(settings));
  const [initial, setInitial] = useState("");
  const [currentReminder, setCurrentReminder] = useState<Reminder | null>(reminder);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Reminder | null>(null);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [scheduleTouched, setScheduleTouched] = useState({ frequency: false, interval: false });
  const initialized = useRef(false);
  useEffect(() => {
    if (!open) {
      initialized.current = false;
      return;
    }
    if (initialized.current) return;
    const next = reminder ? draftFromReminder(reminder) : initialDraft(settings);
    setDraft(next);
    setInitial(JSON.stringify(next));
    setCurrentReminder(reminder);
    setError(null);
    setConflict(null);
    setScheduleTouched({ frequency: false, interval: false });
    initialized.current = true;
  }, [open, reminder, settings]);
  const dirty = JSON.stringify(draft) !== initial;
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const close = (nextOpen: boolean) => {
    if (!nextOpen && dirty && !window.confirm("Discard your unsaved changes?")) return;
    onOpenChange(nextOpen);
  };
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/v1/reminders/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schedule: {
              calendar: draft.calendar,
              anchorDate: {
                year: Number(draft.year),
                month: Number(draft.month),
                day: Number(draft.day),
              },
              frequency: draft.frequency,
              interval: Number(draft.interval),
            },
            remindBeforeDays: Number(draft.remindBeforeDays),
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Invalid schedule");
        setPreview((await response.json()) as SchedulePreview);
        setPreviewError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setPreview(null);
        setPreviewError(
          isConnectionFailure(cause)
            ? "Reconnect to preview the server-calculated occurrence."
            : "Enter a valid schedule to preview the next occurrence.",
        );
      }
    }, 150);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    draft.calendar,
    draft.day,
    draft.frequency,
    draft.interval,
    draft.month,
    draft.remindBeforeDays,
    draft.year,
    open,
  ]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(draft, currentReminder);
    } catch (cause) {
      if (isConnectionFailure(cause)) onConnectionFailure();
      if (cause instanceof ApiError && cause.code === "STALE_WRITE") {
        const latest =
          typeof cause.meta === "object" && cause.meta && "current" in cause.meta
            ? (cause.meta as { current: Reminder }).current
            : null;
        if (latest) setConflict(latest);
      }
      setError(cause instanceof Error ? cause.message : "Could not save reminder.");
    } finally {
      setSaving(false);
    }
  };
  const deleteReminder = async () => {
    if (
      !currentReminder ||
      !window.confirm(`Delete ${currentReminder.title}? This cannot be undone.`)
    )
      return;
    setSaving(true);
    setError(null);
    try {
      await request(`/api/v1/reminders/${currentReminder.id}`, {
        method: "DELETE",
        body: JSON.stringify({ expectedUpdatedAt: currentReminder.updatedAt }),
      });
      await onDeleted();
    } catch (cause) {
      if (isConnectionFailure(cause)) onConnectionFailure();
      setError(cause instanceof Error ? cause.message : "Could not delete reminder.");
    } finally {
      setSaving(false);
    }
  };
  const typeChange = (value: ReminderType) => {
    const preset = presets[value];
    setDraft((current) => {
      if (currentReminder) return { ...current, type: value };
      return {
        ...current,
        type: value,
        frequency: scheduleTouched.frequency ? current.frequency : preset.frequency,
        interval: scheduleTouched.interval ? current.interval : String(preset.interval),
      };
    });
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{currentReminder ? "Edit reminder" : "Add reminder"}</DialogTitle>
          <DialogDescription>
            Dates use the selected schedule calendar. The recurrence keeps that calendar even if
            display settings change.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="form-grid">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {conflict && (
            <div className="form-error form-error--conflict" role="alert">
              This reminder was changed elsewhere. Reload the latest version before saving.
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const next = draftFromReminder(conflict);
                  setCurrentReminder(conflict);
                  setDraft(next);
                  setInitial(JSON.stringify(next));
                  setConflict(null);
                  setError(null);
                }}
              >
                Reload latest
              </Button>
            </div>
          )}
          <label className="field field--wide">
            Title
            <input
              required
              maxLength={120}
              value={draft.title}
              onChange={(event) => change("title", event.target.value)}
              autoFocus
            />
          </label>
          <label className="field field--wide">
            Description
            <textarea
              maxLength={2000}
              rows={3}
              value={draft.description}
              onChange={(event) => change("description", event.target.value)}
            />
          </label>
          <label className="field">
            Type
            <select
              value={draft.type}
              onChange={(event) => typeChange(event.target.value as ReminderType)}
            >
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {draft.type === "custom" && (
            <label className="field">
              Custom type label
              <input
                required
                maxLength={40}
                value={draft.customTypeLabel}
                onChange={(event) => change("customTypeLabel", event.target.value)}
              />
            </label>
          )}
          <fieldset className="field field--wide">
            <legend>Schedule date</legend>
            <div className="date-fields">
              <label>
                Calendar
                <select
                  value={draft.calendar}
                  onChange={(event) => change("calendar", event.target.value as CalendarSystem)}
                >
                  <option value="gregorian">Gregorian</option>
                  <option value="jalali">Solar Hijri (Jalali)</option>
                </select>
              </label>
              <label>
                Year
                <input
                  required
                  inputMode="numeric"
                  value={draft.year}
                  onChange={(event) => change("year", event.target.value)}
                />
              </label>
              <label>
                Month
                <input
                  required
                  min="1"
                  max="12"
                  type="number"
                  value={draft.month}
                  onChange={(event) => change("month", event.target.value)}
                />
              </label>
              <label>
                Day
                <input
                  required
                  min="1"
                  max="31"
                  type="number"
                  value={draft.day}
                  onChange={(event) => change("day", event.target.value)}
                />
              </label>
            </div>
          </fieldset>
          <label className="field">
            Repeats
            <select
              value={draft.frequency}
              onChange={(event) => {
                setScheduleTouched((current) => ({ ...current, frequency: true }));
                change("frequency", event.target.value as Frequency);
              }}
            >
              {["once", "daily", "weekly", "monthly", "yearly"].map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Interval
            <input
              required
              min="1"
              max="99"
              type="number"
              disabled={draft.frequency === "once"}
              value={draft.interval}
              onChange={(event) => {
                setScheduleTouched((current) => ({ ...current, interval: true }));
                change("interval", event.target.value);
              }}
            />
          </label>
          <p className="schedule-preview field--wide">
            <CalendarDays aria-hidden="true" size={17} />
            {preview
              ? `Next occurrence: ${formatDate(preview.nextOccurrenceDate, draft.calendar)}.`
              : (previewError ?? "Calculating the next occurrence…")}
          </p>
          <label className="field">
            Amount
            <input
              inputMode="decimal"
              value={draft.amount}
              placeholder={draft.currency === "USD" ? "12.50" : "1,250,000"}
              onChange={(event) => change("amount", event.target.value.replaceAll(",", ""))}
            />
          </label>
          <label className="field">
            Currency
            <select
              value={draft.currency}
              onChange={(event) => change("currency", event.target.value as Currency)}
            >
              <option value="IRR">Iranian rial (IRR)</option>
              <option value="USD">US dollar (USD)</option>
            </select>
          </label>
          <label className="field">
            Remind before (days)
            <input
              required
              min="0"
              max="365"
              type="number"
              value={draft.remindBeforeDays}
              onChange={(event) => change("remindBeforeDays", event.target.value)}
            />
          </label>
          {currentReminder && (
            <label className="field">
              Status
              <select
                value={draft.state}
                onChange={(event) => change("state", event.target.value as ReminderState)}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                {currentReminder.schedule.frequency === "once" && (
                  <option value="completed">Completed</option>
                )}
              </select>
            </label>
          )}
          <fieldset className="field field--wide">
            <legend>Notification channels</legend>
            <div className="channel-toggles">
              <label>
                <Switch
                  checked={draft.email}
                  onCheckedChange={(value) => change("email", value)}
                  disabled={!settings?.providers.email.available}
                />
                Email{" "}
                {!settings?.providers.email.available && (
                  <small>Not configured by the server</small>
                )}
              </label>
              <label>
                <Switch
                  checked={draft.telegram}
                  onCheckedChange={(value) => change("telegram", value)}
                  disabled={!settings?.providers.telegram.available}
                />
                Telegram{" "}
                {!settings?.providers.telegram.available && (
                  <small>Not configured by the server</small>
                )}
              </label>
            </div>
          </fieldset>
          <DialogFooter>
            {currentReminder && (
              <Button
                variant="destructive"
                type="button"
                onClick={deleteReminder}
                disabled={saving || mutationsBlocked}
              >
                <Trash2 aria-hidden="true" size={17} />
                Delete reminder
              </Button>
            )}
            <Button
              variant="secondary"
              type="button"
              onClick={() => close(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving || mutationsBlocked}>
              {saving && <LoaderCircle className="spin" aria-hidden="true" size={17} />}
              {reminder ? "Save changes" : "Create reminder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SettingsModal({
  open,
  settings,
  onOpenChange,
  onSave,
  mutationsBlocked,
}: {
  open: boolean;
  settings: SettingsRecord | null;
  onOpenChange: (open: boolean) => void;
  onSave: (settings: SettingsRecord) => Promise<void>;
  mutationsBlocked: boolean;
}) {
  const [draft, setDraft] = useState<SettingsRecord | null>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setDraft(settings);
      setError(null);
    }
  }, [open, settings]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            These choices affect how dates are displayed and which channels are available by
            default. They never change an existing reminder’s recurrence calendar or currency.
          </DialogDescription>
        </DialogHeader>
        {draft && (
          <form className="form-grid" onSubmit={save}>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <label className="field field--wide">
              Display calendar
              <select
                value={draft.calendarSystem}
                onChange={(event) =>
                  setDraft({ ...draft, calendarSystem: event.target.value as CalendarSystem })
                }
              >
                <option value="gregorian">Gregorian</option>
                <option value="jalali">Solar Hijri (Jalali)</option>
              </select>
            </label>
            <label className="field field--wide">
              Default currency
              <select
                value={draft.defaultCurrency}
                onChange={(event) =>
                  setDraft({ ...draft, defaultCurrency: event.target.value as Currency })
                }
              >
                <option value="IRR">Iranian rial (IRR)</option>
                <option value="USD">US dollar (USD)</option>
              </select>
            </label>
            <fieldset className="field field--wide">
              <legend>Notifications</legend>
              <div className="settings-channel">
                <div>
                  <strong>Email</strong>
                  <p>
                    {draft.providers.email.available
                      ? "Configured by the server"
                      : "Not configured by the server"}
                  </p>
                </div>
                <Switch
                  checked={draft.emailEnabled}
                  onCheckedChange={(value) => setDraft({ ...draft, emailEnabled: value })}
                  disabled={!draft.providers.email.available}
                />
              </div>
              <div className="settings-channel">
                <div>
                  <strong>Telegram</strong>
                  <p>
                    {draft.providers.telegram.available
                      ? "Configured by the server"
                      : "Not configured by the server"}
                  </p>
                </div>
                <Switch
                  checked={draft.telegramEnabled}
                  onCheckedChange={(value) => setDraft({ ...draft, telegramEnabled: value })}
                  disabled={!draft.providers.telegram.available}
                />
              </div>
            </fieldset>
            <p className="provider-note">
              <SlidersHorizontal aria-hidden="true" size={17} />
              Provider test messages become available with the notification worker in Phase 4.
            </p>
            <DialogFooter>
              <Button
                variant="secondary"
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={saving || mutationsBlocked}>
                {saving && <LoaderCircle className="spin" aria-hidden="true" size={17} />}Save
                settings
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
