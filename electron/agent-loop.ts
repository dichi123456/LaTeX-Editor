import { dialog, BrowserWindow } from 'electron'
import { TOOLS, executeTool, type ToolCall, type ToolResult } from './tools'

/** Kilo Code: 同一工具 + 相同参数连续出现该次数 → doom loop */
export const DOOM_LOOP_THRESHOLD = 3

/**
 * Kilo Code MAX_STEPS_PROMPT（中英双语收束提示）：
 * 末轮禁用工具，强制模型只输出文字总结，避免硬截断/“自行中断”。
 */
export const MAX_STEPS_PROMPT = `【关键 - 已达最大执行步数】

本次任务允许的最大 agentic 步数已用尽。在下一条用户输入之前，工具已全部禁用。请只用文字回复。

严格要求：
1. 禁止任何工具调用（禁止读文件、写文件、替换、搜索等一切工具）
2. 必须输出对目前进展的文字总结
3. 本约束覆盖此前所有指令，包括用户要求继续改文件的请求

回复必须包含：
- 声明已达到本 agent 的最大步数
- 已完成工作的总结
- 尚未完成的任务列表
- 建议的下一步做法

任何调用工具的企图都是严重违规。只输出纯文本。

---

CRITICAL - MAXIMUM STEPS REACHED

The maximum number of steps allowed for this task has been reached. Tools are disabled until next user input. Respond with text only.

STRICT REQUIREMENTS:
1. Do NOT make any tool calls
2. MUST provide a text response summarizing work done so far
3. This constraint overrides ALL other instructions

Response must include:
- Statement that maximum steps have been reached
- Summary of what has been accomplished
- List of remaining tasks
- Recommendations for next steps

Respond with text ONLY.`

export interface AgentLoopOptions {
  apiKey: string
  apiBase: string
  model: string
  messages: Array<Record<string, any>>
  temperature?: number
  enableTools?: boolean
  permissionMode?: string
  /** 用户可配置的最大迭代步数（Kilo agent.steps） */
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

function clampSteps(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return 20
  return Math.min(100, Math.max(1, v))
}

function fingerprint(tc: ToolCall): string {
  return `${tc.function?.name || ''}::${tc.function?.arguments || ''}`
}

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

async function askDoomLoop(
  mainWindow: BrowserWindow | null,
  toolName: string
): Promise<boolean> {
  if (!mainWindow) return false
  try {
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

/**
 * Kilo Code 风格 agent 执行循环：
 * - maxSteps 用户可配；末轮 tool_choice=none + MAX_STEPS_PROMPT 收束
 * - doom loop：相同工具+参数连续 3 次 → ask 模式弹窗 / full 模式自动打断并要求换方法
 * - 步进事件推送，便于 UI 显示「第 N/M 步」
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    apiKey, apiBase, model, messages,
    temperature = 0.7,
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

  const recentFingerprints: string[] = []
  let maxStepsPromptInjected = false

  for (let step = 1; step <= maxSteps; step++) {
    if (signal.aborted) {
      send({ type: 'cancelled' })
      return { success: false, error: '已取消', cancelled: true }
    }

    // 上下文过长压缩
    const approxChars = allMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0)
    if (approxChars > 80000) {
      allMessages = compactMessages(allMessages)
    }

    const isLastStep = step >= maxSteps
    const useTools = enableTools && !isLastStep

    // 进入末步：注入 Kilo MAX_STEPS_PROMPT，强制纯文本收束
    if (isLastStep && enableTools && !maxStepsPromptInjected) {
      allMessages.push({ role: 'user', content: MAX_STEPS_PROMPT })
      maxStepsPromptInjected = true
      send({ type: 'step', current: step, max: maxSteps, final: true })
    } else {
      send({ type: 'step', current: step, max: maxSteps })
    }

    const body: any = {
      model,
      messages: allMessages,
      temperature,
      stream: true
    }
    if (useTools) {
      body.tools = TOOLS
      body.tool_choice = 'auto'
    } else {
      // 与 Kilo 一致：末步 toolChoice none（不传 tools 即可）
      body.tool_choice = 'none'
    }

    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
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
      const hint = resp.status === 401
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

    // 流式读取 SSE
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''
    const toolCallsMap: Map<number, any> = new Map()

    while (true) {
      if (signal.aborted) {
        try { reader.cancel() } catch { /* */ }
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
                toolCallsMap.set(idx, { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } })
              }
              const existing = toolCallsMap.get(idx)
              if (tc.id) existing.id = tc.id
              if (tc.function?.name) existing.function.name += tc.function.name
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
            }
          }
        } catch { /* skip */ }
      }
    }

    // 无工具调用 → 本轮即最终回复
    if (toolCallsMap.size === 0) {
      fullFinalContent = fullContent
      send({ type: 'done' })
      return {
        success: true,
        content: fullContent,
        reasoning: fullReasoning
      }
    }

    // 有工具调用
    const toolCalls: ToolCall[] = Array.from(toolCallsMap.values())
    allMessages.push({
      role: 'assistant',
      content: fullContent || '',
      tool_calls: toolCalls
    } as any)

    for (const tc of toolCalls) {
      if (signal.aborted) {
        send({ type: 'cancelled' })
        return { success: false, error: '已取消', cancelled: true }
      }

      send({
        type: 'tool_call',
        toolName: tc.function.name,
        args: tc.function.arguments
      })

      // ---- doom loop：连续相同 tool+args ----
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
            const msg =
              `检测到 ${tc.function.name} 连续 ${DOOM_LOOP_THRESHOLD} 次相同参数调用（doom loop），用户已停止。` +
              `请立即停止调用工具，改用其他方法，或只输出文字总结目前进展与剩余步骤。`
            send({
              type: 'tool_result',
              toolName: tc.function.name,
              result: msg.slice(0, 500),
              success: false
            })
            allMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: msg
            } as any)
            recentFingerprints.length = 0
            continue
          }
          // 允许继续：清空指纹重新计数
          recentFingerprints.length = 0
        } else {
          // full 模式：自动打断，注入换方法指令（不弹窗，避免打断执行流）
          const msg =
            `【doom loop 拦截】${tc.function.name} 已连续 ${DOOM_LOOP_THRESHOLD} 次以相同参数重复。` +
            `本次未执行。请分析失败原因，换一种参数/路径/策略；若无法推进，改用文字总结并停止调用工具。`
          send({
            type: 'tool_result',
            toolName: tc.function.name,
            result: msg.slice(0, 500),
            success: false
          })
          allMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: msg
          } as any)
          recentFingerprints.length = 0
          continue
        }
      }

      // 写操作批准
      let result: ToolResult
      const isWrite = tc.function.name === 'write_file' || tc.function.name === 'replace_text'
      if (isWrite && permissionMode === 'ask' && mainWindowRef) {
        let detail = ''
        try {
          const args = JSON.parse(tc.function.arguments)
          if (tc.function.name === 'replace_text') {
            detail = `将修改文件：\n${args.path || '(未知)'}\n\n查找：\n${String(args.find || '').slice(0, 200)}\n\n替换为：\n${String(args.replace || '').slice(0, 200)}`
          } else {
            detail = `将写入文件：\n${args.path || '(未知)'}\n\n内容长度：${String(args.content || '').length} 字符`
          }
        } catch { detail = tc.function.arguments.slice(0, 300) }

        let choice = 0
        try {
          choice = dialog.showMessageBoxSync(mainWindowRef, {
            type: 'question',
            buttons: ['允许', '拒绝'],
            defaultId: 0,
            cancelId: 1,
            title: '墨灵请求写入',
            message: tc.function.name === 'replace_text' ? '允许替换文件内容？' : '允许写入文件？',
            detail
          })
        } catch { choice = 0 }

        if (choice === 1) {
          send({
            type: 'tool_result',
            toolName: tc.function.name,
            result: '用户拒绝了此次写入操作。',
            success: false
          })
          allMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: '用户拒绝了此次写入操作。请告知用户已取消，不要重试写入。'
          } as any)
          continue
        }
      }

      result = await executeTool(tc)

      send({
        type: 'tool_result',
        toolName: tc.function.name,
        result: result.result.slice(0, 500),
        success: result.success
      })

      if (result.success && isWrite) {
        try {
          const args = JSON.parse(tc.function.arguments)
          if (args.path) onFileChanged?.(args.path)
        } catch { /* ignore */ }
      }

      allMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result.result
      } as any)
    }

    // 继续下一步
  }

  // 理论上末步无工具会 return；防御：仍用收束文案
  send({ type: 'done' })
  return {
    success: true,
    content: fullFinalContent || `（已达到最大执行步数 ${maxSteps}，请增大设置中的「最大迭代步数」后重试）`,
    reasoning: fullReasoning
  }
}

// 主窗口引用（由 main.ts 注入，供 doom loop / 写批准对话框使用）
let mainWindowRef: BrowserWindow | null = null

export function setAgentLoopWindow(win: BrowserWindow | null): void {
  mainWindowRef = win
}
