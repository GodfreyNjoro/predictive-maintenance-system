import { gunzipSync, inflateSync } from "zlib";
import AdmZip from "adm-zip";

export interface DecompressedFile {
  fileName: string;
  content: string;
  originalSize: number;
  compressedSize: number;
}

export interface DecompressResult {
  files: DecompressedFile[];
  format: string;
  totalOriginalSize: number;
  totalCompressedSize: number;
}

/**
 * Detect compression format from file extension or magic bytes
 */
export function detectCompressionFormat(fileName: string, buffer?: Buffer): string | null {
  const ext = fileName.toLowerCase();
  
  if (ext.endsWith(".gz") || ext.endsWith(".gzip")) return "gzip";
  if (ext.endsWith(".zip")) return "zip";
  if (ext.endsWith(".tar.gz") || ext.endsWith(".tgz")) return "tar.gz";
  if (ext.endsWith(".tar")) return "tar";
  if (ext.endsWith(".zst") || ext.endsWith(".zstd")) return "zstd";
  if (ext.endsWith(".bz2")) return "bzip2";
  if (ext.endsWith(".xz")) return "xz";
  if (ext.endsWith(".7z")) return "7z";
  if (ext.endsWith(".rar")) return "rar";
  
  // Check magic bytes if buffer provided
  if (buffer && buffer.length >= 4) {
    // Gzip: 1f 8b
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) return "gzip";
    // ZIP: 50 4b 03 04
    if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return "zip";
  }
  
  return null;
}

/**
 * Check if a file is a log file by extension
 */
function isLogFile(fileName: string): boolean {
  const ext = fileName.toLowerCase();
  const logExtensions = [".log", ".txt", ".csv", ".json", ".ndjson", ".jsonl"];
  return logExtensions.some(e => ext.endsWith(e)) || 
         !ext.includes(".") || // No extension might be a log
         ext.endsWith(".syslog");
}

/**
 * Remove compression extension from filename
 */
export function getUncompressedFileName(fileName: string): string {
  let name = fileName;
  if (name.endsWith(".gz") || name.endsWith(".gzip")) {
    name = name.replace(/\.(gz|gzip)$/i, "");
  }
  if (name.endsWith(".tar")) {
    name = name.replace(/\.tar$/i, "");
  }
  return name;
}

/**
 * Decompress gzip content
 */
function decompressGzip(buffer: Buffer, fileName: string): DecompressedFile[] {
  try {
    const decompressed = gunzipSync(buffer);
    const content = decompressed.toString("utf-8");
    const uncompressedName = getUncompressedFileName(fileName);
    
    return [{
      fileName: uncompressedName,
      content,
      originalSize: decompressed.length,
      compressedSize: buffer.length,
    }];
  } catch (error) {
    throw new Error(`Failed to decompress gzip file: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Decompress ZIP archive
 */
function decompressZip(buffer: Buffer): DecompressedFile[] {
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const files: DecompressedFile[] = [];
    
    for (const entry of entries) {
      // Skip directories and non-log files
      if (entry.isDirectory) continue;
      
      const fileName = entry.entryName.split("/").pop() || entry.entryName;
      
      // Only process log-like files
      if (!isLogFile(fileName)) continue;
      
      try {
        const content = entry.getData().toString("utf-8");
        files.push({
          fileName,
          content,
          originalSize: entry.header.size,
          compressedSize: entry.header.compressedSize,
        });
      } catch {
        // Skip files that can't be read as text
        continue;
      }
    }
    
    if (files.length === 0) {
      throw new Error("No log files found in ZIP archive");
    }
    
    return files;
  } catch (error) {
    if (error instanceof Error && error.message.includes("No log files")) {
      throw error;
    }
    throw new Error(`Failed to decompress ZIP file: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Simple TAR parser for .tar files (handles basic TAR format)
 */
function decompressTar(buffer: Buffer): DecompressedFile[] {
  const files: DecompressedFile[] = [];
  let offset = 0;
  
  while (offset < buffer.length - 512) {
    // TAR header is 512 bytes
    const header = buffer.subarray(offset, offset + 512);
    
    // Check for end of archive (empty blocks)
    if (header.every(b => b === 0)) break;
    
    // Extract file name (first 100 bytes)
    const nameEnd = header.indexOf(0);
    const fileName = header.subarray(0, nameEnd > 0 && nameEnd < 100 ? nameEnd : 100).toString("ascii").replace(/\0/g, "");
    
    if (!fileName) break;
    
    // File size is at offset 124, 12 bytes, octal
    const sizeStr = header.subarray(124, 136).toString("ascii").replace(/\0/g, "").trim();
    const fileSize = parseInt(sizeStr, 8) || 0;
    
    // Type flag at offset 156
    const typeFlag = header[156];
    const isFile = typeFlag === 0 || typeFlag === 48; // Regular file
    
    if (isFile && fileSize > 0 && isLogFile(fileName)) {
      const contentStart = offset + 512;
      const content = buffer.subarray(contentStart, contentStart + fileSize).toString("utf-8");
      
      const baseName = fileName.split("/").pop() || fileName;
      files.push({
        fileName: baseName,
        content,
        originalSize: fileSize,
        compressedSize: fileSize,
      });
    }
    
    // Move to next header (file content + padding to 512 bytes)
    const blocks = Math.ceil(fileSize / 512);
    offset += 512 + (blocks * 512);
  }
  
  if (files.length === 0) {
    throw new Error("No log files found in TAR archive");
  }
  
  return files;
}

/**
 * Decompress tar.gz file
 */
function decompressTarGz(buffer: Buffer): DecompressedFile[] {
  try {
    const tarBuffer = gunzipSync(buffer);
    return decompressTar(tarBuffer);
  } catch (error) {
    throw new Error(`Failed to decompress tar.gz file: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Main decompression function
 */
export function decompressFile(buffer: Buffer, fileName: string): DecompressResult {
  const format = detectCompressionFormat(fileName, buffer);
  
  if (!format) {
    // Not compressed, return as-is
    return {
      files: [{
        fileName,
        content: buffer.toString("utf-8"),
        originalSize: buffer.length,
        compressedSize: buffer.length,
      }],
      format: "none",
      totalOriginalSize: buffer.length,
      totalCompressedSize: buffer.length,
    };
  }
  
  let files: DecompressedFile[];
  
  switch (format) {
    case "gzip":
      files = decompressGzip(buffer, fileName);
      break;
    case "zip":
      files = decompressZip(buffer);
      break;
    case "tar.gz":
      files = decompressTarGz(buffer);
      break;
    case "tar":
      files = decompressTar(buffer);
      break;
    case "zstd":
    case "bzip2":
    case "xz":
    case "7z":
    case "rar":
      throw new Error(`${format.toUpperCase()} format is not yet supported. Please use gzip, zip, or tar.gz.`);
    default:
      throw new Error(`Unknown compression format: ${format}`);
  }
  
  const totalOriginalSize = files.reduce((sum, f) => sum + f.originalSize, 0);
  const totalCompressedSize = files.reduce((sum, f) => sum + f.compressedSize, 0);
  
  return {
    files,
    format,
    totalOriginalSize,
    totalCompressedSize,
  };
}

/**
 * Check if file is compressed
 */
export function isCompressedFile(fileName: string): boolean {
  return detectCompressionFormat(fileName) !== null;
}

/**
 * Get supported compression formats
 */
export function getSupportedFormats(): string[] {
  return ["gzip (.gz)", "zip (.zip)", "tar.gz (.tar.gz, .tgz)", "tar (.tar)"];
}
