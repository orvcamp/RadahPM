// backend/db/r2.js
// Cloudflare R2 client (S3-compatible) for generating presigned upload
// and download URLs. Files are uploaded/downloaded directly between the
// browser and R2 using these short-lived signed URLs — the file bytes
// never pass through this backend server.
//
// Required environment variables (set in Railway):
//   R2_ACCOUNT_ID        - your Cloudflare account ID
//   R2_ACCESS_KEY_ID     - the Access Key ID from the R2 API token
//   R2_SECRET_ACCESS_KEY - the Secret Access Key from the R2 API token
//   R2_BUCKET            - the bucket name, e.g. radah-pm-documents

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET;

// Whether R2 is configured. If not, the documents feature is disabled
// gracefully rather than crashing the whole server.
const isConfigured = Boolean(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET);

if (!isConfigured) {
  console.warn(
    "[radah-pm] R2 storage is not fully configured. The documents feature " +
      "will be disabled until R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
      "R2_SECRET_ACCESS_KEY, and R2_BUCKET are all set."
  );
}

const client = isConfigured
  ? new S3Client({
      region: "auto",
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      },
    })
  : null;

/**
 * Generate a presigned URL the browser can PUT a file to directly.
 * Expires in 10 minutes.
 */
async function getUploadUrl(storageKey, contentType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    ContentType: contentType || "application/octet-stream",
  });
  return getSignedUrl(client, command, { expiresIn: 600 });
}

/**
 * Generate a presigned URL the browser can GET (download) a file from.
 * Expires in 10 minutes. Forces a download with the original filename.
 */
async function getDownloadUrl(storageKey, fileName) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    ResponseContentDisposition: fileName
      ? `attachment; filename="${fileName.replace(/"/g, "")}"`
      : undefined,
  });
  return getSignedUrl(client, command, { expiresIn: 600 });
}

/**
 * Generate a presigned URL the browser can display INLINE (preview) rather
 * than force-download. Used by the in-app document viewer.
 */
async function getViewUrl(storageKey, contentType) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    ResponseContentDisposition: "inline",
    ResponseContentType: contentType || undefined,
  });
  return getSignedUrl(client, command, { expiresIn: 600 });
}

/**
 * Upload a buffer directly to the bucket from the server (as opposed to a
 * presigned URL the browser uploads through). Used for files the backend
 * generates itself, like an exported pay application PDF, where there's no
 * browser-side file to hand a presigned URL to.
 */
async function putObject(storageKey, body, contentType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    Body: body,
    ContentType: contentType || "application/octet-stream",
  });
  return client.send(command);
}

/**
 * Delete an object from the bucket.
 */
async function deleteObject(storageKey) {
  const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey });
  return client.send(command);
}

module.exports = { isConfigured, getUploadUrl, getDownloadUrl, getViewUrl, putObject, deleteObject };
