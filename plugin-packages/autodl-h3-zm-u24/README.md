# AutoDL H3 多图多音频（升级画质）

用于 9gLab 个人渠道的 `minimax_h3_zm_u24` 工作流，复用宿主的媒体上传、异步任务查询及结果持久化。

## 个人渠道配置

- Provider：AutoDL H3 多图多音频（升级画质）
- Base URL：`https://autodl.art`
- 模型：`minimax_h3_zm_u24`
- API Key：AutoDL **ComfyUI 分组**令牌。Authorization 直接传令牌，不加 Bearer。
- 默认：5 秒、768p竖；支持 1～15 秒、480p/768p 横屏、竖屏、方形。
- 必须有 1～9 张参考图，可选 0～3 段参考音频；媒体需要上游可访问的 URL。
- 工作流不提供单独的宽高比参数，也未声明音频开关、参考视频或水印开关。

## 接口合同

创建：`POST /api/v1/comfyui/comfyui_workflow/minimax_h3_zm_u24`。JSON 发送 `prompt`、`duration`、`resolution`，图片按顺序映射 `ref_image_0…8`，音频映射 `ref_audio_0…2`。

查询：`GET /api/v1/comfyui/comfyui_workflow/result/{task_id}`。读取 `data.task_id`、`data.status`、`data.results`。兼容通用文档的 `SUCCESS` 和模型示例的 `completed`。结果地址短期有效，由宿主下载保存。可选 seed 暂不暴露，使用上游随机种子。

## 价格与账户

2026-09-08 页面活动价：08:00～24:00，480p ¥0.02/秒、768p ¥0.03/秒；00:00～08:00，480p ¥0.01/秒、768p ¥0.02/秒。以 AutoDL 实际计费为准。个人渠道使用个人令牌结算，不创建平台售卖价格。

账户需实名认证才能创建令牌。没有有效令牌时只能保存配置，不能宣称真实调用已完成。

## 来源

- https://autodl.art/large-model/comfyui/minimax_h3_zm_u24
- https://autodl.art/docs/comfyui_api/
- https://autodl.art/docs/comfyui_online/
