require('dotenv').config()

module.exports = {

  host    : process.env.BOT_HOST     || 'alt.6b6t.org',
  port    : process.env.BOT_PORT     ? parseInt(process.env.BOT_PORT, 10) : 25565,
  username: process.env.BOT_USERNAME || 'TGPBot',
  version : process.env.BOT_VERSION  || '1.20.1',

  checkTimeoutInterval: process.env.BOT_CHECK_TIMEOUT_MS
    ? parseInt(process.env.BOT_CHECK_TIMEOUT_MS, 10)
    : 120000,

  prefix: '^',

  trustedPlayers: [
    'Pala_32',
    'PiercingC1aws',
    '1nvoke_',
    'pxla',
    'Volizray',
    'ait7na',
    '0jrv',
    'SwiftyPotato',
    'beast_machine',
    'Hazelib',
    'Qetrov4',
    '_ItsInvoke_',
    '1nvoke_',
    'xXBaboBastiXx',
    'Keyzho',
    'Majestic1337',
    'Murphh',
    'PestKatze',
    'Bamjams',
  ],
}
