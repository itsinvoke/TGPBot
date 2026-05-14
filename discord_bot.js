'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  DISCORD BOT — Overseer protection relay
//  • Receives guard_bot.js alerts → posts embeds to alert channel
//  • Admin commands in Discord → forwarded to guard_bot.js via HTTP
//  Requires: discord.js@14  (npm install discord.js)
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config()
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js')
const http  = require('http')
const https = require('https')

// ── Env vars ─────────────────────────────────────────────────────────────────
const DISCORD_TOKEN      = process.env.DISCORD_TOKEN       || ''
const ALERT_CHANNEL_ID   = process.env.ALERT_CHANNEL_ID    || ''
const ADMIN_CHANNEL_ID   = process.env.ADMIN_CHANNEL_ID    || ''    // optional: separate admin channel
const ALERT_ROLE_ID      = process.env.GUARD_ALERT_ROLE_ID || ''
const GUARD_HTTP_PORT    = parseInt(process.env.GUARD_HTTP_PORT) || 3001
const DISCORD_HTTP_PORT  = parseInt(process.env.DISCORD_HTTP_PORT) || 3002
const COMMAND_PREFIX     = '!'

if (!DISCORD_TOKEN) { console.error('[FATAL] DISCORD_TOKEN not set') ; process.exit(1) }
if (!ALERT_CHANNEL_ID) { console.warn('[WARN] ALERT_CHANNEL_ID not set — alerts will be logged only') }

// ── Discord client ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
})

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function nowStamp () {
  const d = new Date()
  return `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}

// Post alert embed to the alert channel — matching the screenshot exactly
async function postAlertEmbed (type, data) {
  if (!ALERT_CHANNEL_ID) { console.log('[ALERT]', JSON.stringify(data)) ; return }
  const channel = await client.channels.fetch(ALERT_CHANNEL_ID).catch(() => null)
  if (!channel) { console.warn('[WARN] Alert channel not found') ; return }

  const embed = new EmbedBuilder()
    .setTitle('🚨 Alert')
    .setColor(0xFF0000)
    .setFooter({ text: nowStamp() })

  if (type === 'block') {
    embed.setDescription(`**${data.block} placed**`)
    embed.addFields(
      { name: 'Block',   value: `\`${data.block}\``,   inline: true },
      { name: 'Suspect', value: `${data.suspect}`,      inline: true },
    )
  } else if (type === 'intruder') {
    embed.setDescription('**Player in range**')
    embed.addFields(
      { name: 'Suspect',  value: `${data.username}`,              inline: true },
      { name: 'Distance', value: `\`${data.distance} blocks\``,   inline: true },
    )
  } else if (type === 'custom') {
    embed.setDescription(`**${data.description || 'Alert'}**`)
    if (data.fields) {
      for (const f of data.fields) embed.addFields({ name: f.name, value: `${f.value}`, inline: f.inline !== false })
    }
  }

  const roleMention = ALERT_ROLE_ID ? `<@&${ALERT_ROLE_ID}>` : ''
  await channel.send({ content: roleMention || undefined, embeds: [embed] }).catch(e => console.error('[DISCORD] Send error:', e.message))
}

// ─────────────────────────────────────────────────────────────────────────────
//  Send command to guard_bot.js HTTP bridge
// ─────────────────────────────────────────────────────────────────────────────

function sendToGuardBot (command, args = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ command, args })
    const req  = http.request({
      hostname: '127.0.0.1',
      port    : GUARD_HTTP_PORT,
      path    : '/command',
      method  : 'POST',
      headers : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = ''
      res.on('data', d => { data += d })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch { resolve({ raw: data }) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Discord event: ready
// ─────────────────────────────────────────────────────────────────────────────

client.once('ready', () => {
  console.log(`[DISCORD] Logged in as ${client.user.tag}`)
  console.log(`[DISCORD] Alert channel: ${ALERT_CHANNEL_ID || 'NOT SET'}`)
  console.log(`[DISCORD] Listening for ${COMMAND_PREFIX} commands`)
})

// ─────────────────────────────────────────────────────────────────────────────
//  Discord event: messageCreate — admin commands
// ─────────────────────────────────────────────────────────────────────────────

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return
  if (!msg.content.startsWith(COMMAND_PREFIX)) return

  // Optionally restrict to admin channel
  if (ADMIN_CHANNEL_ID && msg.channelId !== ADMIN_CHANNEL_ID && msg.channelId !== ALERT_CHANNEL_ID) return

  const body  = msg.content.slice(COMMAND_PREFIX.length).trim()
  const parts = body.split(/\s+/)
  const cmd   = parts[0].toLowerCase()
  const args  = parts.slice(1)

  console.log(`[DISCORD CMD] ${msg.author.username}: ${body}`)

  switch (cmd) {

    // !quit — shuts down the MC guard bot
    case 'quit': {
      await msg.reply('⚠️ Sending shutdown to guard bot...')
      try {
        await sendToGuardBot('quit')
        await msg.reply('✅ Shutdown command sent.')
      } catch (e) {
        await msg.reply(`❌ Could not reach guard bot: ${e.message}`)
      }
      break
    }

    // !run <mc command>  — runs any MC command on the guard bot
    case 'run': {
      const mcCmd = args.join(' ')
      if (!mcCmd) { await msg.reply('Usage: `!run <minecraft command>`') ; break }
      try {
        await sendToGuardBot(`run ${mcCmd}`)
        await msg.reply(`✅ Sent to MC: \`${mcCmd}\``)
      } catch (e) {
        await msg.reply(`❌ Could not reach guard bot: ${e.message}`)
      }
      break
    }

    // !ad stop | !ad start
    case 'ad': {
      const sub = args[0]?.toLowerCase()
      if (sub !== 'stop' && sub !== 'start') { await msg.reply('Usage: `!ad stop` or `!ad start`') ; break }
      try {
        await sendToGuardBot(`ad ${sub}`)
        await msg.reply(`✅ Clan ad **${sub === 'stop' ? 'stopped' : 'started'}**.`)
      } catch (e) {
        await msg.reply(`❌ Could not reach guard bot: ${e.message}`)
      }
      break
    }

    // !antiafk on | !antiafk off
    case 'antiafk': {
      const sub = args[0]?.toLowerCase()
      if (sub !== 'on' && sub !== 'off') { await msg.reply('Usage: `!antiafk on` or `!antiafk off`') ; break }
      try {
        await sendToGuardBot(`antiafk ${sub}`)
        await msg.reply(`✅ Anti-AFK **${sub === 'on' ? 'enabled' : 'disabled'}**.`)
      } catch (e) {
        await msg.reply(`❌ Could not reach guard bot: ${e.message}`)
      }
      break
    }

    // !home [name] — makes the guard bot teleport home
    case 'home': {
      const home = args[0] || 'Home1'
      try {
        await sendToGuardBot(`run /home ${home}`)
        await msg.reply(`✅ Going to home: **${home}**`)
      } catch (e) {
        await msg.reply(`❌ Could not reach guard bot: ${e.message}`)
      }
      break
    }

    // !status — ask guard bot for current status
    case 'status': {
      try {
        const res = await sendToGuardBot('status')
        await msg.reply(`📊 Status: \`${JSON.stringify(res)}\``)
      } catch (e) {
        await msg.reply(`❌ Could not reach guard bot: ${e.message}`)
      }
      break
    }

    // !help
    case 'help': {
      await msg.reply([
        '**Guard Bot Commands:**',
        '`!quit` — shut down the MC bot',
        '`!run <command>` — run any MC command (e.g. `!run /sethome Home1`)',
        '`!ad stop` / `!ad start` — toggle clan ad spam',
        '`!antiafk on` / `!antiafk off` — toggle anti-AFK',
        '`!home [name]` — teleport guard bot to a home (default: Home1)',
        '`!status` — show guard bot status',
      ].join('\n'))
      break
    }

    default:
      await msg.reply(`Unknown command. Type \`${COMMAND_PREFIX}help\` for the list.`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
//  HTTP server — receives alert POSTs from guard_bot.js
//  (guard_bot.js can also POST directly to the Discord webhook instead;
//   this server is an alternative bridge for richer control)
// ─────────────────────────────────────────────────────────────────────────────

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/alert') {
    res.writeHead(404).end() ; return
  }
  let body = ''
  req.on('data', d => { body += d })
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body)
      console.log('[ALERT RECEIVED]', JSON.stringify(payload))
      await postAlertEmbed(payload.type || 'custom', payload)
      res.writeHead(200).end(JSON.stringify({ ok: true }))
    } catch (e) {
      console.error('[ALERT] Parse error:', e.message)
      res.writeHead(400).end(JSON.stringify({ error: e.message }))
    }
  })
}).listen(DISCORD_HTTP_PORT, () => {
  console.log(`[DISCORD BOT] Alert HTTP server on port ${DISCORD_HTTP_PORT}`)
})

// ─────────────────────────────────────────────────────────────────────────────
//  Login
// ─────────────────────────────────────────────────────────────────────────────

client.login(DISCORD_TOKEN).catch(e => {
  console.error('[FATAL] Discord login failed:', e.message)
  process.exit(1)
})
