import { type QuorumConfig } from "./types.js";
export declare function loadConfig(): Promise<QuorumConfig>;
export declare function saveConfig(config: QuorumConfig): Promise<void>;
