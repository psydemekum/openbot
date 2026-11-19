import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { WorkflowNode } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import type { ReactNode } from "react";
import { useUniwind } from "uniwind";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { useWorkflowDraft, type WorkflowDraft } from "@/features/workflows/model/workflow-draft";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { useText } from "@/shared/lib/text";

export function FileOutputFields({
  node,
  draft,
  agentChoice,
}: {
  node: WorkflowNode;
  draft: WorkflowDraft;
  agentChoice: ReactNode;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const setFields = useWorkflowDraft((state) => state.setFields);
  const enabled = useMobileWorkspaceSelector((current) => current.canUseWorkflowFiles(draft.serverId));
  const canAuthor = useMobileWorkspaceSelector((current) => current.canUseWorkflowFileAgent(draft.serverId));
  const authored = node.fields.fileSource === "agent" || Boolean(node.fields.agentId);
  const folder = typeof node.fields.folderName === "string" ? node.fields.folderName : "";
  return (
    <SettingsSection footer={t("mobile.workflow.file.hint", { date: "{{date}}", run: "{{run}}" })}>
      <SettingsRow
        disclosure={false}
        trailing={
          <SettingsPicker
            value={typeof node.fields.format === "string" ? node.fields.format : "txt"}
            enabled={enabled}
            dark={theme === "dark"}
            label={t("mobile.workflow.file.format")}
            options={[
              { value: "txt", label: t("mobile.workflow.file.txt") },
              { value: "md", label: t("mobile.workflow.file.md") },
              { value: "html", label: t("mobile.workflow.file.html") },
            ]}
            onChange={(format) => setFields(node.id, { format })}
          />
        }
      >
        <Typography.Paragraph>{t("mobile.workflow.file.format")}</Typography.Paragraph>
      </SettingsRow>
      <SheetFormField
        label={t("mobile.workflow.file.filename")}
        autoCapitalize="none"
        maxLength={180}
        editable={enabled}
        value={typeof node.fields.filename === "string" ? node.fields.filename : ""}
        onChangeText={(filename) => setFields(node.id, { filename })}
      />
      <SettingsRow disclosure={false} supportingText={folder || t("mobile.workflow.file.library")}>
        <Typography.Paragraph>{t("mobile.workflow.file.location")}</Typography.Paragraph>
      </SettingsRow>
      {canAuthor ? (
        <SettingsSwitch
          value={authored}
          disabled={!enabled}
          dark={theme === "dark"}
          label={t("mobile.workflow.file.author")}
          onValueChange={(on) =>
            setFields(node.id, on ? { fileSource: "agent" } : { fileSource: "input", agentId: undefined })
          }
        />
      ) : null}
      {canAuthor && authored ? (
        <>
          <SheetFormField
            label={t("mobile.workflow.file.prompt")}
            multiline
            maxLength={INPUT_LIMITS.workflowNodeText}
            value={typeof node.fields.prompt === "string" ? node.fields.prompt : ""}
            onChangeText={(prompt) => setFields(node.id, { prompt })}
          />
          {agentChoice}
        </>
      ) : null}
      <SettingsSwitch
        value={node.fields.notify === true}
        disabled={!enabled}
        dark={theme === "dark"}
        label={t("mobile.workflow.file.notify")}
        onValueChange={(notify) => setFields(node.id, { notify })}
      />
    </SettingsSection>
  );
}
