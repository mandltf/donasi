const dotenv = require('dotenv');

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Set it in Cloud Run or Secret Manager.');
}

const env = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  gcpProjectId: process.env.GCP_PROJECT_ID || '',
  gcsBucketName: process.env.GCS_BUCKET_NAME || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  firebaseDatabaseUrl: process.env.FIREBASE_DATABASE_URL || ''
};

module.exports = env;