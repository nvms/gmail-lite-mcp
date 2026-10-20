// Signing in. Two things are kept in the config folder: the Google app
// (client.json, the OAuth client downloaded from Google Cloud Console), and
// one sign-in per named account (accounts/<name>.json). Every account uses
// the same app. The permissions asked for are only what the tools need, so
// Google itself refuses anything more.

import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const NAME = 'gmail-lite-mcp'
export const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
const RUN = `npx -y github:nvms/${NAME}`

const configDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), NAME)
const clientFile = () => join(configDir(), 'client.json')
const accountFile = (name) => join(configDir(), 'accounts', `${name}.json`)

// `auth [client.json] --account <name>`, or just `--account <name>`
export function command(argv) {
  const args = [...argv]
  let account = null
  const at = args.indexOf('--account')
  if (at >= 0) [, account] = args.splice(at, 2)
  const auth = args[0] === 'auth'
  return { auth, account, client: auth ? args[1] ?? null : null }
}

export async function accounts() {
  return (await readdir(join(configDir(), 'accounts')).catch(() => []))
    .filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort()
}

function checkName(account) {
  if (!account) throw new Error('--account <name> is required, like --account work')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(account)) throw new Error('an account name is lowercase letters, digits and dashes, like work or personal')
}

// the account a server runs as, which must have signed in
export async function useAccount(account) {
  const known = await accounts()
  if (!account) throw new Error(`choose an account with --account: ${known.join(', ') || `none signed in yet; run ${RUN} auth --account <name>`}`)
  if (!known.includes(account)) throw new Error(`no account ${account}${known.length ? `; signed in: ${known.join(', ')}` : ''}. Sign it in with ${RUN} auth --account ${account}`)
  current = account
}
let current = null

async function readClient() {
  let raw
  try {
    raw = JSON.parse(await readFile(clientFile(), 'utf8'))
  } catch {
    throw new Error(`no Google app yet: run ${RUN} auth <the client JSON you downloaded> --account <name>`)
  }
  const client = raw.installed ?? raw
  if (!client.client_id || !client.client_secret) throw new Error(`${clientFile()} is not a Desktop app client`)
  return { id: client.client_id, secret: client.client_secret }
}

// the app file as downloaded; only a Desktop app client can sign in this way
async function storeClient(path) {
  const raw = JSON.parse(await readFile(resolve(path), 'utf8').catch(() => { throw new Error(`cannot read ${path}`) }))
  if (!raw.installed) throw new Error(`${path} is not a Desktop app client; in Google Cloud Console, create a client of type Desktop app and download that`)
  await mkdir(configDir(), { recursive: true, mode: 0o700 })
  await copyFile(resolve(path), clientFile())
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  spawn(command, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

// one approval in the browser, answered on a port of this machine's own
export async function signIn({ account, client: path }) {
  checkName(account)
  if (path) await storeClient(path)
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
        prompt: 'consent select_account',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })
      console.error(`Signing in account "${account}". Choose its Google account in the browser. If no browser opens, visit:\n${url}`)
      openBrowser(String(url))
    })
  })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect }),
  })
  const body = await response.json()
  if (!response.ok || !body.refresh_token) throw new Error(`Google refused the sign-in: ${body.error_description || body.error || response.status}`)
  const granted = String(body.scope ?? '').split(' ')
  const missing = SCOPES.filter((scope) => !granted.includes(scope))
  if (missing.length) throw new Error(`not every permission was approved; sign in again and tick every box (missing ${missing.join(', ')})`)
  await mkdir(join(configDir(), 'accounts'), { recursive: true, mode: 0o700 })
  await writeFile(accountFile(account), JSON.stringify({ refresh_token: body.refresh_token, scope: body.scope }, null, 2), { mode: 0o600 })
  console.error(`Signed in account "${account}". Use it with: ${RUN} --account ${account}`)
}

// an access token, fetched again shortly before the last one runs out
let cached = null
export async function accessToken() {
  if (cached && cached.expires > Date.now() + 60000) return cached.token
  const client = await readClient()
  const { refresh_token } = JSON.parse(await readFile(accountFile(current), 'utf8'))
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token, grant_type: 'refresh_token' }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`Google refused account "${current}" (${body.error_description || body.error}); sign it in again with ${RUN} auth --account ${current}`)
  cached = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 }
  return cached.token
}
