import {
  adminRoute,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const WORKFLOW_NOTIFICATIONS_CAPABILITY = "workflow-notifications-v1";
export const WORKFLOW_NOTIFICATIONS_ROUTE = "/v1/workflows/notifications";
export const WORKFLOW_NOTIFICATIONS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    WORKFLOW_NOTIFICATIONS_ROUTE,
    adminRoute(
      empty,
      fields({
        notices: list(
          fields({
            id: identifier,
            workflowId: identifier,
            title: string(240),
            text: string(240),
            at: string(40),
            kind: oneOf("approval", "output"),
            chat: nullable(fields({ agentId: identifier, taskId: nullable(identifier) })),
          }),
          50,
        ),
      }),
    ),
  ],
]);
