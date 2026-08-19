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
  Select,
  Switch,
  useToast,
} from "@reminder/ui";
import { createReminderSchema, reminderPresets } from "@reminder/domain";

import { parseAmount } from "@/lib/amount";

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
  displayAmount?: { currency: Currency; minor: string } | null;
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
  currencyConversion: Provider;
};
type ProviderTest = {
  id: string;
  channel: "email" | "telegram";
  status: "pending" | "processing" | "retry" | "sent" | "failed" | "expired";
  attemptCount: number;
  error: { message: string } | null;
};
type ListResponse = {
  items: Reminder[];
  summary: {
    activeCount: number;
    dueWithinSevenDaysCount: number;
    amount: { currency: Currency; minor: string };
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
const currencyLabels: Record<Currency, string> = {
  IRR: "Iranian rial (IRR)",
  USD: "US dollar (USD)",
};
const gregorianMonthLabels = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const jalaliMonthLabels = [
  "Farvardin",
  "Ordibehesht",
  "Khordad",
  "Tir",
  "Mordad",
  "Shahrivar",
  "Mehr",
  "Aban",
  "Azar",
  "Dey",
  "Bahman",
  "Esfand",
];
const frequencyOptions = ["once", "daily", "weekly", "monthly", "yearly"].map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

function monthOptions(calendar: CalendarSystem) {
  const labels = calendar === "jalali" ? jalaliMonthLabels : gregorianMonthLabels;
  return labels.map((label, index) => ({ value: String(index + 1), label }));
}

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
  if (response.status === 401) {
    // The session ended while the tab was open. A full navigation is used rather
    // than the router so every other in-flight request is abandoned with it.
    const here = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?next=${encodeURIComponent(here)}`);
    throw new ApiError("Your session expired. Please sign in again.", "UNAUTHORIZED", null);
  }
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

function todayInCalendar(calendar: CalendarSystem): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat(
    calendar === "jalali" ? "en-US-u-ca-persian" : "en-US-u-ca-gregory",
    { day: "numeric", month: "numeric", year: "numeric" },
  ).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
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
  const calendar = settings?.calendarSystem ?? "gregorian";
  const today = todayInCalendar(calendar);
  return {
    title: "",
    description: "",
    type: "custom",
    customTypeLabel: "",
    state: "active",
    calendar,
    year: String(today.year),
    month: String(today.month),
    day: String(today.day),
    frequency: "monthly",
    interval: "1",
    amount: "",
    currency: settings?.defaultCurrency ?? "IRR",
    remindBeforeDays: "1",
    email: Boolean(settings?.emailEnabled && settings.providers.email.available),
    telegram: Boolean(settings?.telegramEnabled && settings.providers.telegram.available),
  };
}

function draftFromReminder(reminder: Reminder, settings: SettingsRecord | null): Draft {
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
    currency: reminder.amount?.currency ?? settings?.defaultCurrency ?? "IRR",
    remindBeforeDays: String(reminder.remindBeforeDays),
    email: reminder.channels.email,
    telegram: reminder.channels.telegram,
  };
}

function channelAllowed(
  settings: SettingsRecord | null,
  channel: "email" | "telegram",
): { allowed: boolean; hint: string | null } {
  const available = settings?.providers[channel].available ?? false;
  const globallyOn = channel === "email" ? settings?.emailEnabled : settings?.telegramEnabled;
  if (!available) return { allowed: false, hint: "Not configured by the server" };
  if (!globallyOn)
    return {
      allowed: false,
      hint: `Enable ${channel === "email" ? "Email" : "Telegram"} in Settings to use it here.`,
    };
  return { allowed: true, hint: null };
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
  const { toast } = useToast();
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
      const message = cause instanceof Error ? cause.message : "Could not load reminders.";
      setError(message);
      toast(message);
    } finally {
      setLoading(false);
    }
  }, [search, state, sort, type, toast]);

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
    const reminderCalendar = editing?.schedule.calendar ?? settings?.calendarSystem ?? "gregorian";
    const reminderCurrency = editing?.amount?.currency ?? settings?.defaultCurrency ?? "IRR";
    const body = {
      title: draft.title,
      description: draft.description || null,
      type: draft.type,
      customTypeLabel: draft.type === "custom" ? draft.customTypeLabel || null : null,
      state: draft.state,
      schedule: {
        calendar: reminderCalendar,
        anchorDate: {
          year: Number(draft.year),
          month: Number(draft.month),
          day: Number(draft.day),
        },
        frequency: draft.frequency,
        interval: Number(draft.interval),
      },
      amount: reminderPresets[draft.type].amountVisible
        ? parseAmount(draft.amount, reminderCurrency)
        : null,
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
    toast(editing ? "Reminder updated." : "Reminder created.", "success");
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
      toast("Settings saved.", "success");
      await load();
    } catch (cause) {
      if (isConnectionFailure(cause)) {
        setOffline(true);
        setMutationsBlocked(true);
      }
      throw cause;
    }
  };
  const sendProviderTest = async (channel: "email" | "telegram"): Promise<string> => {
    if (offline || mutationsBlocked)
      throw new Error("Youâ€™re offline. Reconnect before sending a test message.");
    const accepted = await request<{ statusUrl: string }>(`/api/v1/provider-tests/${channel}`, {
      method: "POST",
      body: JSON.stringify({ confirmed: true }),
    });
    const delays = [400, 800, 1_600, 3_200, 5_000];
    for (const delay of delays) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
      const test = await request<ProviderTest>(accepted.statusUrl);
      if (test.status === "sent") return `${channel === "email" ? "Email" : "Telegram"} test sent.`;
      if (["failed", "expired"].includes(test.status))
        throw new Error(test.error?.message ?? "The provider could not send the test message.");
    }
    return "Test message queued. It may take a moment to arrive.";
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
      <main className="app-main">
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
            value={summary ? (formatMoney(summary.amount) ?? "—") : "—"}
            loading={loading}
          />
        </section>
        <section className="dashboard-controls" aria-label="Reminder controls">
          <div className="dashboard-actions">
            <Button variant="secondary" onClick={openSettings} aria-label="Open settings">
              <Settings aria-hidden="true" size={18} />
              <span>Settings</span>
            </Button>
            <Button variant="primary" onClick={() => openReminder("new")}>
              <Plus aria-hidden="true" size={18} />
              Add reminder
            </Button>
          </div>
          <div className="toolbar">
            <label className="toolbar-field toolbar-field--search">
              Search
              <span className="search-field">
                <Search aria-hidden="true" size={18} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by title or notes"
                />
              </span>
            </label>
            <label className="toolbar-field">
              Type
              <Select
                aria-label="Type"
                value={type || "all"}
                onValueChange={(value) => setType(value === "all" ? "" : value)}
                options={[
                  { value: "all", label: "All types" },
                  ...Object.entries(typeLabels).map(([value, label]) => ({ value, label })),
                ]}
              />
            </label>
            <label className="toolbar-field">
              State
              <Select
                aria-label="State"
                value={state}
                onValueChange={setState}
                options={[
                  { value: "active", label: "Active" },
                  { value: "paused", label: "Paused" },
                  { value: "completed", label: "Completed" },
                  { value: "all", label: "All states" },
                ]}
              />
            </label>
            <label className="toolbar-field">
              Sort
              <Select
                aria-label="Sort"
                value={sort}
                onValueChange={setSort}
                options={[
                  { value: "nextOccurrence", label: "Next occurrence" },
                  { value: "title", label: "Title" },
                  { value: "amount", label: "Amount" },
                ]}
              />
            </label>
          </div>
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
          toast("Reminder deleted.", "success");
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
        onProviderTest={sendProviderTest}
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
  const amount = formatMoney(reminder.displayAmount ?? reminder.amount);
  const amountCurrency = (reminder.displayAmount ?? reminder.amount)?.currency;
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
      {reminder.description ? (
        <p className="card-description" title={reminder.description}>
          {reminder.description}
        </p>
      ) : (
        <p className="card-description" aria-hidden="true" />
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
        <span className="card-amount">
          {amount ? `${amount} ${amountCurrency}` : ""}
        </span>
      </div>
      <div className="card-footer">
        <div className="channel-list" aria-label="Notification channels">
          {reminder.channels.email && (
            <span role="img" aria-label="Email enabled" title="Email enabled">
              <Mail aria-hidden="true" size={16} />
            </span>
          )}
          {reminder.channels.telegram && (
            <span role="img" aria-label="Telegram enabled" title="Telegram enabled">
              <MessageCircle aria-hidden="true" size={16} />
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

function ConfirmationModal({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  confirmDisabled = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="confirmation-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(settings));
  const [initial, setInitial] = useState("");
  const [currentReminder, setCurrentReminder] = useState<Reminder | null>(reminder);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Reminder | null>(null);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"discard" | "delete" | null>(null);
  const initialized = useRef(false);
  useEffect(() => {
    if (!open) {
      initialized.current = false;
      return;
    }
    if (initialized.current) return;
    const next = reminder ? draftFromReminder(reminder, settings) : initialDraft(settings);
    setDraft(next);
    setInitial(JSON.stringify(next));
    setCurrentReminder(reminder);
    setConflict(null);
    initialized.current = true;
  }, [open, reminder, settings]);
  const dirty = JSON.stringify(draft) !== initial;
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const close = (nextOpen: boolean) => {
    if (!nextOpen && dirty) {
      setConfirmation("discard");
      return;
    }
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
      const message = cause instanceof Error ? cause.message : "Could not save reminder.";
      toast(message);
    } finally {
      setSaving(false);
    }
  };
  const requestDelete = () => {
    if (currentReminder) setConfirmation("delete");
  };
  const deleteReminder = async () => {
    if (!currentReminder) return;
    setConfirmation(null);
    setSaving(true);
    try {
      await request(`/api/v1/reminders/${currentReminder.id}`, {
        method: "DELETE",
        body: JSON.stringify({ expectedUpdatedAt: currentReminder.updatedAt }),
      });
      await onDeleted();
    } catch (cause) {
      if (isConnectionFailure(cause)) onConnectionFailure();
      const message = cause instanceof Error ? cause.message : "Could not delete reminder.";
      toast(message);
    } finally {
      setSaving(false);
    }
  };
  const typeChange = (value: ReminderType) => {
    const preset = reminderPresets[value];
    setDraft((current) => {
      return {
        ...current,
        type: value,
        frequency: preset.frequency,
        interval: String(preset.interval),
        amount: preset.amountVisible ? current.amount : "",
        state: current.state === "completed" ? "active" : current.state,
      };
    });
  };
  const emailChannel = channelAllowed(settings, "email");
  const telegramChannel = channelAllowed(settings, "telegram");
  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{currentReminder ? "Edit reminder" : "Add reminder"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="form-grid">
            {conflict && (
              <div className="form-error form-error--conflict" role="alert">
                This reminder was changed elsewhere. Reload the latest version before saving.
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    const next = draftFromReminder(conflict, settings);
                    setCurrentReminder(conflict);
                    setDraft(next);
                    setInitial(JSON.stringify(next));
                    setConflict(null);
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
              <Select
                aria-label="Type"
                value={draft.type}
                onValueChange={(value) => typeChange(value as ReminderType)}
                options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))}
              />
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
                  <Select
                    aria-label="Month"
                    value={draft.month}
                    onValueChange={(value) => change("month", value)}
                    options={monthOptions(draft.calendar)}
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
              <Select
                aria-label="Repeats"
                value={draft.frequency}
                onValueChange={(value) => change("frequency", value as Frequency)}
                options={frequencyOptions}
              />
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
                onChange={(event) => change("interval", event.target.value)}
              />
            </label>
            <p className="schedule-preview field--wide">
              <CalendarDays aria-hidden="true" size={17} />
              {preview
                ? `Next occurrence: ${formatDate(preview.nextOccurrenceDate, draft.calendar)}.`
                : (previewError ?? "Calculating the next occurrence…")}
            </p>
            {reminderPresets[draft.type].amountVisible && (
              <label className="field">
                Amount
                <input
                  inputMode="decimal"
                  value={draft.amount}
                  placeholder={draft.currency === "USD" ? "12.50" : "1,250,000"}
                  onChange={(event) => change("amount", event.target.value.replaceAll(",", ""))}
                />
              </label>
            )}
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
                <Select
                  aria-label="Status"
                  value={draft.state}
                  onValueChange={(value) => change("state", value as ReminderState)}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "paused", label: "Paused" },
                    ...(draft.frequency === "once"
                      ? [{ value: "completed", label: "Completed" }]
                      : []),
                  ]}
                />
              </label>
            )}
            <fieldset className="field field--wide">
              <legend>Notification channels</legend>
              <div className="channel-toggles">
                <label>
                  <Switch
                    checked={draft.email}
                    onCheckedChange={(value) => change("email", value)}
                    disabled={!emailChannel.allowed && !draft.email}
                  />
                  Email{" "}
                  {emailChannel.hint && <small>{emailChannel.hint}</small>}
                </label>
                <label>
                  <Switch
                    checked={draft.telegram}
                    onCheckedChange={(value) => change("telegram", value)}
                    disabled={!telegramChannel.allowed && !draft.telegram}
                  />
                  Telegram{" "}
                  {telegramChannel.hint && <small>{telegramChannel.hint}</small>}
                </label>
              </div>
            </fieldset>
            <DialogFooter className="field--wide">
              {currentReminder && (
                <Button
                  variant="destructive"
                  type="button"
                  onClick={requestDelete}
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
      <ConfirmationModal
        open={confirmation !== null}
        title={confirmation === "delete" ? "Delete reminder?" : "Discard changes?"}
        description={
          confirmation === "delete"
            ? `Delete ${currentReminder?.title ?? "this reminder"}? This cannot be undone.`
            : "Your unsaved changes will be lost."
        }
        confirmLabel={confirmation === "delete" ? "Delete reminder" : "Discard changes"}
        destructive
        confirmDisabled={saving}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConfirmation(null);
        }}
        onConfirm={() => {
          if (confirmation === "delete") {
            void deleteReminder();
            return;
          }
          setConfirmation(null);
          onOpenChange(false);
        }}
      />
    </>
  );
}

function SettingsModal({
  open,
  settings,
  onOpenChange,
  onSave,
  onProviderTest,
  mutationsBlocked,
}: {
  open: boolean;
  settings: SettingsRecord | null;
  onOpenChange: (open: boolean) => void;
  onSave: (settings: SettingsRecord) => Promise<void>;
  onProviderTest: (channel: "email" | "telegram") => Promise<string>;
  mutationsBlocked: boolean;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<SettingsRecord | null>(settings);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<"email" | "telegram" | null>(null);
  const [testToConfirm, setTestToConfirm] = useState<"email" | "telegram" | null>(null);
  useEffect(() => {
    if (open) {
      setDraft(settings);
      setTestToConfirm(null);
    }
  }, [open, settings]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      await onSave(draft);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save settings.";
      toast(message);
    } finally {
      setSaving(false);
    }
  };
  const sendTest = async () => {
    if (!testToConfirm) return;
    const channel = testToConfirm;
    setTestToConfirm(null);
    setTesting(channel);
    try {
      const status = await onProviderTest(channel);
      toast(status, "success");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not send the test message.";
      toast(message);
    } finally {
      setTesting(null);
    }
  };
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          {draft && (
            <form className="form-grid" onSubmit={save}>
              <label className="field field--wide">
                Display calendar
                <Select
                  aria-label="Display calendar"
                  value={draft.calendarSystem}
                  onValueChange={(value) =>
                    setDraft({ ...draft, calendarSystem: value as CalendarSystem })
                  }
                  options={[
                    { value: "gregorian", label: "Gregorian" },
                    { value: "jalali", label: "Solar Hijri (Jalali)" },
                  ]}
                />
              </label>
              <label className="field field--wide">
                Default currency
                <Select
                  aria-label="Default currency"
                  value={draft.defaultCurrency}
                  disabled={!draft.currencyConversion.available}
                  onValueChange={(value) =>
                    setDraft({ ...draft, defaultCurrency: value as Currency })
                  }
                  options={
                    draft.currencyConversion.available
                      ? [
                          { value: "IRR", label: "Iranian rial (IRR)" },
                          { value: "USD", label: "US dollar (USD)" },
                        ]
                      : [
                          {
                            value: draft.defaultCurrency,
                            label: currencyLabels[draft.defaultCurrency],
                          },
                        ]
                  }
                />
                {!draft.currencyConversion.available && (
                  <span className="field-setting">
                    Currency is locked to the server DEFAULT_CURRENCY because no Nerkh API token is
                    configured.
                  </span>
                )}
              </label>
              <fieldset className="field field--wide">
                <legend>Notifications</legend>
                <div className="settings-channel">
                  <div>
                    <strong>Email</strong>
                    {!draft.providers.email.available && <p>Not configured by the server</p>}
                  </div>
                  <Switch
                    checked={draft.emailEnabled}
                    onCheckedChange={(value) => setDraft({ ...draft, emailEnabled: value })}
                    disabled={!draft.providers.email.available}
                  />
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setTestToConfirm("email")}
                    disabled={
                      !draft.providers.email.available || mutationsBlocked || testing !== null
                    }
                  >
                    {testing === "email" && (
                      <LoaderCircle className="spin" aria-hidden="true" size={16} />
                    )}
                    Send test
                  </Button>
                </div>
                <div className="settings-channel">
                  <div>
                    <strong>Telegram</strong>
                    {!draft.providers.telegram.available && <p>Not configured by the server</p>}
                  </div>
                  <Switch
                    checked={draft.telegramEnabled}
                    onCheckedChange={(value) => setDraft({ ...draft, telegramEnabled: value })}
                    disabled={!draft.providers.telegram.available}
                  />
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setTestToConfirm("telegram")}
                    disabled={
                      !draft.providers.telegram.available || mutationsBlocked || testing !== null
                    }
                  >
                    {testing === "telegram" && (
                      <LoaderCircle className="spin" aria-hidden="true" size={16} />
                    )}
                    Send test
                  </Button>
                </div>
              </fieldset>
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
      <ConfirmationModal
        open={testToConfirm !== null}
        title={`Send ${testToConfirm === "telegram" ? "Telegram" : "Email"} test?`}
        description="A test message will be sent using the configured notification provider."
        confirmLabel="Send test"
        confirmDisabled={testing !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setTestToConfirm(null);
        }}
        onConfirm={() => void sendTest()}
      />
    </>
  );
}
