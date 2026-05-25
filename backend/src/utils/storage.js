const path = require('path');
const crypto = require('crypto');
const { bucket, storageEnabled } = require('../config/storage');

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function uploadBufferToStorage(file, folder) {
  if (!file) {
    return null;
  }
  if (!storageEnabled || !bucket) {
    console.warn('Skipping upload because Firebase Storage is not configured.');
    return null;
  }

  const extension = path.extname(file.originalname || '').toLowerCase();
  const objectName = `${folder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
  const storageFile = bucket.file(objectName);

  await storageFile.save(file.buffer, {
    contentType: file.mimetype,
    resumable: false,
    metadata: {
      cacheControl: 'public, max-age=31536000'
    }
  });

  const [signedUrl] = await storageFile.getSignedUrl({
    action: 'read',
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7
  });

  return {
    path: objectName,
    url: signedUrl,
    fileName: sanitizeFileName(file.originalname || 'file'),
    originalName: file.originalname || 'file',
    mimeType: file.mimetype || null,
    size: file.size || null,
    bucketName: bucket.name,
    folder
  };
}

function extractStorageObjectPath(storedUrl) {
  if (!storedUrl || typeof storedUrl !== 'string') {
    return null;
  }

  if (storedUrl.startsWith('https://storage.googleapis.com/')) {
    // Match: https://storage.googleapis.com/{bucket}/{object}[?query]
    const m = storedUrl.match(/^https:\/\/storage\.googleapis\.com\/[^\/]+\/(.+?)(?:\?|$)/);
    return m ? m[1] : null;
  }

  if (storedUrl.startsWith('https://firebasestorage.googleapis.com/')) {
    const match = storedUrl.match(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^\/]+\/o\/(.+?)(?:\?|$)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  if (storedUrl.startsWith('gs://')) {
    return storedUrl.replace(/^gs:\/\/[^^/]+\//, '');
  }

  return null;
}

async function getSignedUrlForStoredUrl(storedUrl) {
  if (!storageEnabled || !bucket || !storedUrl) {
    return storedUrl || null;
  }

  // If the URL already appears to be a signed URL, return it as-is.
  if (
    storedUrl.includes('signBlob=') ||
    storedUrl.includes('X-Goog-Signature=') ||
    storedUrl.includes('GoogleAccessId=') ||
    storedUrl.includes('Expires=')
  ) {
    return storedUrl;
  }

  const objectPath = extractStorageObjectPath(storedUrl);
  if (!objectPath) {
    return storedUrl;
  }

  const [signedUrl] = await bucket.file(objectPath).getSignedUrl({
    action: 'read',
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7
  });

  return signedUrl;
}

module.exports = {
  uploadBufferToStorage,
  getSignedUrlForStoredUrl
};
