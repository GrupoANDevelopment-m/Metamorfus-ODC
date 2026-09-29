// Natural-language intent parser.
//
// We send the user's free-form chat message to the cortex LLM with a
// system prompt that defines the available intents. The LLM returns
// a JSON object { intent, args, reply }. The router (action-router.mjs)
// then dispatches `intent` to the right action handler and uses
// `reply` as the cortex's natural-language confirmation.
//
// Recognized intents:
//
//   chat                  — pure conversation, no action
//   metamorphose          — turn the organism into a new system
//                          args: { systemPrompt: string }
//   forge_skill           — write a new skill
//                          args: { skillKey, pythonSource }
//   list_botnet_models    — show the botnet catalog
//                          args: { kind?: string }
//   forge_botnet_model    — create a new specialized botnet
//                          args: { name, kind, skills?, deps? }
//   mutate_botnet_model   — evolve an existing botnet
//                          args: { parentId, skills?, deps?, specialization? }
//   spawn_botnet          — start running a botnet
//                          args: { modelId, count }
//   broadcast_botnet      — send Python to a botnet's nodes
//                          args: { modelId, pythonSource }
//   list_botnet_runs      — show live botnet instances
//   kill_botnet           — stop a botnet instance
//                          args: { runId }
//   system_status         — health snapshot
//
// The router handles `chat` and `metamorphose` and `forge_botnet_model`
// etc. The LLM never executes anything itself — it just classifies.

const INTENT_SYSTEM = `//MARKER:INTENT_CLASSIFIER//
You are the cortex of the Metamorfos ODC organism. The operator is talking to you via chat. Your job is to:

1. Understand their intent.
2. Pick ONE of the supported intents below (or "chat" if they're just talking).
3. Extract arguments.
4. Write a short natural-language REPLY in Portuguese (BR) — this is what you'll say back while the action runs.

Output ONLY valid JSON of this shape:
{
  "intent": "<one of the supported intents>",
  "args":   { ...args },
  "reply":  "<short pt-BR message describing what you'll do, max 200 chars>"
}

Supported intents (use these EXACT strings):
- "chat"                  — pure conversation, no action
- "metamorphose"          — turn the organism into a new system
                            args: { "systemPrompt": "<the desired system>" }
- "forge_skill"           — write a new skill
                            args: { "skillKey": "<snake_case>_protocol", "pythonSource": "<python code>" }
- "list_botnet_models"    — show the botnet catalog
                            args: { "kind": "<optional kind filter>" }
- "forge_botnet_model"    — create a new specialized botnet
                            args: { "name": "<display name>", "kind": "vision|research|trading|scraping|security|generic", "skills": [...], "specialization": "..." }
- "mutate_botnet_model"   — evolve an existing botnet
                            args: { "parentId": "<uuid>", "skills": [...optional], "specialization": "...optional" }
- "spawn_botnet"          — start running a botnet
                            args: { "modelId": "<uuid>", "count": <integer> }
- "broadcast_botnet"      — send Python to a running botnet
                            args: { "modelId": "<uuid>", "pythonSource": "<python code>" }
- "list_botnet_runs"      — show live botnet instances
- "kill_botnet"           — stop a botnet instance
                            args: { "runId": "<uuid>" }
- "system_status"         — health snapshot

Special rules:
- If the user is asking about a specific botnet model and provides a name (not UUID), include "modelName": "<the name>" in args so the router can look it up.
- If you don't know enough arguments, ASK for them by using intent="chat" and writing a reply that asks the question.
- Never execute anything yourself — you only classify.
- Output ONLY valid JSON, no markdown fences, no prose.`;

export class IntentParser {
  /**
   * @param {import("../llm-library/router.mjs").LlmRouter} router
   * @param {string} [category]
   */
  constructor(router, category = "reasoning") {
    this.router = router;
    this.category = category;
  }

  /**
   * Parse a user message into { intent, args, reply }.
   * @param {string} message
   * @param {Array<{role: "user"|"assistant"|"system", content: string}>} [history]
   * @returns {Promise<{intent: string, args: any, reply: string, raw: string, model: string}>}
   */
  async parse(message, history = []) {
    if (typeof message !== "string" || message.trim().length === 0) {
      throw new Error("message is required");
    }
    const messages = [
      { role: "system", content: INTENT_SYSTEM },
      ...history.slice(-6), // keep recent context
      { role: "user", content: message.trim() },
    ];
    const result = await this.router.complete(this.category, {
      messages,
      temperature: 0.2,
      maxTokens: 1024,
    });
    const m = (result.content || "").match(/\{[\s\S]*\}/);
    if (!m) {
      // LLM didn't return JSON — fall back to chat.
      return { intent: "chat", args: { message }, reply: result.content || "", raw: result.content, model: result.model };
    }
    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return { intent: "chat", args: { message }, reply: result.content, raw: result.content, model: result.model };
    }
    return {
      intent: typeof parsed.intent === "string" ? parsed.intent : "chat",
      args: parsed.args && typeof parsed.args === "object" ? parsed.args : {},
      reply: typeof parsed.reply === "string" ? parsed.reply : "",
      raw: result.content,
      model: result.model,
    };
  }
}

export { INTENT_SYSTEM };
