import type { WorkflowNotification } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { WorkflowNotificationBell } from "./WorkflowNotificationBell";

it("opens the selected notification with its workflow and chat intact", async () => {
  const item: WorkflowNotification = {
    id: "n2",
    workflowId: "weekly",
    kind: "output",
    title: "Weekly report",
    text: "Ready",
    at: "2026-01-02T12:00:00Z",
    chat: { agentId: "writer", taskId: "report-thread" },
  };
  const older = { ...item, id: "n1", text: "Yesterday", at: "2026-01-01T12:00:00Z", chat: null };
  const onOpen = vi.fn();
  render(() => (
    <WorkflowNotificationBell
      host={{ workflows: { notifications: async () => [item, older] }, onChanged: () => () => {} }}
      onOpen={onOpen}
    />
  ));
  fireEvent.click(await screen.findByRole("button", { name: "Workflow notifications" }));
  const list = await screen.findByRole("list");
  const rows = await within(list).findAllByRole("button");
  expect(rows[0]).toHaveTextContent("Ready");
  expect(rows[1]).toHaveTextContent("Yesterday");
  fireEvent.click(rows[0]);
  expect(onOpen).toHaveBeenCalledWith(item);
});
