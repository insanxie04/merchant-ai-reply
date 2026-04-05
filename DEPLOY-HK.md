# 香港轻量服务器部署（作品集 · 国内访问）

适用于：**腾讯云 / 阿里云 香港「轻量应用服务器」**，用 Docker 跑本仓库，成本多为新用户首年几十～一百多元，**无需 ICP 备案**。

---

## 1. 准备

1. 购买 **香港区域** 轻量机（1 核 2G 即可起步），系统选 **Ubuntu 22.04**。
2. 在防火墙 / 安全组放行：**22**（SSH）、**80**、**443**（若上 HTTPS）、**3000**（仅 HTTP 测试时可临时开；正式建议只开 80/443，由 Nginx 反代）。
3. 购买域名，DNS **A 记录** 指向服务器公网 IP。

---

## 2. 服务器安装 Docker

SSH 登录后执行：

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# 重新登录 SSH 使 docker 组生效
```

（可选）安装 Compose 插件后可用 `docker compose`；若仅有 `docker-compose` 旧命令，将下文 `docker compose` 改成 `docker-compose`。

---

## 3. 拉代码与环境变量

```bash
sudo mkdir -p /opt/dianping-xiaobang && sudo chown $USER:$USER /opt/dianping-xiaobang
cd /opt/dianping-xiaobang
git clone <你的仓库 HTTPS/SSH 地址> .
```

在服务器创建 **`/opt/dianping-xiaobang/.env`**（**不要提交到 Git**），内容参考仓库根目录 **`.env.example`**：

```env
DOUBAO_API_KEY=你的密钥
DOUBAO_MODEL_ID=ep-xxxx
# 可选：DOUBAO_VISION_MODEL_ID=、DOUBAO_API_BASE_URL=
```

---

## 4. 构建并启动

```bash
cd /opt/dianping-xiaobang
docker compose build
docker compose up -d
```

浏览器访问：`http://服务器公网IP:3000` 应能看到「店评小帮」。

---

## 5. HTTPS + 域名（推荐）

用 **Nginx** 反向代理到 `127.0.0.1:3000`，证书可用 **Let’s Encrypt（certbot）** 或云厂商免费证书。

**Nginx 站点示例**（域名替换为你的）：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`certbot --nginx` 按向导签 HTTPS 后，作品集里可写：**`https://your-domain.com`**。

---

## 6. 更新版本

```bash
cd /opt/dianping-xiaobang
git pull
docker compose build --no-cache
docker compose up -d
```

---

## 7. 与 Vercel 的关系

- **Vercel**：继续可当海外或备用链接。
- **香港 Docker**：给国内 HR / 用户主用，访问成功率通常更高。

本地 **`npm run dev`** 仍用 Turbopack；**Docker 内**使用 **`npm run build:docker`**（`next build`）以生成 `standalone` 镜像，与 `next.config.ts` 中 `output: "standalone"` 一致。
