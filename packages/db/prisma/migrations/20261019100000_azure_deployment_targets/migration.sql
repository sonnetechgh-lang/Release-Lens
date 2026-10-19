-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "trafficWeight" INTEGER;

-- CreateTable
CREATE TABLE "DeploymentTarget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL DEFAULT 'azure-container-apps',
    "subscriptionId" TEXT NOT NULL,
    "resourceGroup" TEXT NOT NULL,
    "resourceName" TEXT NOT NULL,
    "containerName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeploymentTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeploymentTarget_projectId_idx" ON "DeploymentTarget"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentTarget_serviceId_environmentId_key" ON "DeploymentTarget"("serviceId", "environmentId");

-- AddForeignKey
ALTER TABLE "DeploymentTarget" ADD CONSTRAINT "DeploymentTarget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentTarget" ADD CONSTRAINT "DeploymentTarget_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentTarget" ADD CONSTRAINT "DeploymentTarget_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Traffic share is a percentage.
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_trafficWeight_check" CHECK ("trafficWeight" BETWEEN 0 AND 100);
