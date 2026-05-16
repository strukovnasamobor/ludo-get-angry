const SCRIPT_WAIT_MS    = 2000;
const PROMPT_TIMEOUT_MS = 3000;
const FAILURE_TTL_MS    = 5 * 60 * 1000;
const FAILURE_KEY       = 'oneTapFailedAt';

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

export async function promptOneTap(clientId) {
  if (isEmbeddedWebView())   throw new Error('one-tap-webview');
  if (recentlyFailed())      throw new Error('one-tap-recent-failure');
  if (!(await waitForGsi())) throw new Error('one-tap-no-script');

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, val) => { if (!settled) { settled = true; fn(val); } };
    const timeout = setTimeout(() => {
      markFailed();
      finish(reject, new Error('one-tap-timeout'));
    }, PROMPT_TIMEOUT_MS);

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: ({ credential }) => {
        clearTimeout(timeout);
        if (credential) { clearFailed(); finish(resolve, credential); }
        else            { markFailed();  finish(reject, new Error('one-tap-no-credential')); }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true,
      itp_support: true,
      context: 'signin',
    });

    // Under FedCM, notification status methods are deprecated and unreliable.
    // Credential callback + the timeout above are the source of truth.
    window.google.accounts.id.prompt();
  });
}

export function disableOneTapAutoSelect() {
  try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch { /* GSI not loaded */ }
  clearFailed();
}
