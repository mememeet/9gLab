import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLInputElement: dom.HTMLInputElement,
    sessionStorage: dom.sessionStorage,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const records = new Map<string, string>();
mock.module("@/lib/localforage-storage", () => ({
    localForageStorageForScope: (scope: string) => ({
        getItem: async (key: string) => records.get(`${scope}:${key}`) ?? null,
        setItem: async (key: string, value: string) => {
            records.set(`${scope}:${key}`, value);
        },
    }),
}));
mock.module("@/components/layout/app-top-nav", () => ({ AppWorkspaceShell: ({ children }: { children: React.ReactNode }) => children }));
mock.module("@/components/canvas/use-agent-panel-dock", () => ({ useAgentPanelDock: () => ({ active: false, width: 0 }) }));
mock.module("@/components/layout/yoru-widget", () => ({ YoruWidget: () => null }));
mock.module("@/components/canvas/canvas-cloud-agent-panel", () => ({ CanvasCloudAgentPanel: () => null }));
mock.module("antd", () => ({ ConfigProvider: ({ children }: { children: React.ReactNode }) => children }));
mock.module("@/lib/app-theme", () => ({ getWorkspaceAntThemeConfig: () => ({}) }));

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { createMemoryRouter, RouterProvider } = await import("react-router");
const { default: UserLayout } = await import("../../src/layouts/user-layout");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { useGlobalAgentStore } = await import("../../src/stores/use-global-agent-store");
const { WORKSPACE_ONBOARDING_KEY, isNewWorkspaceUser, parseWorkspaceOnboarding } = await import("../../src/lib/workspace-onboarding");
const { reportWorkspaceOnboardingAction } = await import("../../src/lib/workspace-onboarding-events");

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
let router: ReturnType<typeof createMemoryRouter>;

async function mount(path: string, id = "new-user", createdAt = new Date().toISOString()) {
    useUserStore.getState().setUser({ id, username: id, displayName: id, role: "user", status: "active", createdAt });
    useGlobalAgentStore.getState().reset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    router = createMemoryRouter(
        [
            {
                path: "*",
                element: (
                    <UserLayout>
                        <main>
                            页面内容
                            <div className="canvas-agent-panel">
                                <textarea aria-label="Agent 输入" />
                            </div>
                        </main>
                    </UserLayout>
                ),
            },
        ],
        { initialEntries: [path] },
    );
    await act(async () => {
        root!.render(<RouterProvider router={router} />);
    });
}

async function click(label: string) {
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
    expect(button).toBeDefined();
    await act(async () => {
        button!.click();
    });
}

afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    host?.remove();
    records.clear();
    dom.sessionStorage.clear();
    useUserStore.getState().clearSession();
    useGlobalAgentStore.getState().reset();
});
afterAll(() => {
    for (const [key, value] of globals) value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key);
});

test("离开画布或切换画布关闭助手，同一画布内切换不会关闭", async () => {
    await mount("/canvas/one", "existing", "2025-01-01T00:00:00Z");
    await act(async () => {
        useGlobalAgentStore.getState().openAgent();
        await router.navigate("/canvas/one/detail");
    });
    expect(useGlobalAgentStore.getState().open).toBe(true);
    await act(async () => {
        await router.navigate("/canvas/two");
    });
    expect(useGlobalAgentStore.getState().open).toBe(false);
    await act(async () => {
        useGlobalAgentStore.getState().openAgent();
        await router.navigate("/");
    });
    expect(useGlobalAgentStore.getState().open).toBe(false);
    await act(async () => {
        useGlobalAgentStore.getState().openAgent();
        await router.navigate("/assets");
    });
    expect(useGlobalAgentStore.getState().open).toBe(true);
});

test("引导按真实操作推进，助手输入和节点创建均有完成证据", async () => {
    await mount("/");
    expect(host.textContent).toContain("在首页发起聊天");
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "下一步")).toBe(false);
    await act(async () => reportWorkspaceOnboardingAction("node-created"));
    expect(host.textContent).toContain("在首页发起聊天");
    await act(async () => reportWorkspaceOnboardingAction("home-submitted"));
    expect(host.textContent).toContain("新建画布");
    await click("前往项目");
    expect(router.state.location.pathname).toBe("/canvas");
    await act(async () => {
        reportWorkspaceOnboardingAction("canvas-created");
        await router.navigate("/canvas/one");
    });
    expect(host.textContent).toContain("打开画布助手");
    await act(async () => useGlobalAgentStore.getState().openAgent());
    expect(host.textContent).toContain("试着向助手提问");
    expect([...host.querySelectorAll("button")].find((button) => button.textContent === "继续")?.disabled).toBe(true);
    await act(async () => {
        const input = host.querySelector<HTMLTextAreaElement>('[aria-label="Agent 输入"]')!;
        input.value = "帮我设计一个镜头";
        input.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
    await click("继续");
    expect(host.textContent).toContain("添加一个节点");
    await act(async () => useGlobalAgentStore.getState().closeAgent());
    await act(async () => reportWorkspaceOnboardingAction("node-created"));
    expect(host.textContent).toContain("已操作 5 项");
    await click("完成");
    expect(JSON.parse(records.get(`new-user:${WORKSPACE_ONBOARDING_KEY}`)!).status).toBe("completed");
});

test("跳过单步不算完成，可退出重启并按账号隔离", async () => {
    await mount("/");
    await click("跳过此步");
    expect(host.textContent).toContain("新建画布");
    expect(JSON.parse(records.get(`new-user:${WORKSPACE_ONBOARDING_KEY}`)!).skipped).toEqual([0]);
    await click("退出引导");
    expect(JSON.parse(records.get(`new-user:${WORKSPACE_ONBOARDING_KEY}`)!).status).toBe("dismissed");
    await click("新手引导");
    expect(host.textContent).toContain("在首页发起聊天");
    await act(async () => {
        useUserStore.getState().setUser({ id: "another", username: "another", displayName: "another", role: "user", status: "active", createdAt: "2025-01-01T00:00:00Z" });
    });
    expect(host.textContent).not.toContain("在首页发起聊天");
    expect(host.textContent).toContain("新手引导");
    expect(records.has(`another:${WORKSPACE_ONBOARDING_KEY}`)).toBe(false);
});

test("首页发起 Agent 后仍可练习从项目列表新建画布", async () => {
    await mount("/");
    await act(async () => {
        reportWorkspaceOnboardingAction("home-launch");
        await router.navigate("/canvas/from-chat");
    });
    expect(host.textContent).toContain("刚才的聊天已自动创建画布");
    const progress = JSON.parse(records.get(`new-user:${WORKSPACE_ONBOARDING_KEY}`)!);
    expect(progress.completed).toEqual([0]);
    expect(progress.homeLaunchCanvas).toBe(true);
    expect(progress.skipped).toEqual([]);
});

test("页面切换期间的操作信号可恢复且不会重复计入", async () => {
    records.set(`new-user:${WORKSPACE_ONBOARDING_KEY}`, JSON.stringify({ version: 2, step: 0, status: "active", completed: [], skipped: [] }));
    dom.sessionStorage.setItem("workspace-onboarding-actions:new-user", JSON.stringify([{ id: "launch", action: "home-launch" }]));
    await mount("/canvas/from-chat");
    expect(host.textContent).toContain("刚才的聊天已自动创建画布");
    expect(JSON.parse(records.get(`new-user:${WORKSPACE_ONBOARDING_KEY}`)!).completed).toEqual([0]);
    expect(JSON.parse(dom.sessionStorage.getItem("workspace-onboarding-actions:new-user")!)).toEqual([]);
});

test("新用户判定及损坏的进度不会产生无效步骤", () => {
    const now = Date.parse("2026-11-09T00:00:00Z");
    expect(isNewWorkspaceUser("2026-11-08T00:00:00Z", now)).toBe(true);
    expect(isNewWorkspaceUser("2026-10-01T00:00:00Z", now)).toBe(false);
    expect(isNewWorkspaceUser(undefined, now)).toBe(false);
    expect(parseWorkspaceOnboarding('{"version":2,"step":99,"status":"active","completed":[],"skipped":[]}')).toBeNull();
    expect(parseWorkspaceOnboarding('{"version":1,"step":1,"status":"completed"}')?.status).toBe("completed");
});
