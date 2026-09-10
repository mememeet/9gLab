# AutoDL H3 接口说明

本插件使用 AutoDL ComfyUI 工作流 `minimax_h3_zm_u24`。渠道 `baseUrl` 为
`https://autodl.art`，`apiKey` 使用 ComfyUI 分组令牌，Authorization 不添加 Bearer 前缀。

创建请求包含 `prompt`、`duration`、`resolution`，按顺序映射图片和音频参考。
创建响应解析 `data.task_id`，轮询任务响应中的 `data.status`，从 `data.results` 提取视频地址。
支持 `SUCCESS` 和 `completed` 成功状态；结果由宿主持久化后用于画布播放。

详细参数、鉴权字段、校验边界及请求和响应映射以下方完整 Manifest 为准。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "autodl-h3-zm-u24",
  "name": "AutoDL H3 多图多音频（升级画质）",
  "version": "1.0.0",
  "author": "9gLab",
  "description": "接入 AutoDL minimax_h3_zm_u24，支持 1～15 秒、9 张参考图和 3 段参考音频。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "AutoDL ComfyUI Token",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "autodl-h3-zm-u24",
        "label": "AutoDL H3 多图多音频（升级画质）",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "user.custom-channel",
          "canvas",
          "creation"
        ],
        "baseUrl": "https://autodl.art",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "Authorization"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长，1 到 15 秒。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "description": "480p 或 768p 的横屏、竖屏或方形档位。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "ref_image_N",
            "description": "按顺序传入的 1 到 9 张参考图。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "mapping": "ref_audio_N",
            "description": "按顺序传入的最多 3 段参考音频。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "minimax_h3_zm_u24"
              ]
            },
            "message": "请选择 minimax_h3_zm_u24 工作流"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$len": {
                        "$ref": "request.images"
                      }
                    },
                    1
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.images"
                      }
                    },
                    9
                  ]
                }
              ]
            },
            "message": "该工作流需要 1～9 张参考图片"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                3
              ]
            },
            "message": "该工作流最多支持 3 段参考音频"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$len": {
                        "$ref": "request.prompt"
                      }
                    },
                    1
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.prompt"
                      }
                    },
                    10000
                  ]
                }
              ]
            },
            "message": "提示词需要 1～10000 个字符"
          },
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.duration"
                },
                [
                  1,
                  2,
                  3,
                  4,
                  5,
                  6,
                  7,
                  8,
                  9,
                  10,
                  11,
                  12,
                  13,
                  14,
                  15
                ]
              ]
            },
            "message": "视频时长必须为 1～15 秒的整数"
          },
          {
            "assert": {
              "$in": [
                {
                  "$lower": {
                    "$ref": "request.resolution"
                  }
                },
                [
                  "480p竖",
                  "768p竖",
                  "480p横",
                  "768p横",
                  "480p(1:1)",
                  "768p(1:1)"
                ]
              ]
            },
            "message": "请选择 480p 或 768p 的横屏、竖屏或方形分辨率"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v1/comfyui/comfyui_workflow/{{model}}",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "prompt": {
                  "$ref": "request.prompt"
                },
                "duration": {
                  "$ref": "request.duration"
                },
                "resolution": {
                  "$lower": {
                    "$ref": "request.resolution"
                  }
                }
              },
              {
                "$indexObject": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.images"
                    }
                  },
                  "as": "media",
                  "prefix": "ref_image_",
                  "max": 9,
                  "value": {
                    "$ref": "media.value"
                  }
                }
              },
              {
                "$indexObject": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.audios"
                    }
                  },
                  "as": "media",
                  "prefix": "ref_audio_",
                  "max": 3,
                  "value": {
                    "$ref": "media.value"
                  }
                }
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/api/v1/comfyui/comfyui_workflow/result/{{taskId}}"
        },
        "response": {
          "taskIdPaths": [
            "data.task_id"
          ],
          "statusPaths": [
            "data.status"
          ],
          "errorPaths": [
            "code"
          ],
          "messagePaths": [
            "data.message",
            "msg"
          ],
          "resultPaths": [
            "data.results"
          ],
          "resultKind": "video",
          "resultEphemeral": true
        }
      }
    ],
    "workflows": [
      {
        "id": "minimax_h3_zm_u24",
        "label": "H3 多图多音频（升级画质）",
        "providerId": "autodl-h3-zm-u24",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "values": [
              "1",
              "2",
              "3",
              "4",
              "5",
              "6",
              "7",
              "8",
              "9",
              "10",
              "11",
              "12",
              "13",
              "14",
              "15"
            ]
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖",
              "768p竖",
              "480p横",
              "768p横",
              "480p(1:1)",
              "768p(1:1)"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖"
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
