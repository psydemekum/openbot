# Memdoor in OpenBot

The Windows fork includes one **Multi-Agent** backed by Memdoor's built-in `team-solve` workflow.
Select it in a chat or in an OpenBot workflow agent step. Under **Agent settings → Brain**,
choose the team model, the decision model and the model for each of the ten internal roles.
The standard picker lists compatible OpenAI models from OpenBot. A role uses the team model until
you choose a different model. Use **Role instructions and reasoning** to edit overrides or restore
the team model for a role.

The defaults are `gpt-6.2-sol` for the team and `gpt-6-luna` for decisions. The executing host
tries the dedicated key from the local Memdoor settings first, then the official OpenAI key
configured in the host's Codex environment, then an `OPENAI_API_KEY` shared with Multi-Agent in
the Vault. Role settings can also be changed by a connected web or desktop administrator.
Enter credentials on the Windows host.

Windows needs Git for Windows with Git Bash for Memdoor's workspace tasks. The worker runs with
the Windows user's filesystem permissions. OpenBot relays Memdoor's workflow approval gates.

Build the companion with `bun scripts/prepare-memdoor.ts` from the repository root. The script
checks out the pinned [Memdoor revision](https://github.com/guregodevo/memdoor/tree/67e32e0cbf5bb0d055f155f526d16ee7863f179b),
applies `openbot.patch`, and copies the binary and its Apache 2.0 license and notice into
`build/memdoor`. The fork's Windows build packages that directory.

Run `bun scripts/memdoor-team-e2e.ts` after building the companion. This check uses test keys and
exercises the packaged entry point with the key removed, without making OpenAI requests.
