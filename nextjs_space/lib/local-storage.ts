import fs from "fs";
import path from "path";
import crypto from "crypto";

// Local storage directory (inside project for development)
const LOCAL_UPLOADS_DIR = process.env.LOCAL_UPLOADS_DIR || path.join(process.cwd(), "uploads");
const PUBLIC_UPLOADS_DIR = path.join(LOCAL_UPLOADS_DIR, "public");

/**
 * Ensure upload directories exist
 */
function ensureDirectories() {
  if (!fs.existsSync(LOCAL_UPLOADS_DIR)) {
    fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(PUBLIC_UPLOADS_DIR)) {
    fs.mkdirSync(PUBLIC_UPLOADS_DIR, { recursive: true });
  }
}

/**
 * Generate a unique file path for local storage
 */
export function generateLocalPath(fileName: string, isPublic: boolean = false): string {
  ensureDirectories();
  const timestamp = Date.now();
  const randomId = crypto.randomBytes(8).toString("hex");
  const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  
  if (isPublic) {
    return `public/${timestamp}-${randomId}-${safeName}`;
  }
  return `${timestamp}-${randomId}-${safeName}`;
}

/**
 * Get the full file system path from a storage path
 */
export function getFullPath(storagePath: string): string {
  return path.join(LOCAL_UPLOADS_DIR, storagePath);
}

/**
 * Save file content to local storage
 */
export async function saveFileLocally(
  storagePath: string,
  content: Buffer | string
): Promise<void> {
  ensureDirectories();
  const fullPath = getFullPath(storagePath);
  const dir = path.dirname(fullPath);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  await fs.promises.writeFile(fullPath, content);
}

/**
 * Read file content from local storage as string
 */
export async function readFileLocally(storagePath: string): Promise<string> {
  const fullPath = getFullPath(storagePath);
  return fs.promises.readFile(fullPath, "utf-8");
}

/**
 * Read file content from local storage as buffer
 */
export async function readFileBufferLocally(storagePath: string): Promise<Buffer> {
  const fullPath = getFullPath(storagePath);
  return fs.promises.readFile(fullPath);
}

/**
 * Delete file from local storage
 */
export async function deleteFileLocally(storagePath: string): Promise<void> {
  const fullPath = getFullPath(storagePath);
  if (fs.existsSync(fullPath)) {
    await fs.promises.unlink(fullPath);
  }
}

/**
 * Get a URL for serving local files (for development)
 * In production with local storage, files are served via API route
 */
export function getLocalFileUrl(storagePath: string, isPublic: boolean = false): string {
  // For public files in /uploads/public, they can be served directly if in public folder
  // Otherwise serve via API
  return `/api/files/serve?path=${encodeURIComponent(storagePath)}`;
}

/**
 * Check if a file exists locally
 */
export function fileExistsLocally(storagePath: string): boolean {
  const fullPath = getFullPath(storagePath);
  return fs.existsSync(fullPath);
}
