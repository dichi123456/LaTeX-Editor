/**
 * Kilo Code agent execution loop — ported from:
 * - packages/opencode/src/session/prompt.ts  (runLoop: while/step/finish/tool-calls)
 * - packages/opencode/src/session/processor.ts (DOOM_LOOP_THRESHOLD, parallel settle)
 * - packages/core/src/session/runner/llm.ts (isLastStep → MAX_STEPS_PROMPT + toolChoice none)
 * - packages/opencode/src/session/prompt/default.txt (batch parallel tools, minimize tokens)
 *
 * Not a simplified imitation: same exit conditions, same last-step policy, same doom-loop
 * fingerprint rule, tools from one assistant turn run in parallel then one follow-up request.
 */
import { dialog, BrowserWindow } from 'electron'
import { MAX_STEPS_PROMPT, DOOM_LOOP_THRESHOLD } from './max-steps'
import { TOOLS, executeTool, type ToolCall, type ToolResult } from '../tools'

export { MAX_STEPS_PROMPT, DOOM_LOOP_THRESHOLD }

/** Kilo agent.steps clamp for a desktop editor */
export function clampSteps(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return 15
  return Math.min(100, Math.max(1, v))
}

/** Kilo SessionProcessor fingerprint: tool name + arguments JSON string */
export function fingerprint(tc: ToolCall): string {
  return `${tc.function?.name || ''}::${tc.function?.arguments || ''}`
}

/** Kilo KiloSessionPrompt / payload prune: keep request body lean */
const REQUEST_PRUNE_CHARS = 48_000

function compactMessages(msgs: any[]): any[] {
  if (msgs.length <= 6) return msgs
  const system = msgs[0]
  const rest = msgs.slice(1)
  if (rest.length <= 4) return msgs
  const older = rest.slice(0, rest.length - 4)
  const newer = rest.slice(-4)
  const summary = {
    role: 'user',
    content: `【上下文摘要】此前对话已压缩。共 ${older.length} 条历史消息已省略。如有需要可重新 read_file 获取文件当前状态。`
  }
  return [system, summary, ...newer]
}

function approxChars(msgs: any[]): number {
  return msgs.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0)
}

async function askDoomLoop(mainWindow: BrowserWindow | null, toolName: string): Promise<boolean> {
  if (!mainWindow) return false
  try {
    // Kilo permission doom_loop: ask
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['停止循环', '允许继续'],
      defaultId: 0,
      cancelId: 0,
      title: '墨灵检测到循环调用',
      message: `检测到 ${toolName} 连续 ${DOOM_LOOP_THRESHOLD} 次以相同参数重复调用。`,
      detail: '选择「停止循环」将让模型改用其他方法或直接总结；选择「允许继续」可再执行一轮。'
    })
    return choice === 1
  } catch {
    return false
  }
}

export interface AgentLoopOptions {
  apiKey: string
  apiBase: string
  model: string
  messages: Array<Record<string, any>>
  temperature?: number
  /** OpenAI-compatible reasoning_effort: low | medium | high */
  reasoningEffort?: 'low' | 'medium' | 'high'
  enableTools?: boolean
  permissionMode?: string
  /** Kilo agent.steps */
  maxSteps?: number
  signal: AbortSignal
  send: (payload: Record<string, unknown>) => void
  onFileChanged?: (path: string) => void
}

export interface AgentLoopResult {
  success: boolean
  content?: string
  reasoning?: string
  error?: string
  cancelled?: boolean
}

/**
 * Kilo runLoop + processor settlement.
 *
 * Exit (Kilo prompt.ts):
 *   lastAssistant.finish && finish !== 'tool-calls' && !hasRealToolCalls → done
 * Last step (Kilo runner/llm.ts):
 *   inject MAX_STEPS_PROMPT as user message; tools omitted / tool_choice none
 * Doom loop (Kilo processor.ts):
 *   last DOOM_LOOP_THRESHOLD tool fingerprints identical → block or ask
 * Parallel tools (Kilo FiberSet):
 *   all tool_calls from one assistant turn settle concurrently, then next provider turn
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    apiKey,
    apiBase,
    model,
    messages,
    // Kilo-style coding agents: low temperature for deterministic tool use
    temperature = 0.2,
    reasoningEffort,
    enableTools = true,
    permissionMode = 'full',
    maxSteps: maxStepsRaw,
    signal,
    send,
    onFileChanged
  } = opts

  const maxSteps = clampSteps(maxStepsRaw)
  const url = apiBase.replace(/\/+$/, '') + '/chat/completions'
  let allMessages = [...messages]
  let fullReasoning = ''
  let fullFinalContent = ''

  /** completed tool fingerprints in order (Kilo processor recentParts) */
  const recentFingerprints: string[] = []
  let maxStepsPromptInjected = false
  let step = 0

  while (true) {
    if (signal.aborted) {
      send({ type: 'cancelled' })
      return { success: false, error: '已取消', cancelled: true }
    }

    step += 1
    const isLastStep = step >= maxSteps
    const useTools = enableTools && !isLastStep

    if (approxChars(allMessages) > REQUEST_PRUNE_CHARS) {
      allMessages = compactMessages(allMessages)
    }

    // Kilo runner/llm.ts: last step → user MAX_STEPS_PROMPT + no tools
    const requestMessages = [...allMessages]
    if (isLastStep && enableTools && !maxStepsPromptInjected) {
      requestMessages.push({ role: 'user', content: MAX_STEPS_PROMPT })
      maxStepsPromptInjected = true
      send({ type: 'step', current: step, max: maxSteps, final: true })
    } else {
      send({ type: 'step', current: step, max: maxSteps })
    }

    const body: any = {
      model,
      messages: requestMessages,
      temperature,
      stream: true
    }
    // OpenAI-compatible thinking depth; ignored by APIs that do not support it
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort
    }
    if (useTools) {
      body.tools = TOOLS
      // Kilo: toolChoice undefined (auto) unless last step / structured
      body.tool_choice = 'auto'
    } else {
      body.tool_choice = 'none'
    }

    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal
      })
    } catch (err: any) {
      if (signal.aborted || err?.name === 'AbortError') {
        send({ type: 'cancelled' })
        return { success: false, error: '已取消', cancelled: true }
      }
      send({ type: 'error', text: err.message })
      return { success: false, error: `请求失败: ${err.message}` }
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      const hint =
        resp.status === 401
          ? 'API Key 无效或已过期，请检查设置中的 Key。'
          : resp.status === 404
            ? '接口地址错误，请检查 API 地址是否包含 /v1（如 https://api.deepseek.com/v1）。'
            : resp.status === 429
              ? '请求过于频繁或额度不足，请稍后再试。'
              : ''
      const errMsg = `API 错误 ${resp.status}: ${errText.slice(0, 300)}${hint ? `\n${hint}` : ''}`
      send({ type: 'error', text: errMsg })
      return { success: false, error: errMsg }
    }

    if (!resp.body) {
      const errMsg = 'API 未返回响应流（body 为空）'
      send({ type: 'error', text: errMsg })
      return { success: false, error: errMsg }
    }

    // ---- Kilo SessionProcessor.handleEvent stream parse (OpenAI SSE) ----
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''
    const toolCallsMap: Map<number, any> = new Map()

    while (true) {
      if (signal.aborted) {
        try {
          reader.cancel()
        } catch {
          /* ignore */
        }
        send({ type: 'cancelled' })
        return { success: false, error: '已取消', cancelled: true }
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta
          if (delta?.content) {
            fullContent += delta.content
            send({ type: 'content', text: delta.content })
          }
          const reasoningText = delta?.reasoning_content ?? delta?.reasoning ?? delta?.thinking
          if (reasoningText) {
            fullReasoning += reasoningText
            send({ type: 'reasoning', text: reasoningText })
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index || 0
              if (!toolCallsMap.has(idx)) {
                toolCallsMap.set(idx, {
                  id: tc.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' }
                })
              }
              const existing = toolCallsMap.get(idx)
              if (tc.id) existing.id = tc.id
              if (tc.function?.name) existing.function.name += tc.function.name
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
            }
          }
        } catch {
          /* skip malformed SSE */
        }
      }
    }

    // Kilo exit: finish !== tool-calls && no real tool calls → text final answer
    if (toolCallsMap.size === 0) {
      fullFinalContent = fullContent
      send({ type: 'done' })
      return {
        success: true,
        content: fullContent,
        reasoning: fullReasoning
      }
    }

    // ---- assistant tool_calls message (OpenAI protocol) ----
    const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map((tc) => ({
      id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'function',
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments || '{}'
      }
    }))

    allMessages.push({
      role: 'assistant',
      content: fullContent || '',
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: tc.function
      }))
    })

    // ---- Doom loop check (Kilo processor.ts on tool-call) ----
    type Pending = { tc: ToolCall; blockedMsg?: string }
    const pending: Pending[] = []

    for (const tc of toolCalls) {
      const fp = fingerprint(tc)
      recentFingerprints.push(fp)
      if (recentFingerprints.length > DOOM_LOOP_THRESHOLD) {
        recentFingerprints.shift()
      }
      const doomHit =
        recentFingerprints.length === DOOM_LOOP_THRESHOLD &&
        recentFingerprints.every((x) => x === fp)

      if (doomHit) {
        if (permissionMode === 'ask') {
          const allow = await askDoomLoop(mainWindowRef, tc.function.name)
          if (!allow) {
            pending.push({
              tc,
              blockedMsg:
                `检测到 ${tc.function.name} 连续 ${DOOM_LOOP_THRESHOLD} 次相同参数调用（doom loop），用户已停止。` +
                `请立即停止调用工具，改用其他方法，或只输出文字总结目前进展与剩余步骤。`
            })
            recentFingerprints.length = 0
            continue
          }
          recentFingerprints.length = 0
        } else {
          pending.push({
            tc,
            blockedMsg:
              `【doom loop 拦截】${tc.function.name} 已连续 ${DOOM_LOOP_THRESHOLD} 次以相同参数重复。` +
              `本次未执行。请分析失败原因，换一种参数/路径/策略；若无法推进，改用文字总结并停止调用工具。`
          })
          recentFingerprints.length = 0
          continue
        }
      }
      pending.push({ tc })
    }

    // ---- Write approval (Kilo permission edit/ask) ----
    const settled: ToolResult[] = await Promise.all(
      pending.map(async ({ tc, blockedMsg }): Promise<ToolResult> => {
        if (blockedMsg) {
          send({
            type: 'tool_call',
            toolName: tc.function.name,
            args: tc.function.arguments
          })
          send({
            type: 'tool_result',
            toolName: tc.function.name,
            result: blockedMsg.slice(0, 500),
            success: false
          })
          return {
            toolCallId: tc.id,
            name: tc.function.name,
            result: blockedMsg,
            success: false
          }
        }

        send({
          type: 'tool_call',
          toolName: tc.function.name,
          args: tc.function.arguments
        })

        const isWrite = tc.function.name === 'write' || tc.function.name === 'edit' || tc.function.name === 'write_file' || tc.function.name === 'replace_text'
        if (isWrite && permissionMode === 'ask' && mainWindowRef) {
          let detail = ''
          try {
            const args = JSON.parse(tc.function.arguments || '{}')
            const filePath = args.filePath || args.path || '(未知)'
            if (tc.function.name === 'edit' || tc.function.name === 'replace_text') {
              detail = `将修改文件：\n${filePath}\n\n查找：\n${String(args.oldString ?? args.find ?? '').slice(0, 240)}\n\n替换为：\n${String(args.newString ?? args.replace ?? '').slice(0, 240)}`
            } else {
              detail = `将写入文件：\n${filePath}\n\n内容长度：${String(args.content || '').length} 字符`
            }
          } catch {
            detail = String(tc.function.arguments || '').slice(0, 300)
          }

          let choice = 0
          try {
            choice = dialog.showMessageBoxSync(mainWindowRef, {
              type: 'question',
              buttons: ['允许', '拒绝'],
              defaultId: 0,
              cancelId: 1,
              title: '墨灵请求写入',
              message: tc.function.name === 'edit' || tc.function.name === 'replace_text' ? '允许替换文件内容？' : '允许写入文件？',
              detail
            })
          } catch {
            choice = 0
          }

          if (choice === 1) {
            const msg = '用户拒绝了此次写入操作。'
            send({
              type: 'tool_result',
              toolName: tc.function.name,
              result: msg,
              success: false
            })
            return { toolCallId: tc.id, name: tc.function.name, result: `${msg}请告知用户已取消，不要重试写入。`, success: false }
          }
        }

        // Kilo FiberSet: settle tools from this turn in parallel
        const result = await executeTool(tc)
        send({
          type: 'tool_result',
          toolName: tc.function.name,
          result: result.result.slice(0, 500),
          success: result.success
        })
        if (result.success && isWrite) {
          try {
            const args = JSON.parse(tc.function.arguments || '{}')
            const p = args.filePath || args.path
            if (p) onFileChanged?.(p)
          } catch {
            /* ignore */
          }
        }
        return result
      })
    )

    for (const result of settled) {
      allMessages.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: result.result
      } as any)
    }

    // Kilo: tool_calls present → needsContinuation → next provider turn
  }
}

let mainWindowRef: BrowserWindow | null = null

export function setAgentLoopWindow(win: BrowserWindow | null): void {
  mainWindowRef = win
}
