# gmail-lite-mcp

An MCP server that reads Gmail. It asks Google only for permission to read mail, so Google itself refuses any change to your mailbox.

- `search`: Gmail search, in the same syntax as Gmail's search box
- `get_message`: one email in full, as plain text
- `get_thread`: a whole conversation, as plain text
- `save_attachment`: one attachment saved to a file, its path returned for the agent to open; by default under `~/.cache/gmail-lite-mcp/<account>/<message id>/`

## Setup

There are three parts. Parts 1 and 2 are done once per computer; part 3 once per project.

- **The Google app** is your own OAuth client in Google Cloud. One app serves every Google account you sign in, and it can serve [gcal-lite-mcp](https://github.com/nvms/gcal-lite-mcp), [gdrive-lite-mcp](https://github.com/nvms/gdrive-lite-mcp) too.
- **An account** is one Google account signed in under a name you choose, like `work` or `personal`.
- **The config** of each project names which account that project uses. There is no default account.

### 1. The Google app

If you already made one for [gcal-lite-mcp](https://github.com/nvms/gcal-lite-mcp), [gdrive-lite-mcp](https://github.com/nvms/gdrive-lite-mcp), skip to step 1.4 and enable the Gmail API in that same project.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (project menu at the top, **New project**).
2. In the left menu, open **Google Auth Platform**, then **Get started**. Give the app a name and your email.
3. Choose its **audience**:
   - **Internal** if every account you will sign in belongs to the same Google Workspace organization as the project. Simplest: no review, no expiry.
   - **External** otherwise, for example a personal Gmail, or work and personal together. Then, under **Branding**, fill in the app name, support email, a homepage URL and a privacy policy URL (any URL of yours will do; Google only checks them if you ask it to verify the app). Then, under **Audience**, click **Publish app** so it is **In production**. An app left in **Testing** signs you out every 7 days.
4. In the left menu, open **APIs & Services → Library**, search for **Gmail API**, and click **Enable**.
5. Under **Google Auth Platform → Clients**, click **Create client**, choose **Desktop app**, and click **Create**. Download its JSON file.

### 2. Sign in an account

The first time, give the JSON file you downloaded, and a name for the account:

```sh
npx -y github:nvms/gmail-lite-mcp auth ~/Downloads/client_secret_XXXX.json --account work
```

A browser opens. Choose the Google account to sign in as, and approve. The app is now stored, so every later account needs only its name:

```sh
npx -y github:nvms/gmail-lite-mcp auth --account personal
```

Signing in an account again (say, after changing its password) is the same command.

### 3. Add it to a project

In the project's MCP configuration, name the account it uses:

```json
{ "mcpServers": { "gmail": { "command": "npx", "args": ["-y", "github:nvms/gmail-lite-mcp", "--account", "work"] } } }
```

For two accounts in one project, add two entries, each with its own name and account.

## Where things are kept

In `~/.config/gmail-lite-mcp/`: `client.json` is the Google app, and `accounts/<name>.json` is each signed-in account. Delete an account's file to sign it out.

## When something goes wrong

- **"choose an account with --account"**: the config has no `--account`; see part 3.
- **"no account NAME"**: that account has not signed in on this computer; see part 2.
- **"Access blocked: … can only be used within its organization" (org_internal)**: the app's audience is Internal, but the account is outside its organization. Make it External and publish it (part 1.3).
- **"… API has not been used in project … or it is disabled"**: enable the Gmail API (part 1.4).
- **"Google refused account NAME"**: sign that account in again (part 2).
- **Signed out every 7 days**: the app is still in Testing; publish it (part 1.3).
