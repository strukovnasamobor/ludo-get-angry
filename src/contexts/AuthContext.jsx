import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { auth, googleProvider, GOOGLE_CLIENT_ID } from '../../firebase';
import { promptOneTap as gisPromptOneTap, disableOneTapAutoSelect } from '../lib/googleOneTap';

const AuthContext = createContext(null);

function isAllowedEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith('@gmail.com');
}

const NOT_ALLOWED_MSG = 'Only @gmail.com accounts are allowed.';
const UNAVAILABLE_ERRORS = new Set(['one-tap-webview', 'one-tap-recent-failure', 'one-tap-no-script']);

export function AuthProvider({ children }) {
  const [user, setUser]                   = useState(null);
  const [loading, setLoading]             = useState(true);
  const [redirectError, setRedirectError] = useState('');
  const [displayName, setDisplayName]     = useState('');

  useEffect(() => {
    if (!auth) { setLoading(false); return; }
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser && !isAllowedEmail(firebaseUser.email)) {
        await signOut(auth);
        setRedirectError(NOT_ALLOWED_MSG);
        return;
      }
      setUser(firebaseUser);
      setDisplayName(firebaseUser?.displayName || '');
      window.dispatchEvent(new Event('auth-changed'));
      setLoading(false);
    });
  }, []);

  async function promptOneTap() {
    let idToken;
    try {
      idToken = await gisPromptOneTap(GOOGLE_CLIENT_ID);
    } catch (err) {
      const msg = err?.message || '';
      return UNAVAILABLE_ERRORS.has(msg) ? 'unavailable' : 'cancelled';
    }
    try {
      const cred = GoogleAuthProvider.credential(idToken);
      const result = await signInWithCredential(auth, cred);
      if (!isAllowedEmail(result.user.email)) {
        await signOut(auth);
        return 'blocked';
      }
      return 'success';
    } catch (err) {
      // Surface the reason — most commonly auth/invalid-credential, which
      // means the Firebase Console's Google provider isn't bound to the
      // same Web Client ID used for One Tap.
      // Firebase Console → Authentication → Sign-in method → Google →
      // "Web SDK configuration" → paste the Web Client ID + Secret.
      console.warn('[one-tap] signInWithCredential failed:', err?.code, err?.message);
      return 'error';
    }
  }

  async function signInWithGoogle() {
    if (auth.currentUser) return;
    setRedirectError('');

    const r = await promptOneTap();
    if (r === 'success') return;
    if (r === 'blocked') {
      throw new Error(NOT_ALLOWED_MSG);
    }
    // r === 'unavailable' | 'cancelled' | 'error' → fall through to popup.

    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (!isAllowedEmail(result.user.email)) {
        await signOut(auth);
        throw new Error(NOT_ALLOWED_MSG);
      }
    } catch (err) {
      if (err?.code === 'auth/popup-closed-by-user') return;
      const wrapped = new Error(`popup: ${err?.code || err?.message || 'failed'}`);
      wrapped.cause = err;
      throw wrapped;
    }
  }

  async function signOutUser() {
    await signOut(auth);
    disableOneTapAutoSelect();
  }

  async function updateDisplayName(name) {
    const trimmed = (name || '').trim();
    if (!auth.currentUser) return;
    await updateProfile(auth.currentUser, { displayName: trimmed });
    await auth.currentUser.getIdToken(true);
    setDisplayName(trimmed);
  }

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      redirectError,
      displayName,
      signInWithGoogle,
      signOut: signOutUser,
      promptOneTap,
      updateDisplayName,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
