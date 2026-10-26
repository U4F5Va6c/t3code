import {
  makeProviderSettingsSchema,
  secretSetting,
  SourceControlProviderKind,
  TrimmedString,
} from "@t3tools/contracts";
import {
  defineSourceControl,
  isChangeRequestInProjectRepository,
  isChangeRequestOnProjectHost,
  projectChangeRequestHost,
} from "@t3tools/source-control-core/shared/definition";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CODEUP_HOST,
  codeupRepositoryUrl,
  parseCodeupRepository,
  parseCodeupChangeRequest,
} from "./repository.ts";

const KIND = SourceControlProviderKind.make("codeup");

export const settings = makeProviderSettingsSchema({
  // This slot is only for Central Edition. A future deployment must not reuse these tokens.
  organizationTokens: Schema.Record(Schema.String, TrimmedString).pipe(
    secretSetting,
    Schema.withDecodingDefault(Effect.succeed({})),
    Schema.annotateKey({
      title: "Organization tokens",
      description:
        "Optional override. Uses the local aliyun-devops login or ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN and ORGANIZATION_ID automatically. Add an organization token if this environment has no existing login. Git credentials are separate.",
      providerSettingsForm: { control: "secret-map", placeholder: "Organization ID" },
    }),
  ),
});

export const definition = defineSourceControl({
  kind: KIND,
  label: "Codeup",
  pickerLabel: "Codeup",
  icon: null,
  changeRequest: {
    shortLabel: "MR",
    shortLabelWithArticle: "an MR",
    singular: "merge request",
    plural: "merge requests",
  },
  repositoryPathHint: "organization-id/group/repository",
  repositoryLabel: (repository) => {
    const parsed = parseCodeupRepository(repository);
    return parsed ? parsed.repository.slice(parsed.organizationId.length + 1) : repository;
  },
  actorLabel: (actor) => actor.name?.trim() || actor.login,
  publicHost: CODEUP_HOST,
  publishDescription: "Codeup Central Edition",
  publishHost: () => CODEUP_HOST,
  newRepositoryOwner: () => null,
  defaultCloneTransport: "ssh",
  changeRequestUrl: ({ host, repository, number }) => {
    const target = parseCodeupRepository(repository);
    return host === CODEUP_HOST && target && Number.isSafeInteger(number) && number > 0
      ? `${codeupRepositoryUrl(target.repository)}/change/${number}`
      : null;
  },
  changeRequestActions: new Set(["close", "reopen", "merge"] as const),
  checkoutCommand: () => null,
  authorProfileUrl: () => null,
  changeRequestUrlFromReferenceAutolink: () => null,
  reviewSummaryRequired: () => false,
  checkoutCommandArgument: () => null,
  isChangeRequestReference: (value) => parseCodeupChangeRequest(value) !== null,
  parseChangeRequestUrl: (url) => {
    const parsed = parseCodeupChangeRequest(url.href);
    return parsed
      ? {
          host: CODEUP_HOST,
          repository: parsed.repository.toLowerCase(),
          number: parsed.number,
          repositoryUrl: codeupRepositoryUrl(parsed.repository),
        }
      : null;
  },
  recognizeRemote: ({ host }) =>
    host === CODEUP_HOST
      ? {
          kind: KIND,
          name: "Codeup",
          baseUrl: `https://${CODEUP_HOST}`,
        }
      : null,
  checkoutChangeRequestHost: () => null,
  isChangeRequestInRepository: (identity, link) =>
    isChangeRequestInProjectRepository(projectChangeRequestHost(identity, KIND), identity, link),
  canReadChangeRequestOnHost: (identity, link) =>
    isChangeRequestOnProjectHost(projectChangeRequestHost(identity, KIND), identity, link),
  settings,
});
