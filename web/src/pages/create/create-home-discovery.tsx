import { useMemo, useState } from "react";
import { ArrowUpRight, Sparkles, WandSparkles } from "lucide-react";
import { Link } from "react-router";

import type { Skill } from "@/services/api/skills";

type DiscoveryTab = "inspiration" | "skill";

type CreationInspiration = {
    id: string;
    title: string;
    description: string;
    category: string;
    imageUrl: string;
    prompt: string;
};

const INSPIRATION_CATEGORIES = ["精选", "真人短剧", "二维动画", "三维动画", "未来科幻", "东方美学"] as const;

const CREATION_INSPIRATIONS: CreationInspiration[] = [
    {
        id: "suspense-noir",
        title: "雨夜里的无声追踪",
        description: "低照度城市夜景、潮湿街道与克制运镜，建立逐步逼近的悬疑压力。",
        category: "真人短剧",
        imageUrl: "/short-drama-styles/suspense-noir.jpg",
        prompt: "雨夜的旧城街巷，一个穿深色风衣的人察觉被跟踪。镜头从积水倒影缓慢抬起，贴着人物背后向前推进，路灯与便利店冷光交替掠过面部，写实悬疑电影质感。",
    },
    {
        id: "cyberpunk-neon",
        title: "霓虹街区的最后一班车",
        description: "冷蓝与洋红灯牌切开空荡街道，让人物在未来城市中独自行进。",
        category: "未来科幻",
        imageUrl: "/short-drama-styles/cyberpunk-neon.jpg",
        prompt: "深夜霓虹街区，最后一班无人驾驶巴士从雨雾中驶来。镜头沿空旷道路低机位前移，冷蓝和洋红灯牌映在湿润地面上，主角停在站台回头，电影级赛博都市氛围。",
    },
    {
        id: "chinese-2d",
        title: "星火唤醒国漫少年",
        description: "稳定二维线稿与东方色板，在一次拔剑动作中完成角色觉醒。",
        category: "二维动画",
        imageUrl: "/short-drama-styles/chinese-2d.jpg",
        prompt: "东方国漫二维动画，少年在风雪山门前拔剑，剑身亮起朱砂色星火。镜头先定格眼神，再快速环绕到侧后方，衣摆和发丝顺风展开，清晰线稿、赛璐璐上色、克制的水墨空气感。",
    },
    {
        id: "nature-healing",
        title: "森林邮差的清晨旅程",
        description: "柔和晨光、圆润角色与慢节奏移动，组成治愈系三维短片。",
        category: "三维动画",
        imageUrl: "/short-drama-styles/nature-healing.jpg",
        prompt: "治愈系三维动画，一位小小森林邮差背着绿色邮包穿过露水草地。镜头与角色平行缓慢移动，晨光透过树叶形成柔和光斑，小动物从路边探头，圆润材质、自然色彩、轻盈节奏。",
    },
    {
        id: "retro-hong-kong",
        title: "天台重逢的旧日胶片",
        description: "旧楼、晾衣绳和颗粒胶片，把久别重逢放进九十年代城市记忆。",
        category: "真人短剧",
        imageUrl: "/short-drama-styles/retro-hong-kong.jpg",
        prompt: "九十年代香港旧楼天台，黄昏逆光中两位多年未见的朋友隔着晾衣绳认出彼此。镜头从远景缓慢推到双人中景，风吹动衬衫与报纸，暖灰胶片颗粒、自然表演、克制怀旧感。",
    },
    {
        id: "ink-narrative",
        title: "一叶舟穿过墨色山河",
        description: "宣纸留白、焦墨山石与一点朱砂，引导诗意而清晰的东方叙事。",
        category: "东方美学",
        imageUrl: "/short-drama-styles/ink-narrative.jpg",
        prompt: "水墨叙事动画，一叶小舟从大面积宣纸留白中驶入层叠墨山。镜头随水纹横向移动，远山由淡墨逐渐显现，人物衣角保留一点朱砂，干湿笔触自然生长，安静而有方向感。",
    },
    {
        id: "space-opera",
        title: "舰队越过蓝色巨星",
        description: "宏大尺度与清晰剪影，让科幻奇观始终服务于一次启航。",
        category: "未来科幻",
        imageUrl: "/short-drama-styles/space-opera.jpg",
        prompt: "太空歌剧开场，远征舰队从蓝色巨星的光环背后依次出现。镜头从旗舰舷窗内缓慢拉到宇宙全景，船体保持清晰尺度与金属结构，冷蓝恒星光、深邃黑场、庄严而克制的启航节奏。",
    },
    {
        id: "clay-stop-motion",
        title: "黏土厨房的午夜派对",
        description: "可见手作纹理和停格节奏，把寻常厨房变成轻喜剧舞台。",
        category: "三维动画",
        imageUrl: "/short-drama-styles/clay-stop-motion.jpg",
        prompt: "黏土停格动画，午夜厨房里杯子、面包和水果偷偷开始派对。镜头贴着台面穿过跳舞的餐具，角色动作带轻微逐帧顿挫，可见指纹与手作材质，暖色台灯、俏皮节奏、微缩摄影质感。",
    },
];

export function CreationHomeDiscovery({ skills, onUsePrompt, onUseSkill }: { skills: Skill[]; onUsePrompt: (prompt: string) => void; onUseSkill: (skill: Skill) => void }) {
    const [tab, setTab] = useState<DiscoveryTab>("inspiration");
    const [category, setCategory] = useState<(typeof INSPIRATION_CATEGORIES)[number]>("精选");
    const inspirations = useMemo(() => category === "精选" ? CREATION_INSPIRATIONS : CREATION_INSPIRATIONS.filter((item) => item.category === category), [category]);
    const visibleSkills = skills.filter((skill) => skill.isAdded).slice(0, 8);

    return <section className="creation-home-discovery" aria-label="创作发现">
        <header className="creation-home-discovery-header">
            <div className="creation-home-discovery-tabs" role="tablist" aria-label="发现内容类型">
                <button type="button" role="tab" aria-selected={tab === "inspiration"} className={tab === "inspiration" ? "is-active" : ""} onClick={() => setTab("inspiration")}>创作灵感</button>
                <button type="button" role="tab" aria-selected={tab === "skill"} className={tab === "skill" ? "is-active" : ""} onClick={() => setTab("skill")}>Skill</button>
            </div>
            {tab === "skill" ? <Link to="/skills" className="creation-home-discovery-all">查看全部 Skill<ArrowUpRight /></Link> : null}
        </header>

        {tab === "inspiration" ? <>
            <div className="creation-home-discovery-categories" aria-label="灵感分类">
                {INSPIRATION_CATEGORIES.map((item) => <button key={item} type="button" aria-pressed={category === item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
            </div>
            <div className="creation-home-discovery-grid" role="tabpanel">
                {inspirations.map((item) => <button key={item.id} type="button" className="creation-inspiration-card" aria-label={`使用提示词：${item.title}`} onClick={() => onUsePrompt(item.prompt)}>
                    <span className="creation-discovery-cover">
                        <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
                        <span className="creation-discovery-category">{item.category}</span>
                        <span className="creation-discovery-use"><WandSparkles />使用提示词</span>
                    </span>
                    <span className="creation-discovery-copy">
                        <strong>{item.title}</strong>
                        <span>{item.description}</span>
                    </span>
                </button>)}
            </div>
        </> : visibleSkills.length ? <div className="creation-home-discovery-grid is-skills" role="tabpanel">
            {visibleSkills.map((skill) => {
                const media = skill.showcaseMedia?.[0];
                return <button key={skill.skillId} type="button" className="creation-skill-card" aria-label={`调用 Skill：${skill.skillName}`} onClick={() => onUseSkill(skill)}>
                    <span className="creation-discovery-cover is-skill">
                        {media?.showcaseUrl ? media.type === "video" ? <video src={media.showcaseUrl} muted playsInline preload="metadata" /> : <img src={media.showcaseUrl} alt="" loading="lazy" decoding="async" /> : <span className="creation-skill-placeholder"><Sparkles /></span>}
                        <span className="creation-discovery-category">{skill.tag || "Skill"}</span>
                        <span className="creation-discovery-use"><Sparkles />调用 Skill</span>
                    </span>
                    <span className="creation-discovery-copy">
                        <strong>{skill.skillName}</strong>
                        <span>{skill.description || "把这个技能带入创作输入器继续工作。"}</span>
                        <small>@{skill.effectiveUser?.name || "9G"}</small>
                    </span>
                </button>;
            })}
        </div> : <div className="creation-home-skill-empty" role="tabpanel">
            <span><Sparkles /></span>
            <strong>把专业能力带进创作</strong>
            <p>在 Skill 库加入分镜、配音或视觉风格技能后，可以从这里直接调用。</p>
            <Link to="/skills">浏览 Skill</Link>
        </div>}
    </section>;
}
