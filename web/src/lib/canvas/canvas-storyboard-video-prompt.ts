import type { StoryboardRow } from "@/types/canvas";

export function storyboardVideoPrompt(row: StoryboardRow): string {
    const sections: Array<[string, string | undefined]> = [
        ["画面描述", row.plotDescription],
        [
            "出镜角色",
            row.characters
                ?.map((character) => character.characterName)
                .filter(Boolean)
                .join("、"),
        ],
        ["台词/旁白", row.dialogue],
        ["叙事意图", row.narrativeIntent],
        ["观众视点", row.viewerPOV],
        ["表演调度", row.performanceBlocking],
        ["景别", row.shotSize],
        ["情绪", row.emotion],
        ["光影氛围", row.lightingAndAtmosphere],
        ["镜头设计", row.camera],
        ["运镜", row.motion],
        ["时间节拍", row.timeBeats],
        ["运动与结尾", row.videoMotionPrompt],
        ["声音", row.audioEffects],
        ["连续性出口", row.continuityOut],
        ["必备要素", row.mustHave?.filter(Boolean).join("；")],
        ["可选细节", row.optionalDetails?.filter(Boolean).join("；")],
        ["负面要求", row.negativePrompt],
    ];
    return sections.flatMap(([label, value]) => (value?.trim() ? [`【${label}】\n${value.trim()}`] : [])).join("\n\n");
}
