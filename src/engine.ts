import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface EngineResult {
  ok: boolean
  success?: boolean
  error_kind?: string
  error?: string
  hint?: string
  python?: string
  version?: string
  bundle?: string
  message?: string
  results?: unknown
  result?: unknown
  converted?: unknown
  from_ucum?: string
  to_ucum?: string
  reason?: string
}

const PYTHON_CANDIDATES = ['python3.14', 'python3.13', 'python3.12', 'python3']

export function bridgePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'bridge', 'dsh_bridge.py')
}

export function discoverPython(configured: string): string {
  const explicit = configured.trim() || process.env.MIROBODY_PYTHON?.trim() || ''
  if (explicit) return explicit
  for (const bin of PYTHON_CANDIDATES) {
    const found = spawnSync('/usr/bin/which', [bin], { encoding: 'utf8' })
    const path = found.stdout.trim()
    if (found.status === 0 && path && existsSync(path)) return path
  }
  return 'python3'
}

/**
 * The whole environment of the Python bridge. Never the harness's own (API keys, tokens, provider
 * settings): only what a Python process needs to start (PATH, HOME, locale, TMPDIR) and what
 * bridge/dsh_bridge.py reads (MIROBODY_HOME, the optional source checkout it puts on sys.path).
 * PYTHONNOUSERSITE=1 keeps ~/.local site-packages out, so mirobody must be installed in the
 * interpreter's own site-packages (a venv); PYTHONPATH is not passed, mirobodyHome is the way to add
 * a checkout. Not a sandbox.
 */
export function bridgeEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    LANG: process.env.LANG || 'C.UTF-8',
    MIROBODY_HOME: home.trim(),
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  }
  for (const name of ['LC_ALL', 'TMPDIR'] as const) {
    const value = process.env[name]
    if (value) env[name] = value
  }
  return env
}

function parseBridge(stdout: string, stderr: string, status: number | null): EngineResult {
  const text = stdout.trim()
  if (text) {
    try {
      const parsed = JSON.parse(text) as EngineResult
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      /* fall through */
    }
  }
  const detail = (stderr || text || 'mirobody bridge produced no JSON').slice(0, 500)
  return {
    ok: false,
    success: false,
    error_kind: status === null ? 'unavailable' : 'internal',
    error: detail,
    hint: 'The Python bridge did not return JSON. Check pythonBin and that `pip install mirobody` used Python 3.12+.',
  }
}

export function runBridgeSync(
  python: string,
  home: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): EngineResult {
  const script = bridgePath()
  if (!existsSync(script)) {
    return {
      ok: false,
      success: false,
      error_kind: 'internal',
      error: `bridge missing at ${script}`,
    }
  }
  const result = spawnSync(python, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: timeoutMs,
    env: bridgeEnv(home),
  })
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return {
      ok: false,
      success: false,
      error_kind: 'unavailable',
      error: 'mirobody bridge timed out',
      hint: 'The LOINC bundle can be slow on first load. Raise timeoutMs.',
    }
  }
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    return {
      ok: false,
      success: false,
      error_kind: 'unavailable',
      error: `python not found: ${python}`,
      hint: 'Set pythonBin to a Python 3.12+ interpreter that can import mirobody.',
    }
  }
  return parseBridge(result.stdout ?? '', result.stderr ?? '', result.status)
}

export function runBridge(
  python: string,
  home: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<EngineResult> {
  return new Promise((resolve) => {
    const script = bridgePath()
    if (!existsSync(script)) {
      resolve({ ok: false, success: false, error_kind: 'internal', error: `bridge missing at ${script}` })
      return
    }
    const child = spawn(python, [script], {
      env: bridgeEnv(home),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false
    const finish = (value: EngineResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({
        ok: false,
        success: false,
        error_kind: 'unavailable',
        error: 'mirobody bridge timed out',
        hint: 'The LOINC bundle can be slow on first load. Raise timeoutMs.',
      })
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        ok: false,
        success: false,
        error_kind: 'unavailable',
        error: error.code === 'ENOENT' ? `python not found: ${python}` : error.message,
        hint: 'Set pythonBin to a Python 3.12+ interpreter that can import mirobody.',
      })
    })
    child.on('close', (status) => {
      finish(parseBridge(Buffer.concat(stdout).toString('utf8'), Buffer.concat(stderr).toString('utf8'), status))
    })
    child.stdin.end(JSON.stringify(payload))
  })
}
