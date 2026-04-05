# 腾讯云云托管（CloudBase Run）部署说明

适用于：**微信云开发 / 腾讯云开发** 里的 **云托管（CloudBase Run）**，用仓库根目录 **Dockerfile** 构建 **Next.js standalone**，与香港 Docker 部署同一镜像逻辑。

官方文档入口：[部署方式总览](https://docs.cloudbase.net/run/deploy/deploy/introduce) · [从 Dockerfile 构建](https://docs.cloudbase.net/run/develop/builds/dockerfile)

---

## 1. 开通与地域

1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/) → 搜索 **云开发 CloudBase** 或 **云托管**。
2. 新建 **云开发环境**（若还没有）。  
3. **云托管** 构建与运行请以控制台当前可选地域为准（文档常见为 **上海**；若你账号仅开放上海，选上海即可）。  
4. 进入 **云托管** → **新建服务**。

---

## 2. 新建服务（核心参数）

| 配置项 | 建议值 |
|--------|--------|
| 部署方式 | **Git 仓库部署**（推荐）或 **本地代码上传** / **CLI** |
| 构建方式 | **Dockerfile**（根目录已有 `Dockerfile`） |
| **容器端口** | **3000**（与镜像内 `PORT=3000`、`EXPOSE 3000` 一致，必填对） |
| Dockerfile 路径 | 默认根目录 `Dockerfile` |
| 资源 | 运行态至少 **1 CPU / 2 GiB 内存** 起；若构建 OOM，在控制台提高 **构建** 资源配置或联系工单 |

连接 **GitHub** 时：授权后选择仓库 **`insanxie04/merchant-ai-reply`**（或你的 fork），分支 **`main`**，保存后会自动或手动触发构建。

---

## 3. 环境变量（控制台配置，勿提交 Git）

在云托管服务 **环境变量** 中新增（与 `.env.example` 一致）：

```env
DOUBAO_API_KEY=你的密钥
DOUBAO_MODEL_ID=ep-xxxx
# 可选：识图专用多模态接入点
# DOUBAO_VISION_MODEL_ID=ep-xxxx
# 可选：与方舟控制台区域一致
# DOUBAO_API_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
NODE_ENV=production
```

修改环境变量后，在控制台 **重新发布 / 重新部署** 使容器进程生效。

---

## 4. 构建说明

- 首次构建会执行 `npm ci` + `npm run build:docker`，**约 5～15 分钟** 属正常。  
- 构建日志可在云托管 **版本 / 部署记录** 中查看；失败时优先看是否 **内存不足** 或 **依赖安装失败**。  
- 仓库已含 `.dockerignore`，不会把 `node_modules`、`.next` 打进构建上下文。

---

## 5. 访问与域名

- 部署成功后，控制台会提供 **默认访问地址**（云托管域名），可先做联调。  
- **自有域名 + 国内用户正式访问**：需完成 **ICP 备案**，并在云托管 / 云开发中按向导 **绑定自定义域名**、配置 **HTTPS**（可配合腾讯云免费证书）。  
- 微信小程序 **`request` 合法域名**：须填已备案并配置好的 **HTTPS 域名**。

---

## 6. 与香港轻量 Docker 的差异

| 项目 | 香港轻量 | 云托管 |
|------|-----------|--------|
| 环境变量 | 服务器 `.env` + `docker compose` | 控制台环境变量 |
| 构建 | 在服务器 `docker compose build` | 平台根据 Dockerfile 构建镜像 |
| 端口 | 本机映射 `3000` | 控制台 **容器端口填 3000** |

业务代码无需为云托管单独改分支；仍用同一套 `Dockerfile` 即可。

---

## 7. 更新版本

推送代码到已绑定的 Git 分支后，在云托管触发 **重新部署**（若已开自动部署则会自动构建）。无需改镜像标签时，沿用平台「最新一次构建成功版本」上线即可。

---

## 8. 常见问题

- **502 / 服务不可用**：检查容器端口是否为 **3000**，与进程监听一致。  
- **识图报「服务未配置」**：控制台是否已配 `DOUBAO_API_KEY` 与 `DOUBAO_MODEL_ID`（或 `DOUBAO_VISION_MODEL_ID`），且已重新发布。  
- **构建失败 `JavaScript heap out of memory`**：提高构建任务内存或联系平台规格说明。

更多见：[云托管常见问题](https://cloud.tencent.com/document/faq/1243/59521)。
