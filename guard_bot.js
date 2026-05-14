'use strict'

// ────────────────────────────────────────────────────────────────��[...]
//  GUARD BOT — cage sentinel, clan ad, whitelist watcher, Discord alerts
//  ENHANCED: Auto-rejoin on server restart + Whitelist-only TP acceptance
// ────────────────────────────────────────────────────────────────��[...]

require('dotenv').config()
const mineflayer  = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const Vec3        = require('vec3')
const fs          = require('fs')
const https       = require('https')
const http        = require('http')
const { formatChatMessage, stripAnsi } = require('./chatColor.js')

// ── Environment variables ─────────────────────────────────────────────────
const GUARD_WEBHOOK_URL  = process.env.GUARD_WEBHOOK_URL   || ''
const GUARD_ALERT_ROLE   = process.env.GUARD_ALERT_ROLE_ID || ''
const GUARD_HTTP_PORT    = parseInt(process.env.GUARD_HTTP_PORT) || 3001
const CLAN_AD_MSG        = process.env.CLAN_AD || 'Join our clan! discord.gg/yourserver'

// ── Guard constants ───────────────────────────────────────────────────────
const ADMIN_PREFIX       = '^'
const WHITELIST = (process.env.WHITELIST || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const AD_INTERVAL_TICKS  = 7500
const DEFAULT_HOME       = 'Home1'
const RENDER_DIST_SQ     = 64 * 64
const ALERT_COOLDOWN_MS  = 5 * 60 * 1000
const DANGER_BLOCKS      = new Set(['tnt', 'respawn_anchor', 'end_crystal'])

// ── ENHANCED: Server restart detection & rejoin ────────────────────────────
const REJOIN_DELAY_MS    = 15000  // Wait 15 seconds for server to come back online
const SERVER_RESTART_KEYWORDS = [
  'Server restarts in',
  'The target server is offline',
  'You have been sent to the backup server',
  'You were kicked from main-server: Server closed',
  'The main server is restarting',
  'We will be back soon'
]

// ── Runtime state ─────────────────────────────────────────────────────────
let adEnabled        = true
let antiAfkEnabled   = false
let antiAfkHandle    = null
let tickCounter      = 0
let playerAlertMap   = new Map()
let serverRestartDetected = false
let rejoinAttempts   = 0

// ── Reconnect state ───────────────────────────────────────────────────────
const BASE_RECONNECT_MS             = 10000
const MAX_RECONNECT_MS              = 180000
let reconnectTimer                  = null
let reconnectAttempts               = 5
let blockReconnectForVerification   = false
let isRestarting                    = false
let activeBot                       = null

let hasDoneInitialLobbyLogin = false
let isFullyInServer          = false

// ── Logger ───────────────────────────────────────────────────────────��[...]
const LOG = {
  info   : (...a) => console.log(`[INFO]   ${a.join(' ')}`),
  warn   : (...a) => console.warn(`[WARN]   ${a.join(' ')}`),
  error  : (...a) => console.error(`[ERROR]  ${a.join(' ')}`),
  success: (...a) => console.log(`[OK]     ${a.join(' ')}`),
  guard  : (...a) => console.log(`[GUARD]  ${a.join(' ')}`),
  tpa    : (...a) => console.log(`[TPA]    ${a.join(' ')}`),
  afk    : (...a) => console.log(`[AFK]    ${a.join(' ')}`),
  ad     : (...a) => console.log(`[AD]     ${a.join(' ')}`),
  restart: (...a) => console.log(`[RESTART] ${a.join(' ')}`),
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ────────────────────────────────────────────────────────────────�[...]
//  Discord webhook helpers
// ────────────────────────────────────────────────────────────────�[...]

function webhookPost (payload) {
  if (!GUARD_WEBHOOK_URL) { LOG.warn('GUARD_WEBHOOK_URL not set — alert dropped') ; return Promise.resolve() }
  return new Promise(resolve => {
    const body = JSON.stringify(payload)
    let url
    try { url = new URL(GUARD_WEBHOOK_URL) } catch { LOG.error('Invalid webhook URL') ; return resolve() }
    const req = https.request({
      hostname: url.hostname,
      path    : url.pathname + url.search,
      method  : 'POST',
      headers : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.resume() ; res.on('end', resolve) })
    req.on('error', e => { LOG.error('Webhook error:', e.message) ; resolve() })
    req.write(body)
    req.end()
  })
}

function nowStamp () {
  const d = new Date()
  return `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padSta[...]`
}

function buildEmbed (description, fields) {
  return {
    content : GUARD_ALERT_ROLE ? `<@&${GUARD_ALERT_ROLE}>` : undefined,
    username: 'Overseer protection',
    embeds  : [{
      title      : '🚨 Alert',
      description: `**${description}**`,
      color      : 0xFF0000,
      fields     : fields.map(([name, value, inline = true]) => ({ name, value: `${value}`, inline })),
      footer     : { text: nowStamp() },
    }]
  }
}

async function alertBlockPlaced (blockName, suspect) {
  LOG.guard(`ALERT block: ${suspect} → ${blockName}`)
  await webhookPost(buildEmbed(`${blockName} placed`, [
    ['Block',   blockName, true],
    ['Suspect', suspect,   true],
  ]))
}

async function alertIntruder (username, distance) {
  const now  = Date.now()
  const last = playerAlertMap.get(username) || 0
  if (now - last < ALERT_COOLDOWN_MS) return
  playerAlertMap.set(username, now)
  LOG.guard(`ALERT intruder: ${username} (${Math.floor(distance)}m)`)
  await webhookPost(buildEmbed('Player in range', [
    ['Suspect',  username,                      true],
    ['Distance', `${Math.floor(distance)} blocks`, true],
  ]))
}

// ────────────────────────────────────────────────────────────────[...]
//  HTTP bridge — receives commands from discord_bot.js
// ────────────────────────────────────────────────────────────────[...]

function startHttpBridge () {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/command') {
      res.writeHead(404).end() ; return
    }
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      try {
        const { command = '', args = [] } = JSON.parse(body)
        handleAdminCommand(command, args, 'discord')
        res.writeHead(200).end(JSON.stringify({ ok: true }))
      } catch (e) {
        res.writeHead(400).end(JSON.stringify({ error: e.message }))
      }
    })
  })
  server.listen(GUARD_HTTP_PORT, () => LOG.info(`HTTP bridge listening on port ${GUARD_HTTP_PORT}`))
}

// ────────────────────────────────────────────────────────────────[...]
//  Whitelist helper
// ────────────────────────────────────────────────────────────────[...]

function isWhitelisted (user) {
  const clean = user.replace(/^_+/, '')
  return WHITELIST.some(w => w === user || w === clean || user === '_' + w)
}

// ────────────────────────────────────────────────────────────────[...]
//  Anti-AFK — constant jump + crouch cycles
// ────────────────────────────────────────────────────────────────[...]

function startAntiAfk (bot) {
  if (antiAfkEnabled || !bot) return
  antiAfkEnabled = true
  LOG.afk('Anti-AFK ON')
  let phase = 0
  antiAfkHandle = setInterval(async () => {
    if (!bot || !antiAfkEnabled) return
    try {
      phase = (phase + 1) % 4
      if (phase === 0) {
        bot.setControlState('jump',  true)
        await sleep(200)
        bot.setControlState('jump',  false)
      } else if (phase === 1) {
        bot.setControlState('sneak', true)
        await sleep(300)
        bot.setControlState('sneak', false)
      } else if (phase === 2) {
        bot.setControlState('jump',  true)
        await sleep(150)
        bot.setControlState('jump',  false)
      } else {
        bot.setControlState('sneak', true)
        await sleep(250)
        bot.setControlState('sneak', false)
      }
    } catch {}
  }, 2000)
}

function stopAntiAfk (bot) {
  antiAfkEnabled = false
  if (antiAfkHandle) { clearInterval(antiAfkHandle) ; antiAfkHandle = null }
  if (bot) { try { bot.setControlState('jump', false) ; bot.setControlState('sneak', false) } catch {} }
  LOG.afk('Anti-AFK OFF')
}

// ────────────────────────────────────────────────────────────────[...]
//  Admin command handler
// ────────────────────────────────────────────────────────────────[...]

function handleAdminCommand (raw, args, source) {
  const bot   = activeBot
  const cmd   = raw.toLowerCase().trim()
  const reply = msg => {
    LOG.info(`[CMD/${source}] ${msg}`)
    if (source !== 'discord' && bot) bot.chat(`/msg ${source} ${msg}`)
  }

  if (cmd === 'quit') {
    reply('Shutting down...')
    if (bot) { try { bot.quit('Admin quit command') } catch {} }
    setTimeout(() => process.exit(0), 1200)
    return
  }

  if (cmd.startsWith('run ') || cmd.startsWith('run\t')) {
    const mcCmd = raw.slice(4).trim()
    if (!mcCmd) { reply('Usage: ^run <command>') ; return }
    if (bot) { bot.chat(mcCmd) ; reply(`Executed: ${mcCmd}`) }
    return
  }

  if (cmd === 'ad stop')  { adEnabled = false ; reply('Clan ad stopped.')  ; return }
  if (cmd === 'ad start') { adEnabled = true  ; reply('Clan ad started.')  ; return }

  if (cmd === 'antiafk on'  || cmd === 'anti-afk on')  { startAntiAfk(bot) ; reply('Anti-AFK enabled.')  ; return }
  if (cmd === 'antiafk off' || cmd === 'anti-afk off') { stopAntiAfk(bot)  ; reply('Anti-AFK disabled.') ; return }

  if (cmd.startsWith('home ')) {
    const home = cmd.slice(5).trim() || DEFAULT_HOME
    if (bot) { bot.chat(`/home ${home}`) ; reply(`Going to ${home}...`) }
    return
  }

  if (cmd === 'status') {
    reply(`Ad:${adEnabled?'ON':'OFF'} | AntiAFK:${antiAfkEnabled?'ON':'OFF'} | Players:${playerAlertMap.size} alerted | Ticks:${tickCounter}`)
    return
  }

  reply(`Unknown command: ${raw}  |  Available: quit, run <cmd>, ad stop/start, antiafk on/off, home <name>, status`)
}

// ────────────────────────────────────────────────────────────────[...]
//  ENHANCED: Server Restart Detection
// ────────────────────────────────────────────────────────────────[...]

function isServerRestartMessage (plain) {
  return SERVER_RESTART_KEYWORDS.some(keyword => plain.includes(keyword))
}

function handleServerRestart () {
  if (serverRestartDetected) return
  LOG.restart('Server restart detected! Will rejoin after server comes back online...')
  serverRestartDetected = true
  rejoinAttempts = 0
}

async function attemptRejoinAfterRestart (bot) {
  if (!serverRestartDetected) return
  
  rejoinAttempts++
  LOG.restart(`Rejoin attempt #${rejoinAttempts} after waiting ${REJOIN_DELAY_MS}ms for server...`)
  
  try {
    // Try to connect after restart delay
    const newBot = createBot()
    registerBotEvents(newBot)
    LOG.restart('✅ Reconnected after server restart!')
    serverRestartDetected = false
    rejoinAttempts = 0
  } catch (err) {
    LOG.warn(`Rejoin attempt #${rejoinAttempts} failed: ${err.message}`)
    if (rejoinAttempts < 5) {
      setTimeout(() => attemptRejoinAfterRestart(bot), REJOIN_DELAY_MS)
    } else {
      LOG.error('Max rejoin attempts reached after server restart')
    }
  }
}

// ────────────────────────────────────────────────────────────────[...]
//  TPA request parser
// ────────────────────────────────────────────────────────────────[...]

const TPA_REGEXES = [
  /^(\w+) has requested (?:to teleport to you|that you teleport to them)\./i,
  /^(\w+) wants to teleport to you\./i,
  /^Teleport request from (\w+)\./i,
  /^(\w+) has requested a tp \(to (?:you|them)\)\./i,
  /^\[(\w+) → (?:you|\w+)\]/i,
]

function parseTpa (plain) {
  for (const re of TPA_REGEXES) {
    const m = re.exec(plain)
    if (m) return m[1]
  }
  return null
}

// ────────────────────────────────────────────────────────────────[...]
//  Overseer protection chat-message parser
// ────────────────────────────────────────────────────────────────[...]

const OVERSEER_REGEXES = [
  { re: /\[overseer\][^\w]*(\w+)\s+placed\s+(\w+)/i, suspect: 1, block: 2 },
  { re: /(\w+)\s+placed\s+(tnt|respawn[ _]anchor|end[ _]crystal)/i, suspect: 1, block: 2 },
  { re: /(tnt|respawn[ _]anchor|end[ _]crystal)\s+placed\s+by\s+(\w+)/i, block: 1, suspect: 2 },
]

function parseOverseer (plain) {
  for (const { re, suspect: si, block: bi } of OVERSEER_REGEXES) {
    const m = re.exec(plain)
    if (m) return { suspect: m[si], block: m[bi] }
  }
  return null
}

// ────────────────────────────────────────────────────────────────[...]
//  Per-tick guard logic
// ────────────────────────────────────────────────────────────────[...]

function setupGuardTick (bot) {
  bot.on('physicsTick', () => {
    tickCounter++

    if (adEnabled && isFullyInServer && tickCounter % AD_INTERVAL_TICKS === 0) {
      LOG.ad('Sending clan ad')
      try { bot.chat(CLAN_AD_MSG) } catch {}
    }

    if (tickCounter % 20 !== 0 || !bot.entity) return
    const myPos = bot.entity.position
    for (const id of Object.keys(bot.entities)) {
      const ent = bot.entities[id]
      if (!ent || ent.type !== 'player' || !ent.username) continue
      if (ent.username === bot.username) continue
      const dx = ent.position.x - myPos.x
      const dz = ent.position.z - myPos.z
      if (dx*dx + dz*dz > RENDER_DIST_SQ) continue
      if (isWhitelisted(ent.username)) continue
      alertIntruder(ent.username, Math.sqrt(dx*dx + dz*dz)).catch(() => {})
    }
  })
}

// ────────────────────────────────────────────────────────────────[...]
//  Block update watcher (TNT / danger blocks)
// ────────────────────────────────────────────────────────────────[...]

function setupBlockWatch (bot) {
  bot.on('blockUpdate', (_old, newBlock) => {
    if (!newBlock || !DANGER_BLOCKS.has(newBlock.name) || !bot.entity) return
    const bp   = newBlock.position
    const mp   = bot.entity.position
    const dist = Math.hypot(bp.x - mp.x, bp.y - mp.y, bp.z - mp.z)
    if (dist > 64) return

    let suspect = 'Unknown', bestDist = Infinity
    for (const id of Object.keys(bot.entities)) {
      const e = bot.entities[id]
      if (!e || e.type !== 'player' || !e.username) continue
      if (e.username === bot.username || isWhitelisted(e.username)) continue
      const d = e.position.distanceTo(newBlock.position)
      if (d < bestDist) { bestDist = d ; suspect = e.username }
    }
    alertBlockPlaced(newBlock.name, suspect).catch(() => {})
  })
}

// ────────────────────────────────────────────────────────────────[...]
//  installMonotonicChatTimestamp
// ────────────────────────────────────────────────────────────────[...]

function installMonotonicChatTimestamp (botInstance) {
  try {
    const client = botInstance?._client
    if (!client || client._monotonicChatInstalled) return
    if (typeof client._signedChat !== 'function') return
    let lastTs = BigInt(Date.now())
    const orig = client._signedChat.bind(client)
    client._signedChat = (message, options = {}) => {
      const now = BigInt(Date.now())
      if (!options.timestamp || options.timestamp < now) options.timestamp = now
      if (options.timestamp <= lastTs) options.timestamp = lastTs + 1n
      lastTs = options.timestamp
      return orig(message, options)
    }
    client._monotonicChatInstalled = true
    console.log('[CHAT] Installed monotonic chat timestamps')
  } catch (err) { console.error('[CHAT] Failed to install monotonic timestamps:', err.message) }
}

// ────────────────────────────────────────────────────────────────[...]
//  createBot
// ────────────────────────────────────────────────────────────────[...]

function createBot () {
  const bot = mineflayer.createBot({
    host: process.env.MC_HOST,
    port: parseInt(process.env.MC_PORT),
    username: process.env.MC_USERNAME,
    version: process.env.MC_VERSION,
    checkTimeoutInterval: parseInt(process.env.MC_TIMEOUT),
  })

  activeBot = bot
  bot.loadPlugin(pathfinder)
  // elytrafly plugin removed (not required)
  bot._client.once('playerJoin', () => installMonotonicChatTimestamp(bot))

  const tickTimes = [] ; let lastTick = null
  bot.on('physicsTick', () => {
    const now = Date.now()
    if (lastTick !== null) {
      tickTimes.push(now - lastTick)
      if (tickTimes.length > 20) tickTimes.shift()
      bot._clientTPS = Math.min(20, 1000 / (tickTimes.reduce((a,b)=>a+b,0)/tickTimes.length))
    }
    lastTick = now
  })
  let lastTimeUpdate = null
  bot._client.on('update_time', () => {
    const now = Date.now()
    if (lastTimeUpdate !== null) bot._serverTPS = Math.min(20, 20/((now-lastTimeUpdate)/1000))
    lastTimeUpdate = now
  })

  return bot
}

// ────────────────────────────────────────────────────────────────[...]
//  registerBotEvents — ENHANCED with server restart & whitelist-only TP
// ────────────────────────────────────────────────────────────────[...]

function registerBotEvents (bot) {
  let lastLoggedPlain = null

  bot.once('login', () => {
    console.log('[INFO] Bot logged in.')
    reconnectAttempts = 0
  })

  bot.on('spawn', () => {
    let hasLoggedIn = false
    console.log('[INFO] Spawned — preparing login sequence')

    setTimeout(() => {
      const pw = process.env.BOT_PASSWORD
      if (!pw) {
        console.warn('[WARN] BOT_PASSWORD not set.')
        return
      }
      console.log('[LOGIN] Sending /login')
      bot.chat(`/login ${pw}`)
      hasLoggedIn = true

      setTimeout(() => {
        try {
          bot.setControlState('forward', true)
          bot.setControlState('sprint', true)
          bot.setControlState('jump', true)
          setTimeout(() => {
            bot.clearControlStates()
            console.log('[BOT] Ready after login sequence')
          }, 10000)
        } catch {}
      }, 3000)
    }, 3000)
  })

  bot.on('messagestr', (message) => {
    const plain = stripAnsi(message)
    lastLoggedPlain = plain

    // ── ENHANCED: Server restart detection ──────────────────────────────────
    if (isServerRestartMessage(plain)) {
      handleServerRestart()
      // Schedule rejoin after server comes back online
      setTimeout(() => attemptRejoinAfterRestart(bot), REJOIN_DELAY_MS)
    }

    if (/you are now logged in! please enter the server through the portal\./i.test(plain) && !hasDoneInitialLobbyLogin) {
      hasDoneInitialLobbyLogin = true ; isFullyInServer = false
      console.log('Lobby login successful! Walking into portal...')

      const startDimension = bot.game?.dimension
      bot.setControlState('forward', true)
      bot.setControlState('sprint',  true)
      bot.setControlState('jump',    true)

      const maxMs = 60000, stepMs = 250 ; let elapsed = 0

      const watcher = setInterval(() => {
        elapsed += stepMs

        if (elapsed % 2000 === 0) {
          const p = bot.entity?.position
          console.log(`[PORTAL] t=${elapsed/1000}s  pos=${p ? `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}` : '?'}  dim=${bot.game?.dimension ?? '?'}`)
        }

        if (bot.game?.dimension !== startDimension && bot.game?.dimension !== undefined) {
          console.log(`[PORTAL] Dimension changed → ${bot.game.dimension}. Portal entered!`)
          clearInterval(watcher)
          stopPortalWalk()
          isFullyInServer = true
          return
        }

        if (isFullyInServer) { clearInterval(watcher) ; stopPortalWalk() ; return }

        if (elapsed >= maxMs) {
          stopPortalWalk()
          console.warn('[WARN] Portal walk timed out after 60s.')
          clearInterval(watcher)
          return
        }

        try {
          bot.setControlState('forward', true)
          bot.setControlState('sprint',  true)
          bot.setControlState('jump',    true)
        } catch {}
      }, stepMs)

      function stopPortalWalk () {
        try {
          bot.setControlState('forward', false)
          bot.setControlState('sprint',  false)
          bot.setControlState('jump',    false)
        } catch {}
      }
    }

    if (/welcome to 6b6t\.org/i.test(plain) && hasDoneInitialLobbyLogin && !isFullyInServer) {
      console.log('Welcome message! Bot is in main server.')
      try { bot.setControlState('forward', false) ; bot.setControlState('sprint', false) ; bot.setControlState('right', false) ; bot.setControlState('jump', false) } catch {}
      isFullyInServer = true
    }

    const cdMatch = /Please wait (\d+(?:\.\d+)?) seconds before sending another message!/i.exec(plain)
    if (cdMatch) {
      const secs = parseFloat(cdMatch[1])
      bot._cooldown = secs ; bot._cooldownUntil = Date.now() + Math.ceil(secs * 1000)
    }

    if (/incorrect password|wrong password/i.test(plain)) console.error('[ERROR] Login failed: incorrect password.')
    if (/please register/i.test(plain)) console.error('[ERROR] Login failed: account not registered.')
  })

  bot.on('message', (jsonMsg, position) => {
    const raw    = jsonMsg.toString ? jsonMsg.toString() : (jsonMsg.text || '')
    const plain  = stripAnsi(raw)
    const colored = formatChatMessage(jsonMsg)

    if (plain && plain !== lastLoggedPlain && !/^\d+ \d+$/.test(plain)) {
      console.log(`[CHAT] ${colored}`)
      lastLoggedPlain = plain
    }

    const ovMatch = parseOverseer(plain)
    if (ovMatch) {
      alertBlockPlaced(ovMatch.block, ovMatch.suspect).catch(() => {})
    }

    // ── ENHANCED: Whitelist-only TP acceptance ───────────────────────────────
    const tpaUser = parseTpa(plain)
    if (tpaUser) {
      LOG.tpa(`TPA request from ${tpaUser}`)
      if (isWhitelisted(tpaUser)) {
        LOG.tpa(`✅ ACCEPTING TPA from whitelisted: ${tpaUser}`)
        setTimeout(() => { try { bot.chat(`/tpy ${tpaUser}`) } catch {} }, 1000)
      } else {
        LOG.tpa(`❌ REJECTING TPA from non-whitelisted: ${tpaUser}`)
        setTimeout(() => { try { bot.chat(`/tpn ${tpaUser}`) } catch {} }, 1000)
      }
    }
  })

  bot.on('whisper', (username, message) => {
    if (username === bot.username) return
    console.log(`[WHISPER] ${username}: ${message}`)

    if (message.startsWith(ADMIN_PREFIX) && isWhitelisted(username)) {
      const body = message.slice(ADMIN_PREFIX.length).trim()
      handleAdminCommand(body, [], username)
      return
    }

    // ── ENHANCED: Whitelist-only TP via whisper ──────────────────────────────
    const tpaUser = parseTpa(message)
    if (tpaUser && tpaUser === username) {
      if (isWhitelisted(username)) {
        LOG.tpa(`✅ ACCEPTING TPA (whisper) from ${username}`)
        setTimeout(() => { try { bot.chat(`/tpy ${username}`) } catch {} }, 1000)
      } else {
        LOG.tpa(`❌ REJECTING TPA (whisper) from non-whitelisted: ${username}`)
        setTimeout(() => { try { bot.chat(`/tpn ${username}`) } catch {} }, 1000)
      }
    }
  })

  bot.on('death', () => {
    LOG.guard('Bot died — respawning immediately')
    try { bot.respawn() } catch {}
    setTimeout(() => {
      try { bot.chat(`/home ${DEFAULT_HOME}`) } catch {}
    }, 3000)
  })

  setupGuardTick(bot)
  setupBlockWatch(bot)

  bot.on('error', (err) => {
    const msg = err?.message || String(err)
    if (msg.includes('timed out') || msg.includes('keepAlive') || msg.includes('socketClosed')) return
    if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNREFUSED' || err?.code === 'EHOSTUNREACH') {
      console.log('[CONNECTION] Could not reach server. Will retry.') ; return
    }
    console.log(`[ERROR] ${msg}`)
  })

  bot.on('end', (reason) => {
    const knownQuiet = ['socketClosed', 'disconnect.quitting']
    const label = !reason || knownQuiet.includes(reason) ? 'Connection closed'
      : reason === 'keepAliveError' ? 'Server timed out' : reason
    console.log(`[DISCONNECTED] ${label}`)
    stopAntiAfk(null)
    
    // ── ENHANCED: If server restarted, try rejoin; else normal reconnect ─────
    if (serverRestartDetected) {
      setTimeout(() => attemptRejoinAfterRestart(bot), REJOIN_DELAY_MS)
    } else {
      scheduleReconnect()
    }
  })

  bot.on('kicked', (reason) => {
    let display = reason
    try { const p = typeof reason === 'string' ? JSON.parse(reason) : reason ; display = p?.text || p?.translate || JSON.stringify(p) } catch {}
    console.log(`[KICKED] ${display}`)
    if (reasonContainsVerificationBlock(reason)) {
      blockReconnectForVerification = true ; console.log('[RECONNECT] Verification required — restart manually.') ; return
    }
    scheduleReconnect()
  })
}

// ────────────────────────────────────────────────────────────────[...]
//  Reconnect helpers
// ────────────────────────────────────────────────────────────────[...]

function resetRuntimeState () {
  hasDoneInitialLobbyLogin = false
  isFullyInServer          = false
}

function getReconnectDelayMs () {
  if (isRestarting) return 30000
  return Math.min(BASE_RECONNECT_MS * (2 ** Math.max(0, reconnectAttempts - 1)), MAX_RECONNECT_MS)
}

function reasonContainsVerificationBlock (reason) {
  try { return /verify|verification code/i.test(typeof reason === 'string' ? reason : JSON.stringify(reason)) }
  catch { return false }
}

function scheduleReconnect () {
  if (blockReconnectForVerification) { console.log('[RECONNECT] Blocked — verification required.') ; return }
  if (reconnectTimer) return
  reconnectAttempts += 1
  const delay = getReconnectDelayMs()
  console.log(`[RECONNECT] Reconnecting in ${Math.floor(delay/1000)}s (attempt #${reconnectAttempts})`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null ; resetRuntimeState() ; isRestarting = false
    console.log('[RECONNECT] Reconnecting...')
    const nb = createBot()
    registerBotEvents(nb)
  }, delay)
}

// ────────────────────────────────────────────────────────────────[...]
//  Startup
// ────────────────────────────────────────────────────────────────[...]

startHttpBridge()
const bot = createBot()
registerBotEvents(bot)
console.log(`[GUARD] Connecting to ${process.env.MC_HOST}:${process.env.MC_PORT} as ${process.env.MC_USERNAME}`)
console.log(`[GUARD] Whitelist: ${WHITELIST.join(', ') || '(none)'}`)
console.log(`[GUARD] Ad every ${AD_INTERVAL_TICKS} ticks | Default home: ${DEFAULT_HOME}`)
console.log(`[GUARD] ✨ ENHANCED: Auto-rejoin on server restart + Whitelist-only TP`)
