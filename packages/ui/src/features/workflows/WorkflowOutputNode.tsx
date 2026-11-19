import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { WORKFLOW_FILE_FORMATS, type WorkflowFileFormat, workflowFileResult } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { Bell, Bot, Button, CircleCheck, FileText, Folder, Hash, Play, Send, Skeleton, Textarea } from "@openbot/ui";
import { createSignal, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { AgentPill } from "./WorkflowAgentNode";
import { resultValue, useBoard, type WfnPortType } from "./workflow-board";
import { DISCORD_OUTPUT_DEFAULTS, DiscordIcon, DiscordOutputRows } from "./workflow-discord-parts";
import { GITHUB_OUTPUT_DEFAULTS, GitHubIcon, GitHubOutputRows, useGitHubOutputReady } from "./workflow-github-parts";
import {
  asBoolean,
  asString,
  type Choice,
  FailureAlert,
  Field,
  NodeShell,
  NodeToolbar,
  oneOf,
  useField,
  useLocked,
  useStepRun,
  useTextField,
} from "./workflow-node-parts";
import { InputRow, OutputChannelRow, SettingRow, SettingRows, SettingsFoot, StaticRow } from "./workflow-setting-rows";
import { SLACK_OUTPUT_DEFAULTS, SlackIcon, SlackOutputRows } from "./workflow-slack-parts";
import { TELEGRAM_OUTPUT_DEFAULTS, TelegramIcon, TelegramOutputRows } from "./workflow-telegram-parts";

type OutputTarget = "channel" | "file" | "notify" | "github" | "discord" | "telegram" | "slack" | "chat-channel";

const TARGETS = (t: AppTranslate): readonly Choice<OutputTarget>[] => [
  { value: "channel", label: t("workflow.node.place.channel"), icon: () => <Hash aria-hidden="true" /> },
  { value: "file", label: t("workflow.output.target.file"), icon: () => <FileText aria-hidden="true" /> },
  { value: "notify", label: t("workflow.output.target.notify"), icon: () => <Bell aria-hidden="true" /> },
  { value: "github", label: t("workflow.output.target.github"), icon: () => <GitHubIcon /> },
  { value: "discord", label: t("workflow.output.target.discord"), icon: () => <DiscordIcon /> },
  { value: "telegram", label: t("workflow.output.target.telegram"), icon: () => <TelegramIcon /> },
  { value: "slack", label: t("workflow.output.target.slack"), icon: () => <SlackIcon /> },
];

const TARGET_TYPES: readonly OutputTarget[] = [
  "channel",
  "file",
  "notify",
  "github",
  "discord",
  "telegram",
  "slack",
  "chat-channel",
];

const HOST_TARGETS: readonly OutputTarget[] = ["github", "discord", "telegram", "slack"];

const TARGET_DEFAULTS: Partial<Record<OutputTarget, Record<string, string>>> = {
  github: GITHUB_OUTPUT_DEFAULTS,
  discord: DISCORD_OUTPUT_DEFAULTS,
  telegram: TELEGRAM_OUTPUT_DEFAULTS,
  slack: SLACK_OUTPUT_DEFAULTS,
};

const OUTPUT_INPUTS: readonly WfnPortType[] = ["text", "image", "file"];

const TEXT_INPUTS: readonly WfnPortType[] = ["text"];

export function OutputNode(props: {
  id: string;
  target?: OutputTarget;
  connectionId?: string;
  placeId?: string;
  path?: string;
  title?: string;
}) {
  const board = useBoard();
  const { t, errorMessage } = useText();
  const [target, setTarget] = useField<OutputTarget>(
    () => props.id,
    "target",
    untrack(() => props.target ?? "channel"),
    oneOf(TARGET_TYPES),
  );
  const isChannel = () => target() === "channel" || target() === "chat-channel";
  const chooseTarget = (value: OutputTarget) => {
    if (value === "channel" && isChannel()) return;
    const channels = board.catalogs().channels ?? [];
    const stored = board.field(props.id, "channelId");
    const channel = channels.some((entry) => entry.id === stored) ? stored : channels[0]?.id;
    if (value === "channel" && board.catalogs().places.length === 0 && channel !== undefined)
      return board.setFields(props.id, { target: "chat-channel", channelId: channel });
    const defaults = TARGET_DEFAULTS[value];
    const fromOther = target() !== value && HOST_TARGETS.includes(target());
    if (!defaults || (board.field(props.id, "action") !== undefined && !fromOther)) return setTarget(value);
    board.setFields(props.id, { target: value, ...defaults });
  };
  const offered = (value: OutputTarget) => {
    const outputs = board.features()?.outputs;
    if (value === target()) return true;
    if (value === "channel" && (isChannel() || outputs?.includes("chat-channel"))) return true;
    return HOST_TARGETS.includes(value) ? outputs?.includes(value) === true : (outputs?.includes(value) ?? true);
  };
  const [filename, setFilename] = useTextField(() => props.id, "filename", "");
  const [prompt, setPrompt] = useTextField(() => props.id, "prompt", "");
  const [agentId] = useField(() => props.id, "agentId", "", asString);
  const [fileSource] = useField(() => props.id, "fileSource", "", asString);
  const [folderGrantId] = useField(() => props.id, "folderGrantId", "", asString);
  const [folderName] = useField(() => props.id, "folderName", "", asString);
  const [pickingFolder, setPickingFolder] = createSignal(false);
  const [folderError, setFolderError] = createSignal("");
  const author = () => board.catalogs().agents.find((entry) => entry.id === agentId());
  const writesWithAgent = () => target() === "file" && (fileSource() === "agent" || Boolean(agentId()));
  const validAuthor = () => board.catalogs().fileAgent && author() && prompt().trim();
  const chooseFolder = async (choice: string) => {
    setFolderError("");
    if (choice === "library") {
      board.setFields(props.id, { folderGrantId: "", folderName: "" });
      return;
    }
    const choose = board.catalogs().chooseFileFolder;
    if (!choose || pickingFolder()) return;
    setPickingFolder(true);
    try {
      const folder = await choose(props.id);
      if (folder) board.setFields(props.id, { folderGrantId: folder.id, folderName: folder.name });
    } catch (error) {
      setFolderError(errorMessage(error, t("error.workflow.fileFolderFailed")));
    } finally {
      setPickingFolder(false);
    }
  };
  const [format, setFormat] = useField<WorkflowFileFormat>(
    () => props.id,
    "format",
    "txt",
    oneOf(WORKFLOW_FILE_FORMATS),
  );
  const [notify, setNotify] = useField(() => props.id, "notify", false, asBoolean);
  const [title, setTitle] = useTextField(
    () => props.id,
    "title",
    untrack(() => props.title ?? ""),
  );
  const [locked, setLocked] = useLocked(() => props.id);
  const run = useStepRun(untrack(() => props.id));
  const githubReady = useGitHubOutputReady(() => props.id);
  const isGitHub = () => target() === "github";
  const inputs = () => (HOST_TARGETS.includes(target()) || target() === "file" ? TEXT_INPUTS : OUTPUT_INPUTS);
  const runDisabled = () =>
    locked() ||
    (writesWithAgent() ? !validAuthor() : !inputs().some((type) => board.connected(props.id, "in", type))) ||
    (isGitHub() && !githubReady());
  const shown = () => resultValue(board.shown(props.id));
  const file = () => (target() === "file" ? workflowFileResult(shown()) : undefined);
  const [saving, setSaving] = createSignal({ busy: false, error: "" });
  const save = async () => {
    const value = file();
    const download = board.catalogs().downloadFile;
    if (!value || !download || saving().busy) return;
    setSaving({ busy: true, error: "" });
    try {
      await download(value);
      setSaving({ busy: false, error: "" });
    } catch (error) {
      setSaving({ busy: false, error: errorMessage(error, t("error.workflow.fileFailed")) });
    }
  };
  return (
    <NodeShell
      action={
        <Button
          class="wfn-run"
          fullWidth
          loading={run.running()}
          loadingLabel={t("workflow.node.running")}
          disabled={runDisabled()}
          onClick={run.start}
        >
          {t("workflow.node.run")}
          <Play aria-hidden="true" />
        </Button>
      }
      id={props.id}
      label={t("workflow.output.title")}
      icon={<Send aria-hidden="true" />}
      kind="output"
      inputs={inputs()}
      requires={!writesWithAgent()}
      style={{ "--wfn-width": "320px" }}
      toolbar={<NodeToolbar id={props.id} name={t("workflow.output.name")} locked={locked()} onLock={setLocked} />}
    >
      <SettingRows
        head={
          <SettingRow
            name={t("workflow.output.sendTo")}
            value={isChannel() ? "channel" : target()}
            choices={TARGETS(t).filter((choice) => offered(choice.value))}
            disabled={locked()}
            onChange={chooseTarget}
          />
        }
      >
        <Show when={isChannel()}>
          <OutputChannelRow
            id={props.id}
            openbot={target() === "chat-channel"}
            connectionId={untrack(() => props.connectionId)}
            placeId={untrack(() => props.placeId)}
            disabled={locked()}
          />
        </Show>
        <Show when={target() === "chat-channel"}>
          <SettingsFoot>
            <StaticRow name={t("workflow.output.postsAs")}>
              <span class="wfn-row-text">{t("workflow.output.postsAsNote")}</span>
            </StaticRow>
          </SettingsFoot>
        </Show>
        <Show when={target() === "file"}>
          <SettingRow
            name={t("workflow.output.format")}
            value={format()}
            disabled={locked()}
            onChange={setFormat}
            choices={[
              { value: "txt", label: t("workflow.output.formatTxt"), icon: () => <FileText aria-hidden="true" /> },
              { value: "md", label: t("workflow.output.formatMd"), icon: () => <FileText aria-hidden="true" /> },
              { value: "html", label: t("workflow.output.formatHtml"), icon: () => <FileText aria-hidden="true" /> },
            ]}
          />
          <InputRow
            name={t("workflow.output.filename")}
            value={filename()}
            disabled={locked()}
            onChange={setFilename}
          />
          <Show
            when={board.catalogs().chooseFileFolder}
            fallback={
              <StaticRow name={t("workflow.output.fileLocation")}>
                <span class="wfn-row-text">{folderName() || t("workflow.output.fileLibrary")}</span>
              </StaticRow>
            }
          >
            <SettingRow
              name={t("workflow.output.fileLocation")}
              value={folderGrantId() ? "selected" : "library"}
              placeholder={folderName()}
              disabled={locked() || pickingFolder()}
              onChange={chooseFolder}
              choices={[
                {
                  value: "library",
                  label: t("workflow.output.fileLibrary"),
                  icon: () => <FileText aria-hidden="true" />,
                },
                {
                  value: "choose",
                  label: t("workflow.output.chooseFolder"),
                  icon: () => <Folder aria-hidden="true" />,
                },
              ]}
            />
          </Show>
          <Show when={board.catalogs().fileAgent || writesWithAgent()}>
            <SettingRow
              name={t("workflow.output.fileContent")}
              value={writesWithAgent() ? "agent" : "input"}
              disabled={locked() || !board.catalogs().fileAgent}
              onChange={(value) =>
                board.setFields(
                  props.id,
                  value === "agent" ? { fileSource: value } : { fileSource: value, agentId: "" },
                )
              }
              choices={[
                {
                  value: "input",
                  label: t("workflow.output.fileFromInput"),
                  icon: () => <FileText aria-hidden="true" />,
                },
                { value: "agent", label: t("workflow.output.fileFromAgent"), icon: () => <Bot aria-hidden="true" /> },
              ]}
            />
          </Show>
          <SettingRow
            name={t("workflow.output.alsoNotify")}
            value={notify() ? "yes" : "no"}
            disabled={locked()}
            onChange={(value) => setNotify(value === "yes")}
            choices={[
              { value: "yes", label: t("workflow.board.branch.yes"), icon: () => <Bell aria-hidden="true" /> },
              { value: "no", label: t("workflow.board.branch.no"), icon: () => <Bell aria-hidden="true" /> },
            ]}
          />
          <SettingsFoot>
            <p class="wfn-settings-help">{t("workflow.output.filenameHint", { date: "{{date}}", run: "{{run}}" })}</p>
          </SettingsFoot>
          <Show when={folderError()}>
            <p class="wfn-alert" role="alert">
              {folderError()}
            </p>
          </Show>
        </Show>
        <Show when={target() === "notify"}>
          <InputRow
            name={t("workflow.output.notifyTitleRow")}
            value={title()}
            disabled={locked()}
            onChange={setTitle}
          />
        </Show>
        <Show when={isGitHub()}>
          <GitHubOutputRows id={props.id} locked={locked()} />
        </Show>
        <Show when={target() === "discord"}>
          <DiscordOutputRows id={props.id} locked={locked()} />
        </Show>
        <Show when={target() === "telegram"}>
          <TelegramOutputRows id={props.id} locked={locked()} />
        </Show>
        <Show when={target() === "slack"}>
          <SlackOutputRows id={props.id} locked={locked()} />
        </Show>
      </SettingRows>
      <Show when={writesWithAgent()}>
        <Field class="wfn-field-task">
          <Textarea
            class="wfn-input"
            aria-label={t("workflow.output.filePrompt")}
            placeholder={t("workflow.output.filePrompt")}
            maxlength={INPUT_LIMITS.workflowNodeText}
            readonly={locked() || !board.catalogs().fileAgent}
            value={prompt()}
            onValueChange={setPrompt}
          />
          <div class="wfn-field-foot">
            <AgentPill
              agent={author()}
              removed={agentId() !== "" && !author()}
              disabled={locked() || !board.catalogs().fileAgent}
              onChange={(agent) => board.setFields(props.id, { agentId: agent.id })}
            />
          </div>
        </Field>
      </Show>
      <Show
        when={shown()}
        fallback={
          <Show when={run.running()} fallback={<FailureAlert id={props.id} running={false} />}>
            <div class="wfn-alert" data-pending aria-hidden="true">
              <Skeleton />
            </div>
          </Show>
        }
      >
        {(value) => (
          <p class="wfn-alert" data-tone="success" data-stale={run.running() ? "" : undefined}>
            <CircleCheck aria-hidden="true" />
            <span class="wfn-alert-text">
              {file() ? t("workflow.output.fileSaved", { name: file()?.name ?? "" }) : value()}
            </span>
          </p>
        )}
      </Show>
      <Show when={file() && board.catalogs().downloadFile}>
        <Button fullWidth disabled={saving().busy} onClick={save}>
          {t("workflow.node.toolbar.download")}
        </Button>
      </Show>
      <Show when={saving().error}>
        <p class="wfn-alert" role="alert">
          {saving().error}
        </p>
      </Show>
    </NodeShell>
  );
}
