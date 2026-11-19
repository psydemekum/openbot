import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Bell from "lucide-react-native/icons/bell";
import { useState } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { useText } from "@/shared/lib/text";

export function WorkflowNotificationList({ serverId }: { serverId: string }) {
  const [open, setOpen] = useState(false);
  const { t, format, errorMessage } = useText();
  const color = useThemeColor("foreground");
  const scope = useQueryScope();
  const supported = useMobileWorkspaceSelector((current) => current.canReadWorkflowNotifications(serverId));
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const { workflowNotifications } = useMobileWorkspaceActions();
  const query = useQuery({
    queryKey: [...queryKeys.workflowList(scope, serverId), "notifications"],
    queryFn: () => workflowNotifications(serverId),
    enabled: supported && open,
    retry: false,
  });
  if (!supported) return null;
  return (
    <SettingsSection>
      <SettingsRow leading={<Bell size={18} color={color} />} expanded={open} onPress={() => setOpen(!open)}>
        <Typography.Paragraph>{t("mobile.workflow.inbox.title")}</Typography.Paragraph>
      </SettingsRow>
      {open && (query.isError || !query.data?.length) ? (
        <SettingsRow disclosure={false}>
          <Typography.Paragraph>
            {query.isError
              ? errorMessage(query.error, t("mobile.workflow.list.loadFailed"))
              : query.data
                ? t("mobile.workflow.inbox.empty")
                : t("mobile.workflow.list.loading")}
          </Typography.Paragraph>
        </SettingsRow>
      ) : null}
      {open &&
        !query.isError &&
        query.data?.map((item) => (
          <SettingsRow
            key={item.id}
            supportingText={
              item.text || t(item.kind === "approval" ? "mobile.workflow.kind.approval" : "mobile.workflow.kind.output")
            }
            value={format.date(new Date(item.at), { dateStyle: "short", timeStyle: "short" })}
            onPress={() => {
              const chat = item.chat;
              if (chat && agents.some((agent) => agent.id === chat.agentId && agent.serverId === serverId)) {
                if (chat.taskId)
                  router.push({
                    pathname: "/task/[taskId]",
                    params: { serverId, agentId: chat.agentId, taskId: chat.taskId },
                  });
                else router.push({ pathname: "/chat/[agentId]", params: { agentId: chat.agentId } });
              } else
                router.push({
                  pathname: "/server-workflows/workflow",
                  params: { serverId, workflowId: item.workflowId },
                });
            }}
          >
            <Typography.Paragraph>{item.title}</Typography.Paragraph>
          </SettingsRow>
        ))}
    </SettingsSection>
  );
}
