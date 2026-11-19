# Workflow file outputs

An output node with target `file` stores one UTF-8 attachment per execution. It can save incoming
text directly or send that text and the file prompt to a selected agent and save its final answer.
The node accepts text inputs. Direct export supports empty input.

The **Save to** setting starts on **OpenBot Library**. Choose a folder in the desktop app on the host
to save a second copy there. The file remains downloadable from its workflow run. When the name
already exists in the folder, the host appends a unique suffix. The folder belongs to that node on that
host. A copied node starts in the Library. Select the folder again if it moves or is replaced.

File inputs preserve leading spaces and final line breaks. Multiple inputs are joined with two line
breaks in edge order. Input above the workflow step limit (32,000 UTF-16 code units) fails before writing.

## Fields

| Field | Values |
| --- | --- |
| target | `file` |
| format | `txt` (default), `md`, `html` |
| filename | A file name, without directories; default `workflow-{{date}}` |
| notify | Boolean; false by default |
| fileSource | `input` (default) or `agent` |
| agentId, prompt | The agent and its task when the agent writes the file |
| folderGrantId, folderName | Reference and display name from the native folder picker |

The host adds the selected extension. A TXT, Markdown or HTML extension already in the name is replaced.
`{{date}}` and `{{datum}}` expand to the step start date in UTC (YYYY-MM-DD).
`{{run}}` expands to the workflow run id, or the step id for a solo step.
Unknown placeholders, reserved Windows names and path characters fail before storage.
The host resolves the folder reference against the grant for this workflow and node. The graph
never stores the folder path. A joined client can see the selected folder name.

TXT and Markdown preserve the input. HTML input that starts with a doctype or an html element stays
as a document. Other input is escaped inside a complete HTML document with a UTF-8 meta tag.
Secret redaction runs before storage. The canvas downloads HTML; it never inserts it into its DOM.

The existing step output stores a JSON file descriptor: `type`, `id`, `name`, `mimeType`, `size`.
The id uses the existing attachment storage and authenticated download route. Downloads use the saved
file name, even after the node is edited.
The usual attachment access rules apply: a signed-in server member who knows the file id can download it.
Members discover the id through workflow results they can read. The host owner can also find it in the Library.
The result selector gives access to older runs. Files stay in the Library until the user deletes them.

The optional `workflows-files-v1` and `workflows-file-agent-v1` capabilities expose export and agent
authoring to supporting clients. Both use protocol 10. Desktop, web and phone use the existing file
saving actions.

Storage failure fails the step without a success notice. Saving and settling the step are protected
from cooperative cancellation. A process crash can leave a file in the Library before the step
records its result. Recovery fails that unfinished step explicitly; it does not silently write a second
file. Check the Library before retrying.

## Verification

- `bun scripts/workflow-file-output-e2e.ts`: real SQLite, workflow execution and attachment storage.
- `bun scripts/workflow-team-api-e2e.ts --files`: access checks, protocol capabilities, remote run and authenticated
  file download. This selection stops before provider-dependent media checks.
- Workflow stories: file settings and stored result download.
