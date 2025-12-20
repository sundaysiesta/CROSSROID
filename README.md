# CROSSROID Discord Bot

A multi-functional Discord bot designed for community engagement, featuring anonymous messaging with unique social dynamics, AI-powered time signals, and automated moderation tools.

## 🚀 Key Features

### 🎭 Anonymous System (The "Wacchoi" Style)
- **Traceable Anonymity**: Users can post anonymously via `/anonymous`.
- **Wacchoi ID**: Displays a weekly unique ID (reset Thursdays) and daily ID.
- **Devaluation Mechanics**:
    - **Inflation Tax**: Cooldown increases with daily usage (20s -> 30m).
    - **Ugly Name**: Users are forced to wear embarrassing names (e.g., "弱そうなスライム") based on their daily hash.

### 🤖 Admin Proxy
- **`/admin_say`**: Authorized admins can speak through the bot to any channel.
- **`/event_create`**: Streamlined event channel creation and announcement.

### 🛡️ Automated Moderation
- **Auto Proxy**: Automatically re-posts images/videos as webhooks to bypass non-nitro limits (with cooldowns).
- **Word Filter**: Auto-proxies messages containing banned words to mask the original author.
- **Legacy Migration**: Auto-deletes messages from the old bot instance.

### ⏰ Life Utilities
- **AI Time Signal**: Reports time at 3-hour intervals with AI-generated commentary (Groq).
- **Guide Board**: Auto-updating server stats.

---

## 🛠️ Setup & Deployment

### 1. Environment Variables (`.env`)
Required variables for the bot to function:

```env
DISCORD_TOKEN=your_discord_bot_token
GROQ_API_KEY=your_groq_api_key
SECRET_SALT=your_long_random_string_for_hashing
PORT=3000
```
> [!IMPORTANT]
> `SECRET_SALT` is critical for the security of anonymous IDs. Do not lose it or change it lightly.

### 2. Configuration
Core settings are located in `constants.js`.
- **Channel IDs**: `MAIN_CHANNEL_ID`, `EVENT_NOTIFY_CHANNEL_ID`, etc.
- **Role IDs**: `EVENT_ADMIN_ROLE_ID`, `ALLOWED_ROLE_IDS`.
- **Cooldowns**: Tweaking `ANONYMOUS_COOLDOWN_TIERS`.

### 3. Running Locally
```bash
npm install
npm start
```

---

## � Command List

### Public Commands
| Command | Description |
| :--- | :--- |
| `/anonymous [content]` | Send anonymous message (subject to cooldowns). |
| `/bump` | Promote the club channel (2h cooldown). |
| `/random_mention` | Mention a random active member. |

### Admin / Restricted Commands
| Command | Description | Permission |
| :--- | :--- | :--- |
| `/admin_say [channel] [content]` | Send message as Bot. | Dev ID Only |
| `/event_create [name] ...` | Create event channel & notify. | Admin/Event Role |
| `/anonymous_resolve [id]` | Identify anonymous user. | Admin Only |
| `/test_timereport` | Test AI time signal. | Admin Only |

## � Project Structure
- **`index.js`**: Entry point & DI container.
- **`constants.js`**: Centralized configuration.
- **`utils.js`**: Shared helpers (Hashing, Date, etc).
- **`commands/`**: Slash command handlers.
- **`features/`**: Event-driven features (Proxy, Highlight, TimeSignal).

## 📄 License
MIT License
