export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getStorageMode } from "@/lib/storage";
import { readFileBufferLocally, fileExistsLocally } from "@/lib/local-storage";
import path from "path";

/**
 * Serve files from local storage
 * This endpoint is used when storage mode is "local"
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const mode = getStorageMode();
    if (mode !== "local") {
      return NextResponse.json(
        { error: "Local file serving not enabled" },
        { status: 400 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const storagePath = searchParams.get("path");

    if (!storagePath) {
      return NextResponse.json(
        { error: "File path is required" },
        { status: 400 }
      );
    }

    // Validate path to prevent directory traversal
    if (storagePath.includes("..") || storagePath.startsWith("/")) {
      return NextResponse.json(
        { error: "Invalid file path" },
        { status: 400 }
      );
    }

    if (!fileExistsLocally(storagePath)) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    const buffer = await readFileBufferLocally(storagePath);
    const fileName = path.basename(storagePath);

    // Determine content type
    const ext = path.extname(fileName).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".json": "application/json",
      ".csv": "text/csv",
      ".txt": "text/plain",
      ".log": "text/plain",
      ".gz": "application/gzip",
      ".zip": "application/zip",
      ".tar": "application/x-tar",
    };
    const contentType = contentTypes[ext] || "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("File serve error:", error);
    return NextResponse.json(
      { error: "Failed to serve file" },
      { status: 500 }
    );
  }
}
