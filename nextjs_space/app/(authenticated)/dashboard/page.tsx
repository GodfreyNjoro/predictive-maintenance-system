import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { getOrganizationId } from "@/lib/datasource/scope";
import { DashboardClient } from "./_components/dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Onboarding gate: if the user has zero applications, send them to the wizard.
  const session = await getServerSession(authOptions);
  if (session?.user) {
    const organizationId = getOrganizationId(session);
    const count = await prisma.application.count({ where: { organizationId } });
    if (count === 0) {
      redirect("/applications/new?onboarding=1");
    }
  }
  return <DashboardClient />;
}