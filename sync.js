// Keeps one shared copy of the data in Firebase. The device's own copy stays
// usable offline, and its changes are merged in when it reconnects.
const VERSION = '10.14.1';
const CDN = `https://www.gstatic.com/firebasejs/${VERSION}`;
const BASE_KEY = 'elazhary-sync-base';
const DIRTY_KEY = 'elazhary-sync-dirty';
const SAVE_DELAY_MS = 300;

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (err) {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch (err) {
    console.error('Could not save sync state', err);
  }
}

export async function startSync({ config, getState, setState, clearLocal, onStatus }) {
  const [{ initializeApp }, authLib, storeLib] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);
  const { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } = authLib;
  const { getFirestore, doc, onSnapshot, runTransaction, serverTimestamp } = storeLib;

  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const ref = doc(db, 'households', 'main');

  const saved = readJson(BASE_KEY);
  let base = saved ? saved.data : null;
  let revision = saved ? saved.revision : 0;
  let dirty = localStorage.getItem(DIRTY_KEY) === '1';
  let user = null;
  let unsubscribe = null;
  let saving = false;
  let saveAgain = false;
  let timer = null;
  let lastEditor = null;

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function report(state, extra) {
    onStatus({ state, dirty, updatedBy: lastEditor, userName: user && (user.displayName || user.email), ...extra });
  }

  function markDirty(value) {
    dirty = value;
    writeLocal(DIRTY_KEY, value ? '1' : null);
  }

  function setBase(data, rev) {
    base = data;
    revision = rev;
    writeLocal(BASE_KEY, { data, revision: rev });
  }

  function handleError(err) {
    if (err && err.code === 'permission-denied') {
      report('denied');
      signOut(auth);
    } else {
      console.warn('Sync paused', err);
      report('offline');
    }
  }

  async function flush() {
    if (!user) return;
    if (saving) {
      saveAgain = true;
      return;
    }
    saving = true;
    report('saving');
    const sent = JSON.stringify(getState());
    try {
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const remote = snap.exists() ? JSON.parse(snap.data().json) : null;
        const merged = window.Merge.mergeData(base, JSON.parse(sent), remote);
        const nextRevision = (snap.exists() ? snap.data().revision : 0) + 1;
        tx.set(ref, {
          json: JSON.stringify(merged),
          revision: nextRevision,
          updatedAt: serverTimestamp(),
          updatedBy: user.displayName || user.email,
        });
        return { merged, nextRevision };
      });
      setBase(result.merged, result.nextRevision);
      lastEditor = user.displayName || user.email;
      if (JSON.stringify(getState()) === sent) {
        markDirty(false);
        if (!same(result.merged, getState())) setState(result.merged);
      } else {
        // The person kept editing while this save was on its way.
        saveAgain = true;
      }
      report('synced');
    } catch (err) {
      handleError(err);
    } finally {
      saving = false;
      if (saveAgain) {
        saveAgain = false;
        flush();
      }
    }
  }

  function listen() {
    unsubscribe = onSnapshot(ref, (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      const hasLocalData = getState().banks.length > 0;
      if (!snap.exists()) {
        if (hasLocalData) {
          markDirty(true);
          flush();
        } else {
          report('synced');
        }
        return;
      }
      const { json, revision: remoteRevision, updatedBy } = snap.data();
      lastEditor = updatedBy || lastEditor;
      if (dirty || (base == null && hasLocalData)) {
        markDirty(true);
        flush();
        return;
      }
      if (remoteRevision !== revision) {
        const remote = JSON.parse(json);
        setBase(remote, remoteRevision);
        setState(remote);
      }
      report('synced');
    }, handleError);
  }

  onAuthStateChanged(auth, (nextUser) => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    user = nextUser;
    if (user) {
      report(dirty ? 'saving' : 'synced');
      listen();
    } else {
      onStatus({ state: 'signedOut', dirty });
    }
  });

  window.addEventListener('online', () => {
    if (user && dirty) flush();
  });

  return {
    changed() {
      markDirty(true);
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DELAY_MS);
    },
    async signIn() {
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
          await signInWithRedirect(auth, provider);
        } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
          throw err;
        }
      }
    },
    async signOut() {
      clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      await signOut(auth);
      markDirty(false);
      setBase(null, 0);
      writeLocal(BASE_KEY, null);
      clearLocal();
    },
  };
}
