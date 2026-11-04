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

test("renders an image-to-previs request as the existing canvas node card", () => {
    const nodeId = "video-1790385749473-q4157";
    const reference = { id: nodeId, nodeId, kind: "image" as const, label: "道姑", title: "道姑", sourceType: "image" as const, previewUrl: "data:image/png;base64,preview" };
    const html = renderToStaticMarkup(
        <AgentChatMessage
            item={{ id: "user-previs", role: "user", text: "根据此图生成 3D 预演台", canvasReferenceNodeId: nodeId }}
            theme={canvasThemes.dark}
            references={[reference]}
            onFocusNode={() => {}}
        />,
    );

    expect(html).toContain('class="agent-message-node-link"');
    expect(html).toContain('class="agent-message-node-link-preview"');
    expect(html).toContain("道姑");
    expect(html).toContain("3D 预演台");
});
