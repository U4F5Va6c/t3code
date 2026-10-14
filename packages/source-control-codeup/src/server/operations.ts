/** Central Edition routes and CLI names from the official OpenAPI schema. */
export const operations = {
  ProjexProjects: {
    method: "POST",
    path: "/projex/organizations/{organizationId}/projects:search",
    cli: "projex-search-projects",
  },
  ProjexSearch: {
    method: "POST",
    path: "/projex/organizations/{organizationId}/workitems:search",
    cli: "projex-search-workitems",
  },
  ProjexGet: {
    method: "GET",
    path: "/projex/organizations/{organizationId}/workitems/{id}",
    cli: "projex-get-workitem",
  },
  ProjexCreate: {
    method: "POST",
    path: "/projex/organizations/{organizationId}/workitems",
    cli: "projex-create-workitem",
  },
  ProjexUpdate: {
    method: "PUT",
    path: "/projex/organizations/{organizationId}/workitems/{id}",
    cli: "projex-update-workitem",
  },
  ProjexTypes: {
    method: "GET",
    path: "/projex/organizations/{organizationId}/projects/{id}/workitemTypes",
    cli: "projex-list-workitem-types",
  },
  ProjexFields: {
    method: "GET",
    path: "/projex/organizations/{organizationId}/projects/{projectId}/workitemTypes/{id}/fields",
    cli: "projex-get-workitem-type-field-config",
  },
  ProjexMembers: {
    method: "GET",
    path: "/projex/organizations/{organizationId}/projects/{id}/members",
    cli: "projex-list-project-members",
  },
  ProjexWorkflow: {
    method: "GET",
    path: "/projex/organizations/{organizationId}/projects/{projectId}/workitemTypes/{id}/workflows",
    cli: "projex-get-workitem-workflow",
  },
  ProjexItemWorkflow: {
    method: "GET",
    path: "/projex/organizations/{organizationId}/workitems/{id}/workflow",
    cli: "projex-get-workitem-workflow-info",
  },
  ProjexRelationTypes: {
    method: "GET",
    path: "/projex/organizations/{organizationId}/workitemTypes/{id}/relationWorkitemTypes",
    cli: "projex-list-workitem-relation-workitem-types",
  },
  ProjexRelations: {
    method: "GET",
    path: "/projex/organizations/{organizationId}/workitems/{id}/relationRecords",
    cli: "projex-list-workitem-relation-records",
  },
  ProjexAddRelation: {
    method: "POST",
    path: "/projex/organizations/{organizationId}/workitems/{id}/relationRecords",
    cli: "projex-create-workitem-relation-record",
  },
  ProjexRemoveRelation: {
    method: "DELETE",
    path: "/projex/organizations/{organizationId}/workitems/{id}/relationRecords",
    cli: "projex-delete-workitem-relation-record",
  },

  ListBranches: {
    method: "GET",
    path: "/codeup/organizations/{organizationId}/repositories/{repositoryId}/branches",
    cli: "codeup-list-branches",
  },
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
