export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { getFileContent, getFileBuffer } from "@/lib/storage";
import { parseLogFile } from "@/lib/log-parser";
import { extractFeatures, featureVectorToArray } from "@/lib/feature-extractor";
import { makePrediction } from "@/lib/ml-model";
import { decompressFile, isCompressedFile, DecompressedFile } from "@/lib/decompress";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const body = await request.json();
    const {
      cloud_storage_path,
      isPublic = false,
      fileName,
      fileType,
      logSource,
      fileSize,
      applicationId,
    } = body ?? {};

    if (!cloud_storage_path || !fileName || !fileType || !logSource) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate applicationId (optional) — must belong to the same org as the user.
    let resolvedApplicationId: string | null = null;
    if (applicationId) {
      const app = await prisma.application.findFirst({
        where: { id: applicationId },
        select: { id: true },
      });
      if (!app) {
        return NextResponse.json(
          { error: "Application not found" },
          { status: 404 }
        );
      }
      resolvedApplicationId = app.id;
    }

    // Create log file record
    const logFile = await prisma.logFile.create({
      data: {
        fileName,
        fileType,
        logSource,
        fileSize: fileSize ?? 0,
        cloudStoragePath: cloud_storage_path,
        isPublic,
        status: "processing",
        uploadedBy: userId,
        applicationId: resolvedApplicationId,
      },
    });

    // Create audit entry
    await prisma.auditEntry.create({
      data: {
        userId,
        action: "file_uploaded",
        details: JSON.stringify({
          fileName,
          fileType,
          logSource,
          fileSize,
        }),
      },
    });

    // Process file in background
    processLogFile(logFile.id, cloud_storage_path, fileType, logSource, userId, fileName).catch(
      console.error
    );

    return NextResponse.json({
      id: logFile.id,
      status: "processing",
      message: "File uploaded and processing started",
    });
  } catch (error) {
    console.error("Upload complete error:", error);
    return NextResponse.json(
      { error: "Failed to complete upload" },
      { status: 500 }
    );
  }
}

async function processLogFile(
  logFileId: string,
  cloudStoragePath: string,
  fileType: string,
  logSource: string,
  userId: string,
  fileName: string
) {
  try {
    let contents: { fileName: string; content: string; fileType: string }[] = [];
    
    // Check if file is compressed
    if (isCompressedFile(fileName)) {
      console.log(`Processing compressed file: ${fileName}`);
      const buffer = await getFileBuffer(cloudStoragePath);
      const result = decompressFile(buffer, fileName);
      console.log(`Decompressed ${result.files.length} files from ${result.format} archive`);
      
      contents = result.files.map((f: DecompressedFile) => {
        // Infer file type from decompressed file name
        const ext = f.fileName.toLowerCase().slice(f.fileName.lastIndexOf("."));
        let inferredType = "txt";
        if (ext === ".csv") inferredType = "csv";
        else if (ext === ".json" || ext === ".ndjson" || ext === ".jsonl") inferredType = "json";
        
        return {
          fileName: f.fileName,
          content: f.content,
          fileType: inferredType,
        };
      });
    } else {
      // Fetch regular file content from S3
      const content = await getFileContent(cloudStoragePath);
      contents = [{ fileName, content, fileType }];
    }
    
    // Parse all logs from all files
    let allParsedLogs: ReturnType<typeof parseLogFile> = [];
    for (const file of contents) {
      const parsedLogs = parseLogFile(file.content, file.fileType, logSource);
      allParsedLogs = allParsedLogs.concat(parsedLogs);
    }
    
    const parsedLogs = allParsedLogs;

    // Store parsed logs
    if (parsedLogs.length > 0) {
      await prisma.parsedLog.createMany({
        data: parsedLogs.map((log) => ({
          logFileId,
          timestamp: log.timestamp,
          logLevel: log.logLevel,
          source: log.source,
          eventId: log.eventId,
          message: log.message,
          rawData: log.rawData,
          features: log.features ? JSON.stringify(log.features) : null,
        })),
      });
    }

    // Extract features and make prediction
    const features = extractFeatures(parsedLogs);
    const prediction = makePrediction(features);

    // Get or create model version
    let modelVersion = await prisma.modelVersion.findFirst({
      where: { isActive: true },
    });

    if (!modelVersion) {
      modelVersion = await prisma.modelVersion.create({
        data: {
          version: "v1.0.0",
          modelType: "isolation_forest",
          parameters: JSON.stringify({ numTrees: 100, maxSamples: 256 }),
          isActive: true,
          trainingSamples: 500,
        },
      });
    }

    // Store prediction
    const predictionRecord = await prisma.prediction.create({
      data: {
        logFileId,
        modelVersionId: modelVersion.id,
        predictionType: prediction.predictionType,
        severity: prediction.severity,
        confidence: prediction.confidence,
        anomalyScore: prediction.anomalyScore,
        affectedSystem: prediction.affectedSystem,
        description: prediction.description,
        features: JSON.stringify(featureVectorToArray(features)),
      },
    });

    // Audit the prediction
    await prisma.auditEntry.create({
      data: {
        userId,
        predictionId: predictionRecord.id,
        action: "prediction_made",
        details: JSON.stringify({
          logFileId,
          predictionType: prediction.predictionType,
          severity: prediction.severity,
          confidence: prediction.confidence,
        }),
      },
    });

    // Update log file status
    await prisma.logFile.update({
      where: { id: logFileId },
      data: {
        status: "processed",
        recordCount: parsedLogs.length,
      },
    });
  } catch (error) {
    console.error("Process log file error:", error);
    await prisma.logFile.update({
      where: { id: logFileId },
      data: {
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}