import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG, type QuorumConfig } from "./types.js";

const CONFIG_PATH = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "pi-quorum",
  "config.json",
);

function clamp(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function normalize(input: Partial<QuorumConfig>): QuorumConfig {
  return {
    members: Array.isArray(input.members)
      ? input.members.filter(
          (
            member,
          ): member is {
            modelKey: string;
            thinking?: QuorumConfig["members"][number]["thinking"];
          } =>
            Boolean(
              member &&
                typeof member.modelKey === "string" &&
                member.modelKey.includes("/"),
            ),
        )
      : [],
    contextMode:
      input.contextMode === "session-summary" ? "session-summary" : "fresh",
    maxRounds: clamp(input.maxRounds, DEFAULT_CONFIG.maxRounds, 1, 3),
    review: {
      enabled: input.review?.enabled === true,
      maxRounds: clamp(
        input.review?.maxRounds,
        DEFAULT_CONFIG.review.maxRounds,
        1,
        3,
      ),
      autoPromptFixes: input.review?.autoPromptFixes !== false,
    },
  };
}

export async function loadConfig(): Promise<QuorumConfig> {
  try {
    return normalize(
      JSON.parse(await readFile(CONFIG_PATH, "utf8")) as Partial<QuorumConfig>,
    );
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { ...DEFAULT_CONFIG, review: { ...DEFAULT_CONFIG.review } };
    throw new Error(
      `Unable to read pi-quorum configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function saveConfig(config: QuorumConfig): Promise<void> {
  const normalized = normalize(config);
  await mkdir(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  const temporary = `${CONFIG_PATH}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, CONFIG_PATH);
}
