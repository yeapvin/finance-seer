/**
 * Portfolio Store — persistent storage via Upstash Redis REST API
 * Falls back to local JSON file for local dev
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const PORTFOLIO_PATH = join(process.cwd(), 'data', 'portfolio.json')
const KV_KEY = 'portfolio'

function isVercel() {
  return !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
}

async function kvGet(key: string): Promise<any> {
  const url = `${process.env.KV_REST_API_URL}/get/${key}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    cache: 'no-store',
  })
  const data = await res.json()
  if (data.result === null || data.result === undefined) return null
  const result = data.result
  // Result may be the object directly, or a JSON string (legacy)
  if (typeof result === 'object') return result
  // String: may be single or double-encoded
  try {
    const parsed = JSON.parse(result)
    if (typeof parsed === 'object') return parsed
    // Double-encoded string
    return JSON.parse(parsed)
  } catch {
    return null
  }
}

async function kvSet(key: string, value: any): Promise<void> {
  const url = `${process.env.KV_REST_API_URL}/set/${key}`
  // Store as JSON object directly (not string-encoded)
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  })
}

export async function readPortfolio(): Promise<any> {
  if (isVercel()) {
    try {
      const data = await kvGet(KV_KEY)
      if (data) return data
    } catch (e) {
      console.error('KV read failed, falling back to file:', e)
    }
  }
  return JSON.parse(readFileSync(PORTFOLIO_PATH, 'utf-8'))
}

export async function writePortfolio(data: any): Promise<void> {
  if (isVercel()) {
    try {
      await kvSet(KV_KEY, data)
      return
    } catch (e) {
      console.error('KV write failed, falling back to file:', e)
    }
  }
  writeFileSync(PORTFOLIO_PATH, JSON.stringify(data, null, 2))
}
