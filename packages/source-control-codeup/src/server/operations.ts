/** Central Edition routes and CLI names from the official OpenAPI schema. */
export const operations = {
  GetRepository: {
    method: "GET",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}",
    cli: "codeup-get-repository",
  },
  ListRepositories: {
    method: "GET",
    path: "/codeup/organizations/{organizationId}/repositories",
    cli: "codeup-list-repositories",
  },
  GetUserByToken: { method: "GET", path: "/platform/user", cli: "base-get-user-by-token" },
  ListChangeRequests: {
    method: "GET",
    path: "/codeup/organizations/{organizationId}/changeRequests",
    cli: "codeup-list-change-requests",
  },
  GetChangeRequest: {
    method: "GET",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests/{localId}",
    cli: "codeup-get-change-request",
  },
  ListChangeRequestPatchSets: {
    method: "GET",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests/{localId}/diffs/patches",
    cli: "codeup-list-change-request-patch-sets",
  },
  GetCompare: {
    method: "GET",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/compares",
    cli: "codeup-get-compare",
  },
  ListMergeRequestComments: {
    method: "POST",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests/{localId}/comments/list",
    cli: "codeup-list-merge-request-comments",
  },
  ListChangeRequestCICheckList: {
    method: "GET",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests/{localId}/ciCheckList",
    cli: "codeup-list-change-request-ci-check-list",
  },
  CreateChangeRequest: {
    method: "POST",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests",
    cli: "codeup-create-change-request",
  },
  CreateChangeRequestComment: {
    method: "POST",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests/{localId}/comments",
    cli: "codeup-create-change-request-comment",
  },
  ReviewChangeRequest: {
    method: "POST",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests/{localId}/review",
    cli: "codeup-review-change-request",
  },
  MergeChangeRequest: {
    method: "POST",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests/{localId}/merge",
    cli: "codeup-merge-change-request",
  },
  CloseChangeRequest: {
    method: "POST",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests/{localId}/close",
    cli: "codeup-close-change-request",
  },
  ReopenChangeRequest: {
    method: "POST",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests/{localId}/reopen",
    cli: "codeup-reopen-change-request",
  },
  UpdateChangeRequest: {
    method: "PUT",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests/{localId}",
    cli: "codeup-update-change-request",
  },
  DeleteChangeRequestComment: {
    method: "DELETE",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests/{localId}/comments/{commentBizId}",
    cli: "codeup-delete-change-request-comment",
  },
  UpdateChangeRequestComment: {
    method: "PUT",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests/{localId}/comments/{commentBizId}",
    cli: "codeup-update-change-request-comment",
  },
  UpdateChangeRequestRelatedPerson: {
    method: "POST",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/changeRequests/{localId}/person/{type}",
    cli: "codeup-update-change-request-related-person",
  },
  ListRepositoryMembers: {
    method: "GET",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/members",
    cli: "codeup-list-repository-members",
  },
  CreateRepository: {
    method: "POST",
    path: "/codeup/organizations/{organizationId}/repositories",
    cli: "codeup-create-repository",
  },
} as const;
