import { describe, expect, it } from "vitest";

import { APP_NAME } from "./index.js";

describe("domain scaffold", () => {
  it("exports the application name", () => {
    expect(APP_NAME).toBe("Reminder");
  });
});
