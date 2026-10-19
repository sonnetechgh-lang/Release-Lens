import type { AzureTokenSource } from "./client.js";

/**
 * Azure's standard credential chain: workload identity, managed identity, or a
 * service principal from AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET.
 * `@azure/identity` is loaded only when real Azure access is configured.
 */
export async function createAzureCredential(): Promise<AzureTokenSource> {
  const { DefaultAzureCredential } = await import("@azure/identity");
  return new DefaultAzureCredential();
}
