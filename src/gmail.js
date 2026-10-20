// Gmail's REST API, and its messages as plain text: the headers that
// matter, the body without HTML, and replies without the quoted history
// beneath them.

import { accessToken } from './auth.js'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

async function get(path, params = {}) {
  const url = new URL(`${API}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue
    for (const one of [].concat(value)) url.searchParams.append(key, String(one))
  }
  const response = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } })
  const body = await response.json()
  if (!response.ok) throw new Error(`Gmail: ${body.error?.message || response.status}`)
  return body
}

// a few at a time, in order
async function each(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

export const link = (id) => `https://mail.google.com/mail/u/0/#all/${id}`

const header = (message, name) => message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null

function summary(message) {
  return {
    id: message.id,
    thread_id: message.threadId,
    date: header(message, 'Date'),
    from: header(message, 'From'),
    to: header(message, 'To'),
    subject: header(message, 'Subject'),
    snippet: decodeEntities(message.snippet ?? ''),
    labels: message.labelIds ?? [],
    link: link(message.id),
  }
}

export async function search({ query, max = 20, pageToken }) {
  const list = await get('/messages', { q: query, maxResults: Math.min(Math.max(1, max), 100), pageToken })
  const messages = await each(list.messages ?? [], 10, ({ id }) =>
    get(`/messages/${id}`, { format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] }).then(summary))
  return { messages, next_page_token: list.nextPageToken ?? null, estimated_total: list.resultSizeEstimate ?? null }
}

function full(message, { quotes }) {
  const text = body(message.payload)
  return {
    ...summary(message),
    cc: header(message, 'Cc'),
    text: quotes ? text : withoutQuotes(text),
    attachments: attachments(message.payload),
  }
}

export async function message({ id }) {
  return full(await get(`/messages/${id}`, { format: 'full' }), { quotes: true })
}

export async function thread({ id }) {
  const value = await get(`/threads/${id}`, { format: 'full' })
  return { id: value.id, link: link(value.id), messages: (value.messages ?? []).map((m) => full(m, { quotes: false })) }
}

// ---- the text of a message ----

const decode = (data) => Buffer.from(data, 'base64url').toString('utf8')

function parts(part) {
  return [part, ...(part?.parts ?? []).flatMap(parts)]
}

// its plain text part, or its HTML made plain
function body(payload) {
  const all = parts(payload).filter((p) => p?.body?.data && !p.filename)
  const plain = all.find((p) => p.mimeType === 'text/plain')
  if (plain) return decode(plain.body.data).replace(/\r\n/g, '\n').trim()
  const html = all.find((p) => p.mimeType === 'text/html')
  return html ? htmlText(decode(html.body.data)) : ''
}

function attachments(payload) {
  return parts(payload).filter((p) => p?.filename).map((p) => ({ name: p.filename, type: p.mimeType, size: p.body?.size ?? null }))
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
}

export function htmlText(html) {
  const text = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// a reply's own words: what comes before the quoted message it answers
export function withoutQuotes(text) {
  const lines = text.split('\n')
  const cut = lines.findIndex((line, i) =>
    /^On .+wrote:\s*$/.test(line)
    || (/^On .+/.test(line) && /wrote:\s*$/.test(lines[i + 1] ?? ''))
    || /^-{2,}\s*Original Message\s*-{2,}/i.test(line)
    || (/^From: /.test(line) && /^(Sent|Date): /.test(lines[i + 1] ?? '')))
  const own = cut >= 0 ? lines.slice(0, cut) : lines
  return own.filter((line) => !line.startsWith('>')).join('\n').trim()
}
