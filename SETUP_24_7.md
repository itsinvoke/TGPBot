# TGPBot 24/7 Setup Guide

This guide explains how to set up your Minecraft and Discord bots to run 24/7 on GitHub Actions with automatic restart on server crashes.

## Quick Start

### 1. Add GitHub Secrets

Go to **Settings → Secrets and Variables → Actions** and add these secrets:

#### Minecraft Bot Configuration
- **MC_HOST**: `alt.6b6t.org` (or your server)
- **MC_PORT**: `25565`
- **MC_USERNAME**: Your bot's username
- **MC_VERSION**: `1.20.1` (or your server version)
- **MC_TIMEOUT**: `120000`
- **BOT_PASSWORD**: Your bot's password (for `/login`)
- **WHITELIST**: Comma-separated player names (e.g., `Player1,Player2,Player3`)

#### Guard Bot (Minecraft Protection)
- **GUARD_WEBHOOK_URL**: Your Discord webhook URL for alerts
- **GUARD_ALERT_ROLE_ID**: Discord role ID to ping on alerts (optional)
- **GUARD_HTTP_PORT**: `3001`
- **CLAN_AD**: Your clan advertisement message

#### Discord Bot
- **DISCORD_TOKEN**: Your Discord bot token
- **ALERT_CHANNEL_ID**: Channel ID where alerts are posted
- **ADMIN_CHANNEL_ID**: Channel ID for admin commands (optional)
- **DISCORD_HTTP_PORT**: `3002`

### 2. Enable GitHub Actions

1. Go to **Actions** tab in your repository
2. Click **"I understand my workflows, go ahead and enable them"**

### 3. Trigger the Workflow

- Push to `main` branch, OR
- Go to **Actions → 24/7 TGPBot & Discord Bot → Run workflow**

## Features

✅ **24/7 Automatic Operation** - Bots run continuously on GitHub's servers  
✅ **Auto-Restart on Crash** - If either bot crashes, it automatically restarts  
✅ **Server Restart Detection** - Detects 6b6t server restarts and rejoins automatically  
✅ **Whitelist-Only TP Acceptance** - Only whitelisted players' teleport requests are accepted  
✅ **Non-whitelisted TP Rejection** - Automatically denies TPs from non-whitelisted players  
✅ **Discord Integration** - Receive alerts for intruders, danger blocks placed, etc.  
✅ **Admin Commands** - Control bots remotely via Discord or in-game whispers  

## How It Works

### GitHub Actions Workflow
- **Location**: `.github/workflows/24-7-bot.yml`
- **Triggers**: 
  - On push to `main`
  - Every hour (scheduled cron job to ensure continuity)
  - Manual trigger from Actions tab

### Process Management
The workflow runs both bots concurrently:
1. **Guard Bot** (`guard_bot.js`) - Minecraft bot for protection & alerts
2. **Discord Bot** (`discord_bot.js`) - Discord relay for commands & alerts

If either process crashes, it's automatically restarted within 30 seconds.

### Server Restart Handling (NEW)
When 6b6t restarts:
1. Bot detects restart message
2. Waits 15 seconds for server to come back online
3. Automatically rejoins with login credentials
4. Resumes protection duties

### Teleport Request Handling (ENHANCED)
- **Whitelisted players**: `✅ ACCEPTED` - TPA/teleport requests are automatically approved
- **Non-whitelisted players**: `❌ REJECTED` - TPA requests are automatically denied

## Discord Admin Commands

Use these commands in Discord to control the bots (in the configured admin/alert channel):

```
!help              - Show all available commands
!quit              - Shut down the MC bot
!run <command>     - Run any Minecraft command (e.g., !run /say hello)
!ad stop           - Stop clan advertisement spam
!ad start          - Start clan advertisement spam
!antiafk on        - Enable anti-AFK (continuous jump/sneak)
!antiafk off       - Disable anti-AFK
!home [name]       - Teleport bot to a home (default: Home1)
!status            - Show current bot status
```

## In-Game Admin Commands

Whisper the bot with `^` prefix (requires being in whitelist):

```
^quit              - Shut down the bot
^run <command>     - Run any Minecraft command
^ad stop           - Stop clan ad
^ad start          - Start clan ad
^antiafk on        - Enable anti-AFK
^antiafk off       - Disable anti-AFK
^home [name]       - Go to a home
^status            - Show status
```

## Alert Examples

### Player Intruder Alert
When a non-whitelisted player enters render distance:
```
🚨 Alert
Player in range
Suspect: PlayerName     Distance: 42 blocks
```

### Danger Block Placed
When TNT/respawn_anchor/end_crystal is placed:
```
🚨 Alert
TNT placed
Block: tnt          Suspect: SuspiciousPlayer
```

## Monitoring

Check the workflow status:
1. Go to **Actions** tab
2. Click **"24/7 TGPBot & Discord Bot"**
3. View the latest run logs

**Green checkmark** = Both bots running successfully  
**Red X** = Workflow failed (check logs for details)

## Troubleshooting

### Bot doesn't start
- Check all secrets are set correctly in Settings → Secrets
- Verify MC_HOST, MC_PORT, and credentials are correct
- Check Discord token is valid

### Bots stop after 6 hours
- GitHub Actions jobs have a 6-hour limit
- The workflow is scheduled to restart hourly via cron job
- If manually triggered, job will run for up to 7 days

### No Discord alerts
- Verify GUARD_WEBHOOK_URL is correct
- Test webhook manually: `curl -X POST -H 'Content-Type: application/json' -d '{"content":"Test"}' YOUR_WEBHOOK_URL`
- Ensure bot has permissions in the channel

### Teleport requests always accepted/rejected
- Check WHITELIST secret is comma-separated: `Player1,Player2,Player3`
- Spaces matter! Use `Player1, Player2` (with space) or `Player1,Player2` (no space), but be consistent

## Advanced Configuration

### Change Server Restart Rejoin Delay
Edit `guard_bot.js`, line ~44:
```javascript
const REJOIN_DELAY_MS = 15000  // 15 seconds
```

### Change Whitelist-Only TP to "Always Accept"
Edit `guard_bot.js`, search for `// ENHANCED: Only accept TPA from whitelisted`:
```javascript
// Remove the whitelist check to always accept
LOG.tpa(`Accepting TPA from ${tpaUser}`)
bot.chat(`/tpy ${tpaUser}`)
```

### Change Alert Cooldown
Edit `guard_bot.js`, line ~34:
```javascript
const ALERT_COOLDOWN_MS = 5 * 60 * 1000  // 5 minutes between alerts per player
```

## Support

If you need help:
1. Check workflow logs in **Actions** tab
2. Verify all environment variables/secrets are set
3. Test bot locally: `npm install && node guard_bot.js`

Happy protecting! 🛡️
