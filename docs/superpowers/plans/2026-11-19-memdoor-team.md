# Memdoor Team Implementation Plan

> Use the subagent-driven-development skill for isolated implementation tasks and focused review.

**Goal** Add a fixed, configurable Memdoor team agent to chat and workflows.

**Architecture** Extend Memdoor's gateway and ACP client for the OpenAI decision provider, per-role
settings, and team terminal results. Integrate the pinned binary through OpenBot's managed ACP path.

**Tech stack** Go, bun, Effect, SolidJS, Electron, ACP and the OpenAI Responses API.

**Spec** [Memdoor team in OpenBot](../specs/2026-11-19-memdoor-team-design.md).

## Global constraints

- Start from Memdoor 67e32e0cbf5bb0d055f155f526d16ee7863f179b. Keep its license and notice.
- Default to gpt-6.2-sol and gpt-6-luna with the executing host's own OpenAI API key.
- Keep credentials out of IPC read results, process arguments, project folders, prompts and logs.
- Preserve legacy Team API codecs. Gate additive host settings by a capability.
- Keep the ordinary OpenBot ACP transport and workflow handoff. Respect a stopped or failed run.

## Tasks and checks

- [ ] Add the OpenAI decision provider and `MEMDOOR_OPENBOT_DECISION_MODEL` opt-in to the pinned
  source. Test boolean, choice, score, malformed values and an unavailable provider.
- [ ] Add the Memdoor ACP team adapter in `cmd/cli/cmd` and role overrides in `gateway`.
  Test waiting for the final result, prompting on a gate and cancellation for the exact run id.
- [ ] Add the pinned runtime assembly script and Windows installer resources to the fork.
  Test source verification, isolated storage, verified Windows execution and a missing runtime.
- [ ] Add managed provisioning and protected settings to the OpenBot host. Expose typed
  read/save and capability-gated remote access. Test one profile per host and key redaction.
- [ ] Add a Memdoor section to the shared agent settings and connect it to the host.
  Verify desktop and joined-client settings, then run the agent from chat and the workflow picker.
- [ ] Run focused tests, then publish and verify the Windows installer built from the fork.
