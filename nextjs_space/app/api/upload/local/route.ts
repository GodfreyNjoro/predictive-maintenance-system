export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { saveFile, getStorageMode } from "@/lib/storage";

/**
 * Local file upload endpoint
 * Used when storage mode is "local" instead of S3
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const mode = getStorageMode();
    if (mode !== "local") {
      return NextResponse.json(
        { error: "Local upload not enabled. Use S3 presigned URL." },
        { status: 400 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const storagePath = searchParams.get("path");

    if (!storagePath) {
      return NextResponse.json(
        { error: "Storage path is required" },
        { status: 400 }
      );
    }

    // Validate path to prevent directory traversal
    if (storagePath.includes("..") || storagePath.startsWith("/")) {
      return NextResponse.json(
        { error: "Invalid storage path" },
        { status: 400 }
      );
    }

    const body = await request.arrayBuffer();
    const buffer = Buffer.from(body);

    await saveFile(storagePath, buffer);

    return NextResponse.json({
      success: true,
      cloud_storage_path: storagePath,
    });
  } catch (error) {
    console.error("Local upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 }
    );
  }
}
