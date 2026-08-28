import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { MemberConfig } from "./types.js";
export declare function modelForMember(ctx: ExtensionContext, member: MemberConfig): Model<any> | undefined;
export declare function sessionSummary(ctx: ExtensionContext): string;
export declare function askReadOnlyMember(ctx: ExtensionContext, member: MemberConfig, prompt: string, signal?: AbortSignal): Promise<string>;
