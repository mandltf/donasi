const app = require('./app');
const env = require('./config/env');
const { firebaseEnabled } = require('./config/firebaseAdmin');
const { storageEnabled } = require('./config/storage');

app.listen(env.port, () => {
  console.log(`Backend berjalan di port ${env.port}`);
  if (!firebaseEnabled) console.warn('Firestore disabled: realtime features and notifications will be no-op.');
  if (!storageEnabled) console.warn('Firebase Storage disabled: file uploads will be skipped.');
});
