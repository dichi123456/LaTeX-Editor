/** Compatibility re-export — implementation lives in kilo/agent-loop.ts (Kilo Code port). */
export {
  runAgentLoop,
  setAgentLoopWindow,
  MAX_STEPS_PROMPT,
  DOOM_LOOP_THRESHOLD,
  clampSteps,
  fingerprint,
  type AgentLoopOptions,
  type AgentLoopResult
} from './kilo/agent-loop'
