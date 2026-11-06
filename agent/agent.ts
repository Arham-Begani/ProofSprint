import { defineAgent } from "eve";

export default defineAgent({
  model: "openai/gpt-6-astra",
  reasoning: "xhigh",
  defaultTools: false,
  tool: false,
  limits: {
    sessionUsage: ({ window }) => window.inputTokens - window.cacheReadTokens >= 40000 || window.outputTokens >= 12000,
  },
});
