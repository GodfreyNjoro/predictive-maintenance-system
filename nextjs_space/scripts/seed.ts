import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting seed...");

  // Create admin user
  const adminPassword = await bcrypt.hash("johndoe123", 12);
  const admin = await prisma.user.upsert({
    where: { username: "john" },
    update: { password: adminPassword, role: "admin" },
    create: {
      username: "john",
      name: "John Doe",
      password: adminPassword,
      role: "admin",
    },
  });
  console.log("Created admin user:", admin.username);

  // Create model version
  const modelVersion = await prisma.modelVersion.upsert({
    where: { version: "v1.0.0" },
    update: {},
    create: {
      version: "v1.0.0",
      modelType: "isolation_forest",
      parameters: JSON.stringify({
        numTrees: 100,
        maxSamples: 256,
        maxDepth: 8,
      }),
      metrics: JSON.stringify({
        accuracy: 0.85,
        precision: 0.82,
        recall: 0.88,
        f1Score: 0.85,
      }),
      trainingSamples: 500,
      feedbackIncluded: 0,
      isActive: true,
    },
  });
  console.log("Created model version:", modelVersion.version);

  // Create sample predictions for demonstration
  const samplePredictions = [
    {
      predictionType: "failure",
      severity: "critical",
      confidence: 0.92,
      anomalyScore: 0.87,
      affectedSystem: "mssql",
      description: "Critical database connection pool exhaustion detected. Immediate action required.",
      features: JSON.stringify([0.45, 0.32, 5, 0.8, 0.6, 0.3, 0.2, 0.4, 0.75, 0.35]),
    },
    {
      predictionType: "degradation",
      severity: "high",
      confidence: 0.78,
      anomalyScore: 0.72,
      affectedSystem: "windows_server",
      description: "Performance degradation detected in Windows Server memory management.",
      features: JSON.stringify([0.3, 0.25, 2, 0.6, 0.4, 0.2, 0.35, 0.25, 0.55, 0.2]),
    },
    {
      predictionType: "degradation",
      severity: "medium",
      confidence: 0.65,
      anomalyScore: 0.58,
      affectedSystem: "storage",
      description: "Elevated disk I/O latency detected. Monitor storage subsystem.",
      features: JSON.stringify([0.15, 0.2, 1, 0.5, 0.35, 0.4, 0.15, 0.15, 0.35, 0.12]),
    },
    {
      predictionType: "normal",
      severity: "low",
      confidence: 0.88,
      anomalyScore: 0.25,
      affectedSystem: "network",
      description: "System operating within normal parameters. No anomalies detected.",
      features: JSON.stringify([0.05, 0.08, 0, 0.4, 0.25, 0.1, 0.1, 0.05, 0.15, 0.03]),
    },
    {
      predictionType: "failure",
      severity: "high",
      confidence: 0.81,
      anomalyScore: 0.76,
      affectedSystem: "mssql",
      description: "Transaction log growth rate exceeds threshold. Potential disk space issue.",
      features: JSON.stringify([0.35, 0.28, 3, 0.7, 0.5, 0.25, 0.3, 0.35, 0.6, 0.28]),
    },
  ];

  for (const pred of samplePredictions) {
    await prisma.prediction.create({
      data: {
        ...pred,
        modelVersionId: modelVersion.id,
        predictedAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
      },
    });
  }
  console.log("Created sample predictions:", samplePredictions.length);

  // Create audit entries
  const auditEntries = [
    {
      userId: admin.id,
      action: "model_retrained",
      details: JSON.stringify({
        newVersion: "v1.0.0",
        trainingSamples: 500,
        feedbackIncluded: 0,
      }),
    },
  ];

  for (const entry of auditEntries) {
    await prisma.auditEntry.create({ data: entry });
  }
  console.log("Created audit entries:", auditEntries.length);

  // Create OrderFlow companion application (for PMS testing)
  const orderflowApp = await prisma.application.upsert({
    where: {
      organizationId_name: {
        organizationId: "default",
        name: "OrderFlow",
      },
    },
    update: {},
    create: {
      name: "OrderFlow",
      organizationId: "default",
      osType: "LINUX",
      description:
        "Order processing companion app for PMS testing. Generates real HTTP, database, job, and error telemetry. Includes a Chaos Engineering panel for triggering failure scenarios.",
      hostname: "orderflow.abacusai.app",
      environment: "testing",
      createdById: admin.id,
    },
  });
  console.log("Created/verified OrderFlow application:", orderflowApp.id);

  console.log("Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
