export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: DirEntry[]
}

export interface CompileIssue {
  type: 'error' | 'warning'
  message: string
  line: number | null
  file: string | null
}
