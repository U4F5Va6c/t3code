# Work Items

Open **Work Items** from the sidebar or command palette. Select an environment, organization, account, and ProjeX project. Work items are independent of code repositories. The environment uses its existing Yunxiao credentials; an organization can be entered explicitly when using its CLI login.

Choose requirements, bugs, or tasks, then use the project's actual type, owner, and status choices. Creating and editing require **Change work items** permission. Required fields come from ProjeX; unsupported required fields must be edited there. Rich text descriptions remain editable in ProjeX so they are not silently converted.

**Assign to me** changes the owner. Claiming work is a separate, explicit state change. Select the state your project uses for claimed work; ProjeX enforces allowed transitions.

Relationships distinguish parents/children and dependencies/supporting items. `DEPEND_ON` means the selected work item waits for the target. Relations can be removed without deleting either work item. Readiness checks read every prerequisite and compare it with the completion states you explicitly select; unreadable prerequisites cannot be treated as complete.

If creation is uncertain, keep the original request ID and use **Check creation receipt**. Do not create another request. A known candidate item ID can be verified to recover an uncertain creation. Requests are retained across page reloads and browser restarts in the same browser; the environment retains their receipts across restarts.

Updates reject stale versions and change only the fields you edited. ProjeX does not offer an atomic version guard: concurrent changes outside T3 can still race an update. Refresh after a conflict or an unconfirmed result.

Agent access starts disabled. In environment or project settings, turn on **Agent work item access** to let provider agents use the native tools, then start a new agent session. Project settings can override the environment default. Turning it off blocks further calls from existing agent credentials. Full-access/default mode and the current platform account are still required for changes.
