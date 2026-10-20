// Signing in: the person's own Google OAuth client, kept in the config
// folder, and the refresh token their one approval in the browser yields.
// The permissions asked for are only what the tools need, so Google itself
// refuses anything more.

import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

export const configDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'gmail-lite-mcp')
const clientFile = () => join(configDir(), 'client.json')
const tokenFile = () => join(configDir(), 'token.json')

// the OAuth client JSON as Google Cloud Console downloads it
export async function readClient() {
  let raw
  try {
    raw = JSON.parse(await readFile(clientFile(), 'utf8'))
  } catch {
    throw new Error(`no OAuth client at ${clientFile()}: download your Desktop app client's JSON from Google Cloud Console and save it there`)
  }
  const client = raw.installed ?? raw.web ?? raw
  if (!client.client_id || !client.client_secret) throw new Error(`${clientFile()} has no client_id and client_secret`)
  return { id: client.client_id, secret: client.client_secret }
}

export async function readToken() {
  try {
    return JSON.parse(await readFile(tokenFile(), 'utf8'))
  } catch {
    throw new Error('not signed in: run `npx gmail-lite-mcp auth` once')
  }
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  spawn(command, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

// one approval in the browser, answered on a port of this machine's own
export async function signIn() {
  const client = await readClient()
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('hex')

  const { code, redirect } = await new Promise((resolve, reject) => {
    let redirect = null
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname !== '/') { res.writeHead(404).end(); return }
      const error = url.searchParams.get('error')
      const ok = !error && url.searchParams.get('state') === state && url.searchParams.get('code')
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain' })
      res.end(ok ? 'Signed in. You can close this tab.' : `Sign-in failed: ${error || 'unexpected answer'}`)
      server.close()
      if (ok) resolve({ code: url.searchParams.get('code'), redirect })
      else reject(new Error(`sign-in failed: ${error || 'unexpected answer'}`))
    })
    server.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${server.address().port}`
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.search = new URLSearchParams({
        client_id: client.id,
        redirect_uri: redirect,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })
      console.error(`Opening your browser to sign in. If it does not open, visit:\n${url}`)
      openBrowser(String(url))
    })
  })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: client.id,
      client_secret: client.secret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirect,
    }),
  })
  const body = await response.json()
  if (!response.ok || !body.refresh_token) throw new Error(`Google refused the sign-in: ${body.error_description || body.error || response.status}`)
  await mkdir(configDir(), { recursive: true, mode: 0o700 })
  await writeFile(tokenFile(), JSON.stringify({ refresh_token: body.refresh_token, scope: body.scope }, null, 2), { mode: 0o600 })
  console.error(`Signed in. Saved to ${tokenFile()}`)
}

// an access token, fetched again shortly before the last one runs out
let cached = null
export async function accessToken() {
  if (cached && cached.expires > Date.now() + 60000) return cached.token
  const client = await readClient()
  const { refresh_token } = await readToken()
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token, grant_type: 'refresh_token' }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`Google refused the stored sign-in (${body.error_description || body.error}); run \`npx gmail-lite-mcp auth\` again`)
  cached = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 }
  return cached.token
}
