import { isWorkflowNotification, WORKFLOW_NOTICE_LIMIT } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Semaphore } from "effect";
import type { StoredWorkflowNotification } from "../backend/workflows/workflows";
import { PreferenceStore } from "./preference-file";

function storedEntry(value: unknown): value is StoredWorkflowNotification {
  return (
    isDynamicRecord(value) &&
    isWorkflowNotification(value.notice) &&
    Array.isArray(value.agentIds) &&
    value.agentIds.every((id) => typeof id === "string")
  );
}

export function workflowNotificationStore(path: string) {
  const file = new PreferenceStore<{ entries: StoredWorkflowNotification[] }>({
    path,
    defaultValue: { entries: [] },
    decode: (value) =>
      isDynamicRecord(value) &&
      value.version === 1 &&
      Array.isArray(value.entries) &&
      value.entries.length <= WORKFLOW_NOTICE_LIMIT &&
      value.entries.every(storedEntry)
        ? { entries: value.entries }
        : null,
  });
  const lock = Semaphore.makeUnsafe(1);
  return {
    load: () => file.load(),
    list: () => file.get().entries,
    add: (entry: StoredWorkflowNotification) =>
      lock.withPermit(
        Effect.suspend(() => {
          const entries = [entry, ...file.get().entries.filter((item) => item.notice.id !== entry.notice.id)];
          entries.sort((a, b) => b.notice.at.localeCompare(a.notice.at));
          return file.set({ entries: entries.slice(0, WORKFLOW_NOTICE_LIMIT) }).pipe(Effect.asVoid);
        }),
      ),
  };
}
