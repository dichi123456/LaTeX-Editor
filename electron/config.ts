import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

export interface AppConfig {
  engine: string
  extraArgs: string
  timeout: number
  autoSave: boolean
  autoSaveInterval: number
  autoCompile: boolean
  theme: 'light' | 'dark' | 'system'
  texlivePath: string
  showLineNumbers: boolean
  fontSize: number
  fontFamily: string
  lastOpenFolder: string | null
  lastOpenFile: string | null
  notifications: boolean
  mainWindow: { width: number; height: number }
}

export const DEFAULT_CONFIG: AppConfig = {
  engine: 'xelatex',
  extraArgs: '',
  timeout: 120,
  autoSave: true,
  autoSaveInterval: 30,
  autoCompile: false,
  theme: 'dark',
  texlivePath: '',
  showLineNumbers: true,
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace',
  lastOpenFolder: null,
  lastOpenFile: null,
  notifications: true,
  mainWindow: { width: 1400, height: 900 }
}

export function getConfigPath(): string {
  const userData = app.getPath('userData')
  const p = join(userData, 'config.json')
  console.log('[config] userData =', userData)
  console.log('[config] configPath =', p)
  return p
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const configPath = getConfigPath()
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8')
      console.log('[config] loaded raw:', raw.slice(0, 200))
      const parsed = JSON.parse(raw)
      const merged = { ...DEFAULT_CONFIG, ...parsed }
      console.log('[config] merged.theme =', merged.theme, 'showLineNumbers =', merged.showLineNumbers)
      return merged
    } else {
      console.log('[config] config file NOT found, using defaults')
    }
  } catch (err) {
    console.error('[config] 加载配置失败:', err)
  }
  return { ...DEFAULT_CONFIG }
}

export async function saveConfig(config: Partial<AppConfig>): Promise<boolean> {
  try {
    const configPath = getConfigPath()
    const dir = dirname(configPath)
    if (!existsSync(dir)) {
      console.log('[config] creating dir:', dir)
      mkdirSync(dir, { recursive: true })
    }
    const current = await loadConfig()
    const merged = { ...current, ...config }
    const json = JSON.stringify(merged, null, 2)
    console.log('[config] saving, theme =', merged.theme, 'showLineNumbers =', merged.showLineNumbers)
    writeFileSync(configPath, json, 'utf-8')
    console.log('[config] saved OK, size =', json.length)
    return true
  } catch (err) {
    console.error('[config] 保存配置失败:', err)
    return false
  }
}
