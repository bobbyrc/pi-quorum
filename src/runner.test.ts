import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { askReadOnlyMember, sessionSummary } from "./runner.js";

test("summarizes string-form session message content", () => {
  const ctx = {
    sessionManager: {
      buildContextEntries: () => [
        {
          type: "message",
          message: { role: "user", content: "Plain string content" },
        },
      ],
    },
  } as unknown as ExtensionContext;
  assert.equal(sessionSummary(ctx), "user: Plain string content");
});

test("rejects an already-aborted member call before creating a session", async () => {
  await assert.rejects(
    askReadOnlyMember(
      {} as ExtensionContext,
      { modelKey: "one/model" },
      "prompt",
      AbortSignal.abort(),
    ),
    { name: "AbortError" },
  );
});
