import { adminRoute, boolean, fields, identifier, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const MEMDOOR_TEAM_CAPABILITY = "memdoor-team-v1";
export const MEMDOOR_TEAM_ROUTES = {
  settings: "/v1/admin/agents/memdoor-team",
  update: "/v1/admin/agents/memdoor-team/update",
} as const;

const role = fields({
  model: string(84),
  effort: oneOf("", "low", "medium", "high", "xhigh", "max"),
  prompt: string(8_000),
});
const config = {
  teamModel: string(84),
  decisionModel: string(84),
  roles: fields(
    {},
    {
      reproduce: role,
      "direct-a": role,
      "direct-b": role,
      "direct-c": role,
      ideate: role,
      plan: role,
      solve: role,
      judge: role,
      review: role,
      repair: role,
    },
  ),
};
const settings = fields({ ...config, hasApiKey: boolean, runtime: oneOf("ready", "missing", "git-missing") });
export const MEMDOOR_TEAM_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MEMDOOR_TEAM_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [MEMDOOR_TEAM_ROUTES.update, adminRoute(fields({ agentId: identifier, ...config }), settings)],
]);
