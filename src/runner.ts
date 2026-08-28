import {
  DefaultResourceLoader,
  createAgentSession,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { MemberConfig } from "./types.js";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];
const MAX_OUTPUT_CHARS = 24_000;

export interface MemberRunnerDependencies {
  createLoader: (
    options: ConstructorParameters<typeof DefaultResourceLoader>[0],
  ) => DefaultResourceLoader;
  createSession: typeof createAgentSession;
  getAgentDirectory: typeof getAgentDir;
  createSessionManager: typeof SessionManager.inMemory;
}

const DEFAULT_DEPENDENCIES: MemberRunnerDependencies = {
  createLoader: (options) => new DefaultResourceLoader(options),
  createSession: createAgentSession,
  getAgentDirectory: getAgentDir,
  createSessionManager: () => SessionManager.inMemory(),
};

export function modelForMember(
  ctx: ExtensionContext,
  member: MemberConfig,
): Model<any> | undefined {
  const slash = member.modelKey.indexOf("/");
  return slash > 0
    ? ctx.modelRegistry.find(
        member.modelKey.slice(0, slash),
        member.modelKey.slice(slash + 1),
      )
    : undefined;
}

export function sessionSummary(ctx: ExtensionContext): string {
  return ctx.sessionManager
    .buildContextEntries()
    .slice(-16)
    .map((entry) => {
      if (entry.type !== "message") return "";
      const message = entry.message as {
        role?: string;
        content?: string | Array<{ type?: string; text?: string }>;
      };
      const text =
        typeof message.content === "string"
          ? message.content
          : (message.content
              ?.filter((part) => part.type === "text")
              .map((part) => part.text ?? "")
              .join("\n") ?? "");
      return text ? `${message.role ?? "message"}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(-18_000);
}

export async function askReadOnlyMember(
  ctx: ExtensionContext,
  member: MemberConfig,
  prompt: string,
  signal?: AbortSignal,
  dependencies: MemberRunnerDependencies = DEFAULT_DEPENDENCIES,
): Promise<string> {
  signal?.throwIfAborted();
  const model = modelForMember(ctx, member);
  if (!model)
    throw new Error(
      `Configured quorum member is unavailable: ${member.modelKey}`,
    );

  const loader = dependencies.createLoader({
    cwd: ctx.cwd,
    agentDir: dependencies.getAgentDirectory(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt:
      "You are a read-only quorum member. Analyze only the supplied question and evidence. Never make changes, invoke tools that alter state, or give implementation instructions. Return only the requested JSON.",
  });
  await loader.reload();
  const { session } = await dependencies.createSession({
    cwd: ctx.cwd,
    model,
    thinkingLevel: member.thinking,
    tools: READ_ONLY_TOOLS,
    sessionManager: dependencies.createSessionManager(),
    resourceLoader: loader,
  });
  let finalText = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type !== "message_end" || event.message.role !== "assistant")
      return;
    finalText = event.message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  });
  const abort = () => void session.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) {
      abort();
      signal.throwIfAborted();
    }
    await session.prompt(prompt);
    await session.agent.waitForIdle();
    signal?.throwIfAborted();
    if (!finalText.trim())
      throw new Error(`${member.modelKey} returned no usable answer`);
    return finalText.slice(0, MAX_OUTPUT_CHARS);
  } finally {
    signal?.removeEventListener("abort", abort);
    unsubscribe();
    session.dispose();
  }
}
