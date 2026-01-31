// index.js
const steamUser = require('steam-user');
const steamTotp = require('steam-totp');
const keep_alive = require('./keep_alive.js');
const fs = require('fs');

const USERNAME = process.env.USERNAME || process.env.username;
const PASSWORD = process.env.PASSWORD || process.env.password;
const SHARED_SECRET = process.env.SHARED_SECRET || process.env.shared;
const AUTHCODE = process.env.AUTHCODE; // optional: one-time email code
const SENTRY_ENV = process.env.SENTRY;  // optional: base64 of saved sentry file

if (!USERNAME || !PASSWORD) {
  console.error('ERROR: USERNAME and PASSWORD environment variables are required.');
  process.exit(1);
}

const SENTRY_PATH = './sentry';

// If user set SENTRY env (base64), write it to file so steam-user can use it
if (SENTRY_ENV && !fs.existsSync(SENTRY_PATH)) {
  try {
    fs.writeFileSync(SENTRY_PATH, Buffer.from(SENTRY_ENV, 'base64'));
    console.log('Wrote SENTRY file from SENTRY env var.');
  } catch (e) {
    console.warn('Failed to write SENTRY from env:', e.message);
  }
}

const client = new steamUser();

const logOnOptions = {
  accountName: USERNAME,
  password: PASSWORD,
};

// Add twoFactorCode if SHARED_SECRET exists
if (SHARED_SECRET) {
  try {
    logOnOptions.twoFactorCode = steamTotp.generateAuthCode(SHARED_SECRET);
  } catch (e) {
    console.error('Invalid SHARED_SECRET (cannot generate 2FA code):', e.message);
  }
}

// If we have a sentry file, attach it
if (fs.existsSync(SENTRY_PATH)) {
  try {
    logOnOptions.sentry = fs.readFileSync(SENTRY_PATH);
    console.log('Using existing sentry file for login.');
  } catch (e) {
    console.warn('Failed to read existing sentry file:', e.message);
  }
}

// Handle steam guard (email) prompts without hanging
client.on('steamGuard', (domain, callback, lastCodeWrong) => {
  console.log('steamGuard event. Domain:', domain, 'lastCodeWrong:', lastCodeWrong);
  if (AUTHCODE) {
    console.log('Using AUTHCODE from env to respond to Steam Guard (email) challenge.');
    callback(AUTHCODE);
  } else {
    console.error('No AUTHCODE env var set. This environment cannot accept interactive Steam Guard input.');
    console.error('If you received an email code, set it in the AUTHCODE env var and redeploy ONCE.');
    console.error('After a successful login you will get a sentry blob in the logs — save that as the SENTRY env var for future logins.');
    process.exit(1);
  }
});

// Save sentry (so future logins won't require email codes)
client.on('sentry', (sentry) => {
  try {
    fs.writeFileSync(SENTRY_PATH, sentry);
    console.log('Saved sentry file locally. Important: copy this base64 and store it in the SENTRY env var to avoid future email prompts:');
    console.log(sentry.toString('base64'));
  } catch (e) {
    console.warn('Failed to save sentry file:', e.message);
  }
});

client.on('error', (err) => {
  console.error('Steam error:', err);
});

client.on('loggedOn', () => {
  console.log(client.steamID + ' - Successfully logged on');
  client.setPersona(7); // invisible
  const games = [730, 714010, 440, 3419430, 291550, 1938090, 1905180, 1275350, 2021910, 1665460, 666220, 2281730, 578080];
  client.gamesPlayed(games);
});

// finally, log on
client.logOn(logOnOptions);
