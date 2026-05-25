const { admin, firebaseEnabled } = require('./firebaseAdmin');
const env = require('./env');

let bucket = null;
let storageEnabled = false;

try {
  if (!firebaseEnabled || !admin) {
    throw new Error('Firebase admin not initialized');
  }

  const bucketName = env.firebaseStorageBucket || env.gcsBucketName;
  bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
  if (!bucket) {
    throw new Error('Firebase Storage bucket not configured');
  }

  storageEnabled = true;
  console.log('Firebase Storage initialized for bucket:', bucket.name);
} catch (err) {
  console.warn('Firebase Storage not initialized, uploads will be disabled:', err.message || err);
  bucket = null;
  storageEnabled = false;
}

module.exports = {
  bucket,
  storageEnabled
};
