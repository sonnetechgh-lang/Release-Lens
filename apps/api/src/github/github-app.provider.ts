import type { Provider } from "@nestjs/common";
import { GithubAppClient } from "@releaselens/integrations";
import { APP_CONFIG, type AppConfig } from "../config/config.js";

/** The GitHub App client, or null when no app is configured. */
export type GithubAppApi = Pick<
  GithubAppClient,
  "listInstallations" | "getInstallation" | "listInstallationRepositories"
>;

export const GITHUB_APP = Symbol("GITHUB_APP");

export const githubAppProvider: Provider = {
  provide: GITHUB_APP,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): GithubAppApi | null =>
    config.githubApp === null
      ? null
      : new GithubAppClient({
          appId: config.githubApp.appId,
          privateKey: config.githubApp.privateKey,
        }),
};
