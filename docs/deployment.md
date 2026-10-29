# 部署说明（Docker）

本文说明如何用 Docker 在**自己的电脑**上运行 Personal OS。你不需要懂编程，按顺序复制命令即可。

## 先分清三种运行方式

| 方式                    | 适合谁                       | 用到的文件                                                              | 状态                       |
| ----------------------- | ---------------------------- | ----------------------------------------------------------------------- | -------------------------- |
| **本地开发**            | 修改代码的开发者             | 根目录的 `docker-compose.yml`（只启动数据库）、`.env.local`、`pnpm dev` | 已有                       |
| **Docker 运行（本文）** | 想在自己电脑上长期使用的人   | `deploy/compose.yaml`、`deploy/.env`                                    | 本阶段完成并实测           |
| **正式上线（公网）**    | 想在任何地方通过网址访问的人 | 需要服务器、域名和 HTTPS                                                | **本阶段不做**，见最后一节 |

Docker 运行方式会启动四个部分，并自动按顺序启动：

1. **数据库**（PostgreSQL）：保存你的所有数据。
2. **数据库升级**：每次启动时检查并升级数据库结构，完成后自动退出。
3. **应用**：你在浏览器里打开的网站。
4. **自动化后台**：每分钟运行一次定时自动化规则和自制力逾期检查。

## 一、准备工作（只需一次）

1. 安装 **Docker Desktop**（Windows / macOS），或在 Linux 上安装 Docker Engine 和 Docker Compose。安装后打开 Docker Desktop，等它显示“正在运行”。
2. 打开“终端”（macOS：应用程序 → 实用工具 → 终端；Windows：PowerShell）。输入下面的命令，能看到版本号就说明安装好了：

   ```bash
   docker compose version
   ```

3. 下载 Personal OS 的代码（例如从 GitHub 下载 ZIP 并解压），然后在终端进入代码目录里的 `deploy` 文件夹：

   ```bash
   cd 你的路径/personal-os/deploy
   ```

## 二、填写配置

1. 复制配置模板：

   ```bash
   cp .env.example .env
   ```

2. 生成三个随机密码。下面的命令每运行一次就生成一个，请运行三次，把结果分别记下：

   ```bash
   openssl rand -hex 32
   ```

   Windows 上没有 `openssl` 时，可以在 PowerShell 里运行：
   `-join (1..64 | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })`

3. 用记事本或其他文本编辑器打开 `deploy/.env`，把所有 `change-me…` 替换掉：

   | 配置项                     | 填什么                                                            |
   | -------------------------- | ----------------------------------------------------------------- |
   | `POSTGRES_PASSWORD`        | 第 1 个随机密码（数据库密码）                                     |
   | `BETTER_AUTH_SECRET`       | 第 2 个随机密码（登录加密用）                                     |
   | `AUTOMATION_WORKER_SECRET` | 第 3 个随机密码（自动化后台用）。留空表示不运行定时自动化         |
   | `BETTER_AUTH_URL`          | 你在浏览器里打开的地址，默认 `http://localhost:3000`              |
   | `APP_PORT`                 | 端口，默认 `3000`。如果要改，`BETTER_AUTH_URL` 里的端口也要一起改 |
   | `AUTH_ALLOW_SIGNUP`        | 先保持 `true`，注册好自己的账户后改成 `false`                     |

   如果 `BETTER_AUTH_SECRET` 或 `AUTOMATION_WORKER_SECRET` 仍是 `change-me` 开头的示例值，应用会拒绝启动，并提示你换成随机值。数据库密码请同样务必替换。

> `deploy/.env` 里是你的密码，不要发给别人，也不要上传。它已经被排除在 Git 之外。

## 三、启动

在 `deploy` 文件夹里运行：

```bash
docker compose up -d --build
```

第一次启动需要下载和构建，可能要 5–15 分钟；以后每次只需要几十秒。完成后检查状态：

```bash
docker compose ps
```

正常的结果是：`app` 和 `db` 显示 `healthy`，`worker` 显示 `Up`，`migrate` 显示 `Exited (0)`。其中 `Exited (0)` 表示数据库升级已经成功完成，是正常的。

然后在浏览器里打开 <http://localhost:3000>：

1. 点“注册”，创建你自己的账户。
2. 回到 `deploy/.env`，把 `AUTH_ALLOW_SIGNUP` 改成 `false`，再运行一次 `docker compose up -d`，这样别人就不能再注册了。

## 四、日常操作

| 想做什么         | 命令（在 `deploy` 文件夹里运行）                                                              |
| ---------------- | --------------------------------------------------------------------------------------------- |
| 停止（数据保留） | `docker compose down`                                                                         |
| 再次启动         | `docker compose up -d`                                                                        |
| 查看是否正常     | `docker compose ps`，或打开 <http://localhost:3000/api/health>，看到 `{"status":"ok"}` 即正常 |
| 查看日志         | `docker compose logs app`；自动化后台的日志：`docker compose logs worker`                     |
| 更新到新版本     | 先下载新代码，再运行 `docker compose up -d --build`（数据库会自动升级）                       |

电脑重启后，只要 Docker Desktop 在运行，Personal OS 会自动启动（`restart: unless-stopped`）。

## 五、备份（重要）

你的数据保存在 Docker 的数据卷 `personal-os-deploy_pgdata` 里。`docker compose down` **不会**删除它。

> ⚠️ **不要**运行 `docker compose down -v`：`-v` 会**永久删除所有数据**。

推荐两种备份方式，最好两种都做：

1. **应用内导出**：设置 → 通用 → 导出数据 → 导出 JSON。得到一个可读的 JSON 文件，适合存档和日后迁移。
2. **完整数据库备份**，可以完整恢复：

   ```bash
   docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > personal-os-backup.dump
   ```

   恢复时先启动数据库，再导入（会覆盖同名数据，请先确认）：

   ```bash
   docker compose up -d db
   docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < personal-os-backup.dump
   docker compose up -d
   ```

请把备份文件复制到另一个地方，例如移动硬盘或你自己的云盘。

## 六、常见问题

| 现象                                                      | 处理                                                                                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set POSTGRES_PASSWORD in deploy/.env`                    | 还没有创建或填写 `deploy/.env`，见第二步                                                                                                                             |
| `migrate` 显示 `Exited (1)`                               | 运行 `docker compose logs migrate` 查看原因。常见原因是改过 `POSTGRES_PASSWORD`：数据库第一次启动时就确定了密码，之后修改 `.env` 不会改变数据库里的密码              |
| 浏览器打不开                                              | `docker compose ps` 看 `app` 是否 `healthy`；端口 3000 可能被占用，可以改 `APP_PORT` 和 `BETTER_AUTH_URL`                                                            |
| 能打开但无法登录                                          | `BETTER_AUTH_URL` 必须和浏览器地址栏里的地址完全一致（包括端口）                                                                                                     |
| 自动化页面显示“未配置后台 worker”或“后台 worker 从未运行” | `AUTOMATION_WORKER_SECRET` 为空。填入至少 32 个字符的随机值后运行 `docker compose up -d`。注意：少于 32 个字符时应用会拒绝启动，`docker compose logs app` 会给出原因 |
| 构建时出现证书错误（公司网络）                            | 把公司的根证书保存为文件，例如 `ca.crt`，然后运行 `docker build --secret id=build_ca,src=ca.crt …`。详见 `Dockerfile` 中 `build_ca` 的说明                           |

## 七、关于正式上线（本阶段不做）

当前配置只在本机监听（`127.0.0.1`），数据库不对外开放，适合在自己电脑上使用或做验证。要放到公网上，还需要以下人工步骤，本阶段都没有做：

- 一台服务器（云服务器或家用 NAS），并在上面安装 Docker；
- 一个域名，以及 **HTTPS**（例如在前面放 Caddy 或 Nginx 反向代理）。`BETTER_AUTH_URL` 要改成 `https://你的域名`；
- 防火墙只开放 80 和 443 端口；
- 定期自动备份，并且备份要存到另一台机器上；
- 关闭注册（`AUTH_ALLOW_SIGNUP=false`），并使用强密码。

上线前请再做一次检查，确认后再操作。
