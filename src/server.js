#!/usr/bin/env node
// gmail-lite-mcp: read-only Gmail for agents. `npx gmail-lite-mcp auth`
// signs in once; run without arguments it is an MCP server on stdio.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { signIn } from './auth.js'
import { message, search, thread } from './gmail.js'

const VERSION = '0.1.0'

if (process.argv[2] === 'auth') {
  signIn().then(() => process.exit(0), (error) => { console.error(error.message); process.exit(1) })
} else {
  const server = new McpServer({ name: 'gmail-lite-mcp', version: VERSION })
  const answer = (fn) => async (args) => {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await fn(args), null, 2) }] }
    } catch (error) {
      return { content: [{ type: 'text', text: error.message }], isError: true }
    }
  }
  const readOnly = { readOnlyHint: true, openWorldHint: true }

  server.registerTool('search', {
    description: 'Searches Gmail with its own query syntax (from:, to:, subject:, after:2026/10/01, newer_than:1d, has:attachment, label:, is:unread, quoted phrases, OR, -word). Returns each message\'s id, thread id, date, from, to, subject, snippet, labels and a link; read one in full with get_message or get_thread.',
    inputSchema: {
      query: z.string().describe('a Gmail search, as typed in Gmail\'s search box'),
      max: z.number().int().min(1).max(100).optional().describe('how many messages, default 20'),
      page_token: z.string().optional().describe('next_page_token from the previous search, for the next page'),
    },
    annotations: readOnly,
  }, answer(({ query, max, page_token }) => search({ query, max, pageToken: page_token })))

  server.registerTool('get_message', {
    description: 'One message in full as plain text: its headers, body (HTML made plain) and the names of its attachments.',
    inputSchema: { id: z.string().describe('the message id from search') },
    annotations: readOnly,
  }, answer(message))

  server.registerTool('get_thread', {
    description: 'A whole conversation as plain text, oldest first, each reply without the quoted history beneath it.',
    inputSchema: { id: z.string().describe('the thread id from search') },
    annotations: readOnly,
  }, answer(thread))

  await server.connect(new StdioServerTransport())
}
