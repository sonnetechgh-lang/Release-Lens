import type { DeploymentEvidence } from "@releaselens/contracts";
import { z } from "zod";
import { ProviderError } from "./errors.js";

/** Lowercase letters, digits and hyphens; starts with a letter, ends with a letter or digit, no "--". */
const CONTAINER_APP_NAME = /^(?!.*--)[a-z][a-z0-9-]{0,30}[a-z0-9]$/;

/**
 * Identifies one Azure Container App. Every part is validated before it is put
 * into a request path, so a stored target can never point a request elsewhere.
 */
export const ContainerAppRefSchema = z
  .object({
    subscriptionId: z
      .string()
      .regex(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
        "Expected a subscription ID (GUID)",
      )
      .transform((id) => id.toLowerCase()),
    resourceGroup: z
      .string()
      .regex(/^[\w.()-]{1,90}$/, "Use letters, digits, and . _ - ( ) (up to 90 characters)")
      .refine((name) => !name.endsWith("."), "Must not end with a period"),
    name: z
      .string()
      .regex(CONTAINER_APP_NAME, "Use 2–32 lowercase letters, digits and single hyphens"),
    /** Container whose image identifies the release, when the app runs several. */
    containerName: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "Use lowercase letters, digits and hyphens")
      .optional(),
  })
  .strict();
export type ContainerAppRef = z.output<typeof ContainerAppRefSchema>;

/** One revision of a deployment target, as the provider reported it. */
export interface RevisionObservation {
  revisionName: string;
  /** Image as configured on the revision, e.g. `registry/app:tag` or `registry/app@sha256:...`. */
  imageReference: string;
  /** Only set when the image is pinned by digest. A tag is never resolved to a digest here. */
  imageDigest: string | null;
  /** When the revision was created. The provider does not report when it started serving. */
  activeSince: Date;
  providerStatus: DeploymentEvidence["providerStatus"];
  /** Share of traffic, 0–100, or null when the provider does not say. */
  trafficWeight: number | null;
  /** True for the one revision that serves most traffic, if any revision serves traffic. */
  isServing: boolean;
  /** Link to the resource in the provider's console. */
  url: string | null;
}

/** A place where services run. Read-only: implementations must never change anything. */
export interface DeploymentTargetProvider {
  readonly provider: "azure-container-apps";
  /** All revisions the provider still knows about. Throws ProviderError on failure. */
  listRevisions(target: ContainerAppRef): Promise<RevisionObservation[]>;
}

export const targetKey = (t: Pick<ContainerAppRef, "subscriptionId" | "resourceGroup" | "name">) =>
  `${t.subscriptionId}/${t.resourceGroup.toLowerCase()}/${t.name}`;

/**
 * In-memory deployment target for tests and local development. Each app returns
 * the revisions or the error it was given; unknown apps are "not found", like Azure.
 */
export class FakeDeploymentTarget implements DeploymentTargetProvider {
  readonly provider = "azure-container-apps" as const;
  readonly calls: ContainerAppRef[] = [];
  readonly #apps = new Map<string, RevisionObservation[] | ProviderError>();

  set(target: ContainerAppRef, result: RevisionObservation[] | ProviderError): this {
    this.#apps.set(targetKey(target), result);
    return this;
  }

  listRevisions(target: ContainerAppRef): Promise<RevisionObservation[]> {
    this.calls.push(target);
    const result = this.#apps.get(targetKey(target));
    if (result === undefined) {
      return Promise.reject(new ProviderError("not-found", "Container app not found", 404));
    }
    if (result instanceof ProviderError) return Promise.reject(result);
    return Promise.resolve(structuredClone(result));
  }
}
