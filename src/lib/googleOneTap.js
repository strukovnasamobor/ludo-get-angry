const SCRIPT_WAIT_MS = 2000;
const PROMPT_TIMEOUT_MS = 8000;

function isEmbeddedWebView() {
  const ua = navigator.userAgent || '';
  return /\b(FBAN|FBAV|Instagram|TikTok|Line|MicroMessenger|; wv\))\b/i.test(ua);
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
  if (isEmbeddedWebView()) throw new Error('one-tap-webview');
  if (!(await waitForGsi())) throw new Error('one-tap-no-script');

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, val) => { if (!settled) { settled = true; fn(val); } };
    const timeout = setTimeout(
      () => finish(reject, new Error('one-tap-timeout')),
      PROMPT_TIMEOUT_MS
    );

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: ({ credential }) => {
        clearTimeout(timeout);
        if (credential) finish(resolve, credential);
        else            finish(reject, new Error('one-tap-no-credential'));
      },
      auto_select: true,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true,
      itp_support: true,
      context: 'signin',
    });

    window.google.accounts.id.prompt((n) => {
      try {
        if (n.isNotDisplayed?.()) {
          clearTimeout(timeout);
          finish(reject, new Error('one-tap-not-displayed:' + n.getNotDisplayedReason?.()));
        } else if (n.isSkippedMoment?.()) {
          clearTimeout(timeout);
          finish(reject, new Error('one-tap-skipped:' + n.getSkippedReason?.()));
        } else if (n.isDismissedMoment?.()) {
          const reason = n.getDismissedReason?.();
          if (reason === 'credential_returned') return;
          clearTimeout(timeout);
          finish(reject, new Error('one-tap-dismissed:' + reason));
        }
      } catch {
        // FedCM may neutralize these methods — credential callback or timeout wins.
      }
    });
  });
}

export function disableOneTapAutoSelect() {
  try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch { /* GSI not loaded */ }
}
