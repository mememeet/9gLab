import { useState } from "react";
import { Alert, Button, Input } from "antd";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { startSupportLogin } from "@/services/api/support-login";
import { changeSupportIdentity, SupportLoginCloudSaveError } from "@/services/support-login-session";
import type { LocalUser } from "@/stores/use-user-store";

export function SupportLoginDialog({ user, onClose }: { user: LocalUser; onClose: () => void }) {
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<{ message: string; canContinueLocally: boolean } | null>(null);

    async function start(saveLocallyOnly = false) {
        if (!reason.trim() || busy) return;
        setBusy(true);
        setFailure(null);
        try {
            await changeSupportIdentity(() => startSupportLogin(user.id, reason.trim()), "/", false, { saveLocallyOnly });
        } catch (error) {
            setFailure({ message: error instanceof Error ? error.message : "无法开始临时代登", canContinueLocally: error instanceof SupportLoginCloudSaveError });
            setBusy(false);
        }
    }

    return (
        <AdminModal
            open
            title={`临时代登 · ${user.displayName || user.username}`}
            onCancel={() => !busy && onClose()}
            onOk={() => void start()}
            okText="开始排查"
            cancelText="取消"
            confirmLoading={busy}
            okButtonProps={{ disabled: !reason.trim() }}
            cancelButtonProps={{ disabled: busy }}
            closable={!busy}
        >
            <p className="mb-4 text-sm text-foreground/65">将以 @{user.username} 的身份进入工作区，有效期最多 6 小时，且不超过管理员当前登录的有效期。修改会保存到该用户账号，生成会使用该用户积分。排查期间不能修改登录信息、充值或使用管理员功能。</p>
            <label htmlFor="support-login-reason" className="mb-2 block text-sm">
                排查原因
            </label>
            <Input.TextArea id="support-login-reason" autoFocus rows={3} maxLength={500} showCount value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="例如：检查分镜生成视频时提示词遗漏的问题" />
            {failure && (
                <Alert
                    className="mt-4"
                    type="warning"
                    title={failure.canContinueLocally ? "当前工作区未能保存到云端" : "无法开始临时代登"}
                    description={
                        <div>
                            <p>{failure.message}</p>
                            {failure.canContinueLocally && (
                                <>
                                    <p className="mt-2">可先将未同步内容保留在当前浏览器，返回管理员后继续同步。请勿清除此浏览器的数据。</p>
                                    <Button className="mt-3" disabled={busy || !reason.trim()} onClick={() => void start(true)}>仅保存到本机并继续代登</Button>
                                </>
                            )}
                        </div>
                    }
                />
            )}
            <p className="mt-4 text-xs text-foreground/50">原密码和用户已有登录保持有效。开始、结束和写操作会记入管理操作记录。</p>
        </AdminModal>
    );
}
