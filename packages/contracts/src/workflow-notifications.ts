import { isDynamicRecord } from "./runtime-values";

export interface WorkflowNotification {
  id: string;
  workflowId: string;
  title: string;
  text: string;
  at: string;
  kind: "approval" | "output";
  chat: { agentId: string; taskId: string | null } | null;
}

export const WORKFLOW_NOTICE_LIMIT = 50;
export const WORKFLOW_NOTICE_TEXT_LIMIT = 240;

export function isWorkflowNotification(value: unknown): value is WorkflowNotification {
  if (!isDynamicRecord(value)) return false;
  const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256;
  return (
    id(value.id) &&
    id(value.workflowId) &&
    typeof value.title === "string" &&
    value.title.length <= 240 &&
    typeof value.text === "string" &&
    value.text.length <= WORKFLOW_NOTICE_TEXT_LIMIT &&
    typeof value.at === "string" &&
    value.at.length <= 40 &&
    Number.isFinite(Date.parse(value.at)) &&
    (value.kind === "approval" || value.kind === "output") &&
    (value.chat === null ||
      (isDynamicRecord(value.chat) && id(value.chat.agentId) && (value.chat.taskId === null || id(value.chat.taskId))))
  );
}

export function isWorkflowNotificationList(value: unknown): value is WorkflowNotification[] {
  return Array.isArray(value) && value.length <= WORKFLOW_NOTICE_LIMIT && value.every(isWorkflowNotification);
}
