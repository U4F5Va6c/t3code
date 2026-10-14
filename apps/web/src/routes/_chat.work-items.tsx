import { createFileRoute } from "@tanstack/react-router";
import { WorkItemsPage } from "~/components/workItems/WorkItemsPage";
export const Route = createFileRoute("/_chat/work-items")({ component: WorkItemsPage });
