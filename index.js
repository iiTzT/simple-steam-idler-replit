// index.js - robust Railway-friendly Steam idler (uses SHARED_SECRET / SENTRY)
// - Requires: steam-user, steam-totp
// - Env vars: USERNAME, PASSWORD, SHARED_SECRET (preferred) OR SENTRY (base64 of sentry file)
// - Does NOT require interactive Steam Guard codes (AUTHCODE removed)

const steamUser = require('steam-user');
const steamTotp = require('steam-totp');
const keep_alive = require('./keep_alive.js'); // keep-alive file if you have one
const fs = require('fs');

const USERNAME = process.env.USERNAME || process.env.username;
const PASSWORD = process.env.PASSWORD || process.env.password;
const SHARED_SECRET = process.env.SHARED_SECRET || process.env.shared;
const SENTRY_ENV = process.env.SENTRY; // optional: base64 sentry blob you can paste later

const SENTRY_PATH = './sentry';

if (!USERNAME || !PASSWORD) {
  console.error('ERROR: USERNAME and PASSWORD environment variables are required.');
  process.exit(1);
}

// If SENTRY env provided, write it to file (so steam-user can use it)
if (SENTRY_ENV && !fs.existsSync(SENTRY_PATH)) {
  try {
    fs.writeFileSync(SENTRY_PATH, Buffer.from(SENTRY_ENV, 'base64'));
    console.log('Wrote SENTRY file from SENTRY env var.');
  } catch (e) {
    console.warn('Failed to write SENTRY from env:', e.message);
  }
}

const client = new steamUser();

// Build fresh logOn options each attempt (important: regenerate 2FA every attempt)
function buildLogOnOptions() {
  const opts = {
    accountName: USERNAME,
    password: PASSWORD,
  };

  // attach sentry file if exists
  if (fs.existsSync(SENTRY_PATH)) {
    try {
      opts.sentry = fs.readFileSync(SENTRY_PATH);
      console.log('Using existing sentry file for login.');
    } catch (e) {
      console.warn('Failed to read sentry file:', e.message);
    }
  }

  // prefer SHARED_SECRET for mobile 2FA (auto-generated)
  if (SHARED_SECRET) {
    try {
      opts.twoFactorCode = steamTotp.generateAuthCode(SHARED_SECRET);
      console.log('Using mobile 2FA (SHARED_SECRET) for login.');
    } catch (e) {
      console.warn('Failed to generate 2FA code from SHARED_SECRET:', e.message);
    }
  }

  return opts;
}

// Save sentry blob on first login so future logins don't need codes
client.on('sentry', (sentry) => {
  try {
    fs.writeFileSync(SENTRY_PATH, sentry);
    console.log('Saved sentry file locally.');
    console.log('Store this value in your SENTRY env var (base64) to avoid future email codes:');
    console.log(sentry.toString('base64'));
  } catch (e) {
    console.warn('Failed to save sentry file:', e.message);
  }
});

// If Steam asks for steamGuard (email) we WILL NOT attempt interactive input.
// Abort gracefully to avoid looping and rate limits. Use SHARED_SECRET or SENTRY instead.
client.on('steamGuard', (domain, callback, lastCodeWrong) => {
  console.error('steamGuard requested an email code for domain:', domain);
  console.error('This deployment does NOT accept interactive codes. Aborting to avoid rate limits.');
  console.error('Solution: enable mobile auth and set SHARED_SECRET, or set SENTRY after a successful desktop login.');
  process.exit(1);
});

client.on('error', (err) => {
  // steam-user throws rich objects sometimes; show helpful summary
  if (err && err.eresult) {
    console.error('Steam error:', err.message || err);
    console.error('eresult code:', err.eresult);
  } else {
    console.error('Steam error:', err && err.message ? err.message : err);
  }
});

// On successful login -> set persona and start idling
client.on('loggedOn', () => {
  console.log(`${client.steamID} - Successfully logged on`);
  client.setPersona(7); // invisible
  const games = [730, 714010, 440, 3419430, 291550, 1938090, 1905180, 1275350, 2021910, 1665460, 666220, 2281730, 578080];
  client.gamesPlayed(games);
});

// simple, safe retry/backoff to avoid hammering Steam (prevents immediate rate-limit)
let retryCount = 0;
const MAX_RETRIES = 6;

function attemptLogin() {
  const opts = buildLogOnOptions();

  // If neither SHARED_SECRET nor SENTRY is present and Steam requests email codes,
  // you'll get steamGuard and the process exits. This check prevents pointless retries.
  if (!SHARED_SECRET && !fs.existsSync(SENTRY_PATH)) {
    console.error('No SHARED_SECRET and no SENTRY file present. This environment will likely require an email code.');
    console.error('Set SHARED_SECRET env var (preferred) or provide a SENTRY env var with a base64 saved sentry blob.');
    process.exit(1);
  }

  console.log('Attempting login (attempt #' + (retryCount + 1) + ')');
  try {
    client.logOn(opts);
  } catch (e) {
    console.error('Immediate logOn error:', e && e.message ? e.message : e);
    scheduleRetry(e && e.eresult);
  }
}

// Schedule retry with exponential backoff (long delays to avoid rate limits)
function scheduleRetry(eresultCode) {
  retryCount++;
  if (retryCount > MAX_RETRIES) {
    console.error('Max retries exceeded. Aborting.');
    process.exit(1);
  }
  // If rate limit, wait longer before retrying
  const base = (eresultCode === 84) ? 60000 : 30000; // 84 = RateLimitExceeded -> 60s base
  const delay = base * Math.pow(2, Math.max(0, retryCount - 1)); // exponential
  console.log(`Retrying in ${Math.round(delay / 1000)}s (retry ${retryCount}/${MAX_RETRIES})...`);
  // ensure client logged off before retry
  try { client.logOff(); } catch (e) { /* ignore */ }
  setTimeout(() => {
    attemptLogin();
  }, delay);
}

// react to specific logon responses via steam-user internals (catch repeated failures)
client.on('logOnResponse', (response) => {
  // response can contain eresult; on success it's OK
  if (response && response.eresult && response.eresult !== 1) { // 1 == OK
    console.warn('LogOnResponse eresult:', response.eresult);
    // for safety, schedule retry on non-success codes that are retryable
    if (response.eresult === 84) { // RateLimitExceeded
      scheduleRetry(response.eresult);
    } else {
      // other codes are probably auth issues; avoid retrying too fast
      scheduleRetry(response.eresult);
    }
  }
});

// catch unhandled promise rejections (debugging)
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

// Start the first login attempt
attemptLogin();
