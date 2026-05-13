/**
 * Unified Storage Module
 * Automatically switches between S3 and local file storage based on configuration.
 * 
 * Usage:
 * - Set STORAGE_MODE=local in .env for local file storage
 * - Set STORAGE_MODE=s3 (or leave unset with AWS credentials) for S3 storage
 */

import * as s3Storage from "./s3";
import * as localStorage from "./local-storage";

export type StorageMode = "s3" | "local";

/**
 * Determine the active storage mode based on environment
 */
export function getStorageMode(): StorageMode {
  const mode = process.env.STORAGE_MODE?.toLowerCase();
  
  if (mode === "local") {
    return "local";
  }
  
  // Check if S3 is configured
  const hasS3Config = !!(process.env.AWS_BUCKET_NAME && process.env.AWS_REGION);
  
  if (mode === "s3" || hasS3Config) {
    return "s3";
  }
  
  // Default to local if no S3 config
  console.log("[Storage] No S3 configuration found, using local storage");
  return "local";
}

/**
 * Generate a presigned upload URL (S3) or a direct upload endpoint (local)
 */
export async function generatePresignedUploadUrl(
  fileName: string,
  contentType: string,
  isPublic: boolean = false
): Promise<{ uploadUrl: string; cloud_storage_path: string; storageMode: StorageMode }> {
  const mode = getStorageMode();
  
  if (mode === "s3") {
    const result = await s3Storage.generatePresignedUploadUrl(fileName, contentType, isPublic);
    return { ...result, storageMode: "s3" };
  }
  
  // For local storage, we return a path and the client will upload via our API
  const storagePath = localStorage.generateLocalPath(fileName, isPublic);
  return {
    uploadUrl: `/api/upload/local?path=${encodeURIComponent(storagePath)}`,
    cloud_storage_path: storagePath,
    storageMode: "local",
  };
}

/**
 * Get file content as string
 */
export async function getFileContent(storagePath: string): Promise<string> {
  const mode = getStorageMode();
  
  if (mode === "s3") {
    return s3Storage.getFileContent(storagePath);
  }
  
  return localStorage.readFileLocally(storagePath);
}

/**
 * Get file content as buffer
 */
export async function getFileBuffer(storagePath: string): Promise<Buffer> {
  const mode = getStorageMode();
  
  if (mode === "s3") {
    return s3Storage.getFileBuffer(storagePath);
  }
  
  return localStorage.readFileBufferLocally(storagePath);
}

/**
 * Get a URL for downloading/viewing the file
 */
export async function getFileUrl(
  storagePath: string,
  isPublic: boolean = false
): Promise<string> {
  const mode = getStorageMode();
  
  if (mode === "s3") {
    return s3Storage.getFileUrl(storagePath, isPublic);
  }
  
  return localStorage.getLocalFileUrl(storagePath, isPublic);
}

/**
 * Delete a file
 */
export async function deleteFile(storagePath: string): Promise<void> {
  const mode = getStorageMode();
  
  if (mode === "s3") {
    await s3Storage.deleteFile(storagePath);
    return;
  }
  
  await localStorage.deleteFileLocally(storagePath);
}

/**
 * Save file directly (for local storage uploads)
 */
export async function saveFile(
  storagePath: string,
  content: Buffer | string
): Promise<void> {
  const mode = getStorageMode();
  
  if (mode === "s3") {
    throw new Error("Direct file save not supported for S3. Use presigned URL.");
  }
  
  await localStorage.saveFileLocally(storagePath, content);
}

/**
 * Multipart upload functions (S3 only, throws for local)
 */
export async function initiateMultipartUpload(
  fileName: string,
  isPublic: boolean = false
) {
  const mode = getStorageMode();
  
  if (mode === "s3") {
    return s3Storage.initiateMultipartUpload(fileName, isPublic);
  }
  
  // For local storage, we don't need multipart - just return a path
  const storagePath = localStorage.generateLocalPath(fileName, isPublic);
  return {
    uploadId: "local-multipart-" + Date.now(),
    cloud_storage_path: storagePath,
  };
}

export async function getPresignedUrlForPart(
  storagePath: string,
  uploadId: string,
  partNumber: number
) {
  const mode = getStorageMode();
  
  if (mode === "s3") {
    return s3Storage.getPresignedUrlForPart(storagePath, uploadId, partNumber);
  }
  
  // For local storage, parts are uploaded via API
  return `/api/upload/local/part?path=${encodeURIComponent(storagePath)}&part=${partNumber}`;
}

export async function completeMultipartUpload(
  storagePath: string,
  uploadId: string,
  parts: { ETag: string; PartNumber: number }[]
) {
  const mode = getStorageMode();
  
  if (mode === "s3") {
    return s3Storage.completeMultipartUpload(storagePath, uploadId, parts);
  }
  
  // For local storage, parts are already written - just return success
  return { Location: storagePath };
}
