import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Ref } from 'vue'

export const useConfigStore = defineStore('config', () => {
  const config: Ref<AppConfig | null> = ref(null)
  const showSettings: Ref<boolean> = ref(false)
  const themeVersion: Ref<number> = ref(0)
  let mediaQuery: MediaQueryList | null = null
  let mediaListener: ((e: MediaQueryListEvent) => void) | null = null

  const resolvedTheme = computed<'light' | 'dark'>(() => {
    const t = config.value?.theme || 'dark'
    if (t === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return t === 'dark' ? 'dark' : 'light'
  })

  async function load(): Promise<void> {
    try {
      config.value = await window.electronAPI.loadConfig()
      if (!config.value.theme) {
        config.value.theme = 'dark'
      }
      console.log('[config store] loaded:', JSON.stringify(config.value).slice(0, 300))
    } catch (err) {
      console.error('[config store] load failed:', err)
      config.value = config.value || ({ theme: 'dark' } as AppConfig)
    }
    setupSystemThemeListener()
    applyTheme()
  }

  async function save(partial: Partial<AppConfig>): Promise<void> {
    if (!config.value) {
      console.warn('[config store] save skipped: config is null')
      return
    }
    Object.assign(config.value, partial)
    console.log('[config store] saving theme =', config.value.theme, 'showLineNumbers =', config.value.showLineNumbers)
    try {
      const ok = await window.electronAPI.saveConfig(config.value)
      console.log('[config store] save result:', ok)
    } catch (err) {
      console.error('[config store] save failed:', err)
    }
    if ('theme' in partial) {
      applyTheme()
    }
  }

  function applyTheme(): void {
    const resolved = resolvedTheme.value
    const el = document.documentElement
    el.setAttribute('data-theme', resolved)
    el.classList.remove('theme-light', 'theme-dark')
    el.classList.add(`theme-${resolved}`)
    themeVersion.value++
    console.log('[config store] applyTheme →', resolved, 'version =', themeVersion.value)
  }

  function setupSystemThemeListener(): void {
    if (mediaQuery && mediaListener) {
      mediaQuery.removeEventListener('change', mediaListener)
    }
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaListener = () => {
      if (config.value?.theme === 'system') {
        applyTheme()
      }
    }
    mediaQuery.addEventListener('change', mediaListener)
  }

  function toggleTheme(): void {
    const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']
    const current = config.value?.theme || 'dark'
    const idx = Math.max(0, order.indexOf(current))
    const next = order[(idx + 1) % order.length]
    console.log('[config store] toggleTheme:', current, '→', next)
    save({ theme: next })
  }

  function themeIcon(): string {
    const t = config.value?.theme || 'dark'
    if (t === 'system') return '🖥'
    return t === 'dark' ? '☀' : '☾'
  }

  function themeLabel(): string {
    const t = config.value?.theme || 'dark'
    if (t === 'system') return '跟随系统'
    return t === 'dark' ? '深色' : '浅色'
  }

  return {
    config,
    showSettings,
    resolvedTheme,
    themeVersion,
    load,
    save,
    applyTheme,
    toggleTheme,
    themeIcon,
    themeLabel
  }
})
