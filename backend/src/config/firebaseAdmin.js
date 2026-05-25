const admin = require('firebase-admin');
const env = require('./env');

let firestore = null;
let fieldValue = null;
let firebaseAdminInstance = null;
let firebaseEnabled = false;

try {
  if (!admin.apps.length) {
    // Coba inisialisasi dengan kredensial default (service account) jika tersedia
    const initConfig = {};
    if (env.gcpProjectId) initConfig.projectId = env.gcpProjectId;
    if (env.firebaseDatabaseUrl) initConfig.databaseURL = env.firebaseDatabaseUrl;
    if (env.firebaseStorageBucket) initConfig.storageBucket = env.firebaseStorageBucket;

    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      ...initConfig
    });
  }

  // Jika berhasil, ambil firestore dan fieldValue
  firestore = admin.firestore();
  fieldValue = admin.firestore.FieldValue;
  firebaseAdminInstance = admin;
  firebaseEnabled = true;
  console.log('Firebase admin initialized.');
} catch (err) {
  // Jika gagal inisialisasi, biarkan aplikasi tetap berjalan tanpa Firestore
  console.warn('Firebase admin not initialized, continuing without Firestore/GCS:', err.message || err);
  firestore = null;
  fieldValue = null;
  firebaseAdminInstance = null;
  firebaseEnabled = false;
}

module.exports = {
  admin: firebaseAdminInstance,
  firestore,
  fieldValue,
  firebaseEnabled
};
