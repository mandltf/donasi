const { firestore, fieldValue, firebaseEnabled } = require('../config/firebaseAdmin');

function ensureEnabled() {
  if (!firebaseEnabled || !firestore) {
    return false;
  }
  return true;
}

async function safeFirestoreWrite(action, fallback = null) {
  try {
    return await action();
  } catch (error) {
    console.warn('Firestore write skipped:', error.message || error);
    return fallback;
  }
}

async function syncKebutuhanRealtime(kebutuhan) {
  if (!ensureEnabled()) return null;
  return safeFirestoreWrite(() => firestore.collection('update_kebutuhan_realtime').doc(String(kebutuhan.id)).set({
    ...kebutuhan,
    updated_at: fieldValue.serverTimestamp()
  }, { merge: true }));
}

async function logDonationNotification(notification) {
  if (!ensureEnabled()) return null;
  return safeFirestoreWrite(() => firestore.collection('notifikasi_donatur').add({
    ...notification,
    created_at: fieldValue.serverTimestamp()
  }));
}

async function logAdminNotification(notification) {
  if (!ensureEnabled()) return null;
  return safeFirestoreWrite(() => firestore.collection('notifikasi_admin').add({
    ...notification,
    is_read: false,
    created_at: fieldValue.serverTimestamp()
  }));
}

async function logTransparansiTimeline(entry) {
  if (!ensureEnabled()) return null;
  return safeFirestoreWrite(() => firestore.collection('transparansi_timeline').add({
    ...entry,
    created_at: fieldValue.serverTimestamp()
  }));
}

async function logBuktiFoto(entry) {
  if (!ensureEnabled()) return null;
  return safeFirestoreWrite(() => firestore.collection('bukti_foto').add({
    ...entry,
    created_at: fieldValue.serverTimestamp()
  }));
}

async function logCeritaAktivitas(entry) {
  if (!ensureEnabled()) return null;
  return safeFirestoreWrite(() => firestore.collection('cerita_log_aktivitas_panti').add({
    ...entry,
    created_at: fieldValue.serverTimestamp()
  }));
}

async function logStorageUpload(entry) {
  if (!ensureEnabled()) return null;
  return safeFirestoreWrite(() => firestore.collection('storage_uploads').add({
    ...entry,
    created_at: fieldValue.serverTimestamp()
  }));
}

async function listCollection(collectionName, orderByField = 'created_at') {
  if (!ensureEnabled()) return [];
  try {
    const snapshot = await firestore.collection(collectionName).orderBy(orderByField, 'desc').get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn('Firestore read skipped:', error.message || error);
    return [];
  }
}

async function listNotificationsByDonatur(idDonatur) {
  if (!ensureEnabled()) return [];
  try {
    const snapshot = await firestore.collection('notifikasi_donatur')
      .where('id_donatur', '==', Number(idDonatur))
      .orderBy('created_at', 'desc')
      .get();

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn('Firestore read skipped:', error.message || error);
    return [];
  }
}

module.exports = {
  syncKebutuhanRealtime,
  logDonationNotification,
  logAdminNotification,
  logTransparansiTimeline,
  logBuktiFoto,
  logCeritaAktivitas,
  logStorageUpload,
  listCollection,
  listNotificationsByDonatur
};
