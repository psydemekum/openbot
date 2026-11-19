import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  identifier,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";
import { OPEN_PROVIDER_ID } from "./provider-aware-codec";

export const MEMDOOR_TEAM_MODEL_SOURCES_CAPABILITY = "memdoor-team-model-sources-v1";
export const MEMDOOR_TEAM_MODEL_SOURCES_ROUTES = {
  settings: "/v1/admin/agents/memdoor-team/v2",
  update: "/v1/admin/agents/memdoor-team/v2/update",
} as const;

const role = fields({
  model: string(256),
  effort: oneOf("", "low", "medium", "high", "xhigh", "max"),
  prompt: string(8_000),
});
const decisionModel: AdminDecoder = (value) => {
  if (!isString(value) || !/^gpt-[a-z0-9][a-z0-9.-]{0,79}$/u.test(value)) throw new Error("Invalid decision model.");
  return value;
};
const config = {
  teamModel: string(256),
  decisionModel,
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
const modelSources: AdminDecoder = (value) => {
  if (!Array.isArray(value)) throw new Error("Invalid Memdoor model sources.");
  return value.map((source: unknown) => {
    if (
      !isString(source) ||
      (!OPEN_PROVIDER_ID.test(source) && !/^(opencode|pi):[a-z0-9][a-z0-9_-]{0,127}\/$/u.test(source))
    )
      throw new Error("Invalid Memdoor model source.");
    return source;
  });
};
const settings = fields(
  { ...config, hasApiKey: boolean, runtime: oneOf("ready", "missing", "git-missing") },
  { modelSources },
);
const updateConfig = fields({ agentId: identifier, ...config });
const update: AdminDecoder = (value) => {
  if (isDynamicRecord(value) && value.apiKey !== undefined) throw new Error("The API key is local to the host.");
  return updateConfig(value);
};

export const MEMDOOR_TEAM_MODEL_SOURCES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MEMDOOR_TEAM_MODEL_SOURCES_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [MEMDOOR_TEAM_MODEL_SOURCES_ROUTES.update, adminRoute(update, settings)],
]);
