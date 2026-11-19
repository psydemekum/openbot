import type { WorkflowNotification } from "@openbot/contracts/ipc";
import { Bell, Button, Popover } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, onSettled, Show } from "solid-js";
import type { WorkflowHost } from "./workflows-port";
import "./workflow-notification-bell.css";

export function WorkflowNotificationBell(props: {
  host: Pick<WorkflowHost, "onChanged"> & { workflows: Pick<WorkflowHost["workflows"], "notifications"> };
  onOpen: (item: WorkflowNotification) => void;
}) {
  const { t, format, errorMessage } = useText();
  const [entries, setEntries] = createSignal<WorkflowNotification[]>([]);
  const [error, setError] = createSignal("");
  const [loaded, setLoaded] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  const [seen, setSeen] = createSignal<string>();
  let generation = 0;

  async function refresh() {
    const request = ++generation;
    try {
      const result = await props.host.workflows.notifications();
      if (generation !== request) return;
      setError("");
      setEntries(result);
      setLoaded(true);
      if (open()) setSeen(result[0]?.id);
    } catch (cause) {
      if (generation !== request) return;
      setEntries([]);
      setError(errorMessage(cause, t("workflow.page.failed")));
    }
  }

  onSettled(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = props.host.onChanged((id) => {
      if (id === null) {
        ++generation;
        setEntries([]);
      }
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void refresh();
      }, 150);
    });
    return () => {
      ++generation;
      clearTimeout(timer);
      stop();
    };
  });
  const title = () => t("workflow.inbox.title");
  return (
    <Popover.Root
      open={open()}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setSeen(entries()[0]?.id);
          void refresh();
        }
      }}
      placement="bottom-start"
      gutter={6}
    >
      <Popover.Trigger class="sidebar-icon-button no-drag workflow-bell" aria-label={title()} title={title()}>
        <Bell aria-hidden="true" />
        <Show when={entries()[0] && entries()[0]?.id !== seen()}>
          <span class="workflow-bell-dot" />
        </Show>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="ui-popover-menu-surface workflow-notification-list">
          <Popover.Title>{title()}</Popover.Title>
          <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
          <Show when={!error() && loaded() && entries().length === 0}>
            <p>{t("workflow.inbox.empty")}</p>
          </Show>
          <ul aria-busy={!loaded() && !error() ? "true" : "false"}>
            <For each={entries()}>
              {(item) => (
                <li>
                  <Button
                    variant="ghost"
                    class="workflow-notification-item"
                    onClick={() => {
                      setOpen(false);
                      props.onOpen(item);
                    }}
                  >
                    <strong dir="auto">{item.title}</strong>
                    <span dir="auto">
                      {item.text ||
                        t(item.kind === "approval" ? "notification.workflowApproval" : "notification.workflowOutput")}
                    </span>
                    <time datetime={item.at}>
                      {format.date(new Date(item.at), { dateStyle: "short", timeStyle: "short" })}
                    </time>
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
