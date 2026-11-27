import "server-only";
import { anthropicBase, anthropicKey } from "../config/env";
import { askJson, type JsonAsk } from "./messages";

// The portal's one door to the Claude API, for work it does on its own with no chat
// open (docs/FACTORY.md, "API credits"). Conversations about the owner's data go
// through the Claude connector instead. The key lives in Vercel only.

/** Whether the key is set, so a page can offer what needs Claude. */
export function claudeReady(): boolean {
  return anthropicKey() !== null;
}

/** Asks Claude once for JSON that matches the schema. Throws AiError. */
export function askClaude(ask: JsonAsk): Promise<unknown> {
  return askJson(ask, { key: anthropicKey(), base: anthropicBase() });
}
