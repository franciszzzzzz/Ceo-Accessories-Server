import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { shutdownServer } from "../../src/server.js";

describe("graceful shutdown", () => {
  it("closes HTTP first, then Redis, then PostgreSQL", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const events: string[] = [];

    await shutdownServer(
      server,
      async () => {
        events.push("redis");
      },
      async () => {
        events.push("postgres");
      },
    );

    expect(server.listening).toBe(false);
    expect(events).toEqual(["redis", "postgres"]);
  });
});
