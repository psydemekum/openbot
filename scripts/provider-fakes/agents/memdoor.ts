import { randomUUID } from "node:crypto";
import { logEntry, serveFakeAcpAgent } from "../acp-agent";

serveFakeAcpAgent({
  initialize: (request, peer) => peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: false } }),
  "session/new": (request, peer) => peer.reply(request, { sessionId: randomUUID() }),
  "session/prompt": (request, peer) => {
    const text = request.params.prompt?.map((block) => block.text).join("\n");
    const answer = `Team result ${randomUUID()}`;
    logEntry({ sessionId: request.params.sessionId, text, answer });
    peer.say(request.params.sessionId, answer);
    peer.reply(request, { stopReason: "end_turn" });
  },
});
