const SCRIPT_WAIT_MS    = 2000;
const PROMPT_TIMEOUT_MS = 8000;
const FAILURE_TTL_MS    = 5 * 60 * 1000;
const FAILURE_KEY       = 'oneTapFailedAt';

function cancelOneTapUi() {
  try { window.google?.accounts?.id?.cancel?.(); } catch { /* GSI not loaded */ }
}

function isEmbeddedWebView() {
  const ua = navigator.userAgent || '';
  return /\b(FBAN|FBAV|Instagram|TikTok|Line|MicroMessenger|; wv\))\b/i.test(ua);
}

function recentlyFailed() {
  try {
    const ts = Number(localStorage.getItem(FAILURE_KEY));
    return ts && (Date.now() - ts) < FAILURE_TTL_MS;
  } catch { return false; }
}

function markFailed() {
  try { localStorage.setItem(FAILURE_KEY, String(Date.now())); } catch { /* storage blocked */ }
}

function clearFailed() {
  try { localStorage.removeItem(FAILURE_KEY); } catch { /* storage blocked */ }
}

async function waitForGsi() {
  const deadline = Date.now() + SCRIPT_WAIT_MS;
  while (Date.now() < deadline) {
    if (window.google?.accounts?.id) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

let initialized = false;
let activeResolve = null;
let activeReject  = null;
let activeTimeout = null;

function clearActive() {
  if (activeTimeout) { clearTimeout(activeTimeout); activeTimeout = null; }
  activeResolve = null;
  activeReject  = null;
}

function resolveActive(val) {
  const r = activeResolve;
  clearActive();
  if (r) r(val);
}

function rejectActive(err) {
  const j = activeReject;
  clearActive();
  if (j) j(err);
}

function ensureInitialized(clientId) {
  if (initialized) return;
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: ({ credential }) => {
      if (credential) { clearFailed(); resolveActive(credential); }
      else            { markFailed();  rejectActive(new Error('one-tap-no-credential')); }
    },
    auto_select: false,
    cancel_on_tap_outside: true,
    use_fedcm_for_prompt: true,
    itp_support: true,
    context: 'signin',
  });
  initialized = true;
}

export async function promptOneTap(clientId) {
  if (isEmbeddedWebView())   throw new Error('one-tap-webview');
  if (recentlyFailed())      throw new Error('one-tap-recent-failure');
  if (!(await waitForGsi())) throw new Error('one-tap-no-script');

  return new Promise((resolve, reject) => {
    // Supersede any pending prompt so its resolve/reject don't fire later.
    if (activeResolve) {
      cancelOneTapUi();
      rejectActive(new Error('one-tap-superseded'));
    }

    activeResolve = resolve;
    activeReject  = reject;
    activeTimeout = setTimeout(() => {
      cancelOneTapUi();                  // dismiss the still-visible bubble before popup-fallback
      markFailed();
      rejectActive(new Error('one-tap-timeout'));
    }, PROMPT_TIMEOUT_MS);

    ensureInitialized(clientId);

    // Under FedCM, notification status methods are deprecated and unreliable.
    // Credential callback + the timeout above are the source of truth.
    window.google.accounts.id.prompt();
  });
}

export function disableOneTapAutoSelect() {
  try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch { /* GSI not loaded */ }
  clearFailed();
}
