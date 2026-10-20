# gmail-lite-mcp

A small MCP server that reads Gmail: `search`, `get_message`, `get_thread`. It asks Google only for read-only access, so Google itself refuses any change to your mail.

## Setup, once

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Gmail API**.
2. Under **Google Auth Platform**, set up the app:
   - a Workspace account: audience **Internal**;
   - a personal account: audience **External**, then **Publish app** (left in Testing, the sign-in expires every 7 days).
3. Under **Clients**, create a client of type **Desktop app** and download its JSON to `~/.config/gmail-lite-mcp/client.json`.
4. Sign in:

   ```sh
   npx -y github:nvms/gmail-lite-mcp auth
   ```

## Use

```json
{ "mcpServers": { "gmail": { "command": "npx", "args": ["-y", "github:nvms/gmail-lite-mcp"] } } }
```
