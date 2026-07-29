/**
 * Provider ports for Phase 4. Phase 1 only defines the contract surface.
 */

export type NotificationChannel = "email" | "telegram";

export type ProviderReadiness = {
  channel: NotificationChannel;
  configured: boolean;
  reason?: string;
};

export type NotificationMessage = {
  reminderId: string;
  title: string;
  body: string;
};

export type ProviderReceipt = {
  providerMessageId?: string;
  acceptedAt: string;
};

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  readiness(): ProviderReadiness;
  send(message: NotificationMessage): Promise<ProviderReceipt>;
}
