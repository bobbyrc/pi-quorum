import { DefaultResourceLoader, createAgentSession, getAgentDir, SessionManager, } from "@earendil-works/pi-coding-agent";
const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];
const MAX_OUTPUT_CHARS = 24_000;
export function modelForMember(ctx, member) {
    const slash = member.modelKey.indexOf("/");
    return slash > 0
        ? ctx.modelRegistry.find(member.modelKey.slice(0, slash), member.modelKey.slice(slash + 1))
        : undefined;
}
export function sessionSummary(ctx) {
    return ctx.sessionManager
        .buildContextEntries()
        .slice(-16)
        .map((entry) => {
        if (entry.type !== "message")
            return "";
        const message = entry.message;
        const text = message.content
            ?.filter((part) => part.type === "text")
            .map((part) => part.text ?? "")
            .join("\n") ?? "";
        return text ? `${message.role ?? "message"}: ${text}` : "";
    })
        .filter(Boolean)
        .join("\n\n")
        .slice(-18_000);
}
export async function askReadOnlyMember(ctx, member, prompt, signal) {
    const model = modelForMember(ctx, member);
    if (!model)
        throw new Error(`Configured quorum member is unavailable: ${member.modelKey}`);
    const loader = new DefaultResourceLoader({
        cwd: ctx.cwd,
        agentDir: getAgentDir(),
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: "You are a read-only quorum member. Analyze only the supplied question and evidence. Never make changes, invoke tools that alter state, or give implementation instructions. Return only the requested JSON.",
    });
    await loader.reload();
    const { session } = await createAgentSession({
        cwd: ctx.cwd,
        model,
        thinkingLevel: member.thinking,
        tools: READ_ONLY_TOOLS,
        sessionManager: SessionManager.inMemory(),
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
    const abort = () => session.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
        await session.prompt(prompt);
        await session.agent.waitForIdle();
        if (!finalText.trim())
            throw new Error(`${member.modelKey} returned no usable answer`);
        return finalText.slice(0, MAX_OUTPUT_CHARS);
    }
    finally {
        signal?.removeEventListener("abort", abort);
        unsubscribe();
        session.dispose();
    }
}
