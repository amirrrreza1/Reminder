import { afterEach, describe, expect, it, vi } from "vitest";

import { isProviderError, retryDelayMs, TelegramNotificationProvider } from "./index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("notification retry policy", () => {
  it("uses the documented sequence with bounded jitter", () => {
    expect(retryDelayMs(1, () => 0)).toBe(48_000);
    expect(retryDelayMs(2, () => 0.5)).toBe(300_000);
    expect(retryDelayMs(5, () => 1)).toBe(34_560_000);
    expect(retryDelayMs(99, () => 0.5)).toBe(28_800_000);
  });

  it("honors a provider retry-after delay when it is longer", () => {
    expect(retryDelayMs(1, () => 0, 180_000)).toBe(180_000);
  });
});

describe("Telegram provider", () => {
  it("escapes user text and disables previews", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 }),
      );
    globalThis.fetch = fetchMock;
    const provider = new TelegramNotificationProvider({ botToken: "secret", chatId: "123" });

    await expect(
      provider.send({ reminderId: "id", title: "<unsafe>", body: "A & B" }),
    ).resolves.toMatchObject({ providerMessageId: "42" });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.text).toBe("<b>&lt;unsafe&gt;</b>\nA &amp; B");
    expect(body.link_preview_options).toEqual({ is_disabled: true });
  });

  it("returns a safe authentication error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const provider = new TelegramNotificationProvider({ botToken: "secret", chatId: "123" });

    await expect(
      provider.send({ reminderId: "id", title: "Title", body: "Body" }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isProviderError(error) &&
        error.code === "PROVIDER_AUTH_FAILED" &&
        error.message ===
          "Telegram rejected the configured bot credentials. Check the server environment.",
    );
  });
});
