import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithRedirect,
  signInWithCredential,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import { auth, googleProvider, GOOGLE_CLIENT_ID } from '../../firebase';
import { promptOneTap, disableOneTapAutoSelect } from '../lib/googleOneTap';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) { setLoading(false); return; }
    getRedirectResult(auth).catch(e => {
      if (import.meta.env.DEV) console.info('[auth] getRedirectResult:', e?.code);
    });
    return onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
  }, []);

  async function signInWithGoogle() {
    if (auth.currentUser) return;
    try {
      const idToken = await promptOneTap(GOOGLE_CLIENT_ID);
      const cred = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, cred);
      return;
    } catch (err) {
      if (import.meta.env.DEV) {
        console.info('[auth] One Tap failed, falling back to redirect:', err.message);
      }
    }
    await signInWithRedirect(auth, googleProvider);
  }

  async function signOutUser() {
    await signOut(auth);
    disableOneTapAutoSelect();
  }

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut: signOutUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
