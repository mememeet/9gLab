import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { canvasThemes } from "@/lib/canvas-theme";

test("renders a semantic node card without exposing its internal ID", () => {
    const nodeId = "video-1790385749473-q4157";
    const reference = { id: nodeId, nodeId, kind: "video" as const, label: "片头镜头", title: "片头镜头", sourceType: "video" as const, previewUrl: "data:image/png;base64,preview" };
    const html = renderToStaticMarkup(
        <AgentChatMessage
            item={{ id: "assistant-1", role: "assistant", text: `新节点 ID：${nodeId}` }}
            theme={canvasThemes.dark}
            references={[reference]}
            onFocusNode={() => {}}
        />,
    );

    expect(html).toContain('class="agent-message-node-link"');
    expect(html).toContain(`data-agent-node-id="${nodeId}"`);
    expect(html).toContain("视频节点");
    expect(html).toContain("片头镜头");
    expect(html.replace(/<[^>]+>/gu, "")).not.toContain(nodeId);
});
