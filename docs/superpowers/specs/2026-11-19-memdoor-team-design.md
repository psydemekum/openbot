# Memdoor team in OpenBot

Give each configured OpenBot host one managed **Multi-Agent** backed by Memdoor's own team workflow.
Use it in ordinary chats and in the workflow agent picker. A workflow step stays open until the team
has a terminal result. The normal OpenBot run and chat controls show progress, errors, and cancellation.

This host's defaults are OpenAI GPT-6.2 Sol for team roles and GPT-6 Luna for the decision service.
Each upstream role can override the team model, reasoning effort, and additional instructions in the
ordinary agent settings. Preserve the upstream prompts' required artifacts and checks. Load the same
OpenAI API credential for the team and decision service from the executing host's protected configuration.
Expose credential status only. A joined host uses its own credential and project directory.

## Integration

Use the existing custom ACP agent runtime for conversations and tool/approval events. Extend Memdoor's
ACP entry point to track the team run, return its final result, and cancel that run. Running an unmodified
ACP session would finish as soon as Memdoor accepted the team job. A separate OpenBot workflow runner
would duplicate chat sessions, agent dispatch, and cancellation in OpenBot.

Pin Memdoor to `67e32e0cbf5bb0d055f155f526d16ee7863f179b` plus the integration patches and retain its
license and notice. Bundle a verified runtime with the fork's Windows build. Keep Memdoor's state
isolated from an independent Memdoor install. Enable OpenAI decisions explicitly through the Responses
API. Use project-scoped permissions available on the executing host and retain Memdoor's approval gates.

## Acceptance

On a test profile, open the single managed agent, change a role, restart, and verify the saved fields.
Run a small project task from chat, then through an OpenBot workflow whose next node receives the
final result. Check that a stop or failed run ends the matching team run or fails the workflow step.
Exercise native team execution with an API fixture first. Check model access separately with the
configured key when available.
