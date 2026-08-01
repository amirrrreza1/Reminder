import type { NotificationChannel } from "@reminder/domain";

export class NotFoundError extends Error {}

export class ProviderUnavailableError extends Error {
  constructor(readonly channel: NotificationChannel) {
    super(`${channel} is not configured by the server.`);
  }
}
