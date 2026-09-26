# Lumencraft 联机服务器部署指南

在你的云服务器上运行这个程序，朋友们用浏览器打开你的网址就能进入同一个世界一起玩，还可以语音聊天。
服务器程序不依赖任何第三方包，只需要 Node.js。

它做这些事：

- 把游戏网页发给浏览器（朋友不用安装任何东西）
- 保存共享的世界：地形种子、所有人放置和破坏的方块、时间，以及每个玩家的背包、血量和位置（按名字区分）
- 在玩家之间转发位置、聊天和怪物，并为语音聊天牵线（语音本身是玩家之间直连的）

## 需要准备什么

| 项目 | 建议 |
|---|---|
| 云服务器 | 1 核 1 GB 内存足够 7～8 人 |
| 系统 | Ubuntu 22.04 / 24.04 或 Debian（其他 Linux 也可以） |
| 带宽 | 至少 5 Mbps。语音需要经服务器中转时，每条语音约 32 kbps |
| 域名 | 强烈建议准备一个。浏览器只允许 https 网址使用麦克风 |

> **中国大陆的服务器**：用域名走 80/443 端口必须先做 ICP 备案。没有备案时可以选择：
> 1. 用香港、新加坡等境外服务器，不需要备案，国内访问延迟也不错；
> 2. 先用 `http://服务器IP:8080` 测试。能联机、能听到别人说话，但浏览器不允许打开麦克风。

## 快速部署（一条命令）

如果你能用 SSH 连上服务器（普通电脑、Cloud Shell 都行，不需要在服务器上敲很多条命令），
仓库里带了一个一键脚本，会自动装好 Node.js、拉取代码、打包、注册成开机自启的系统服务：

```bash
git clone --branch claude/browser-minecraft-shaders-qznbst https://github.com/jackliu1138-gif/myword.git
cd myword/server/deploy
./deploy.sh 你的服务器IP ubuntu ~/.ssh/你的私钥.pem 8080
```

（腾讯云的 Ubuntu 镜像默认登录用户一般是 `ubuntu`；连不上就换成 `root` 试试。
`8080` 是游戏进程自己监听的端口，一般不用改，跟服务器上其他程序不冲突就行。）

脚本会自动检测这台服务器上有没有已经在用的"游戏中心"（一个 nginx 静态站点，首页有个游戏卡片列表）：
- **检测到了**：直接把 Lumencraft 接到那个站点已经开着的端口上（比如你原来用来放游戏的那个端口），
  路径是 `games/lumencraft/`，还会在首页自动加一张卡片。游戏进程本身只监听 `127.0.0.1:8080`（外部连不到），
  真正对外的还是那个端口，**不需要额外开放 8080，也不用改安全组**。
- **没检测到**：游戏就单独监听 `8080` 对外，这时打开 `http://你的服务器IP:8080/` 就能玩，
  但要记得去云控制台的安全组或防火墙放行 TCP 8080。

这一步全部安全可回退：改动 nginx 配置前会先备份，改完用 `nginx -t` 校验语法，
不通过就自动还原，绝不会把你原来能跑的网站弄挂；重复运行这个脚本（比如以后更新游戏）也不会重复添加。

想手动一步步来，或者要配置密码、HTTPS、语音中继，往下看。

## 第 1 步：安装 Node.js（18 或更高版本）

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node -v
```

国内网络下载慢的话，可以从 <https://npmmirror.com/mirrors/node/> 下载 Linux 版压缩包，解压后把 `bin` 目录加进 PATH。

## 第 2 步：下载游戏

```bash
sudo mkdir -p /opt/lumencraft && sudo chown $USER /opt/lumencraft
git clone https://github.com/jackliu1138-gif/myword.git /opt/lumencraft
cd /opt/lumencraft
git checkout claude/browser-minecraft-shaders-qznbst   # 合并到主分支之前需要这一步
```

GitHub 访问不了的话，可以在自己电脑上下载 ZIP，再用 `scp` 上传到服务器解压。

**可选：** 执行 `npm install && npm run build`，把游戏打包成一个文件，加载会更快。
不打包也能直接运行，服务器会发送源代码文件。

## 第 3 步：启动并测试

```bash
cd /opt/lumencraft
PASSWORD=你们的密码 SERVER_NAME=我们的世界 node server/server.mjs
```

在浏览器打开 `http://服务器IP:8080`，点"多人游戏"，地址留空，填个名字，点"加入"。
能进入就说明服务器正常。按 `Ctrl+C` 停止，停止时世界会自动保存。

如果打不开，检查云服务器的安全组或防火墙有没有放行 8080 端口。

### 所有设置

可以用环境变量设置，也可以把 `server/config.example.json` 复制成 `server/config.json` 再修改。环境变量优先。

| 环境变量 | config.json | 默认值 | 说明 |
|---|---|---|---|
| `PORT` | `port` | 8080 | 端口 |
| `PASSWORD` | `password` | 空 | 进服密码，留空则不需要密码 |
| `SERVER_NAME` | `name` | Lumencraft | 显示给玩家的服务器名 |
| `MAX_PLAYERS` | `maxPlayers` | 10 | 最多同时在线人数 |
| `SEED` | `seed` | 随机 | 世界种子，只在第一次创建世界时有用 |
| `GAME_MODE` | `mode` | survival | 新玩家的模式：`survival` 生存 / `creative` 创造 |
| `DIFFICULTY` | `difficulty` | normal | `peaceful` / `easy` / `normal` / `hard` |
| `DAY_LENGTH` | `dayLength` | 20 | 一天有多少分钟 |
| `TURN_URLS` | `turn` | 空 | 语音中继地址，见第 6 步 |
| `TURN_SECRET` | `turnSecret` | 空 | 语音中继的共享密钥，见第 6 步 |
| `STUN_URLS` | `stun` | 小米和 Google 的公共 STUN | 一般不用改 |
| `DATA_DIR` | `dataDir` | server/data | 世界存档的位置 |

世界存档是 `server/data/world.json`，每 30 秒自动保存一次，关服时也会保存。备份时复制这个文件就行。

## 第 4 步：开机自动运行（systemd）

```bash
sudo useradd --system --home /opt/lumencraft lumencraft
sudo chown -R lumencraft /opt/lumencraft
sudo cp /opt/lumencraft/server/lumencraft.service /etc/systemd/system/
sudo nano /etc/systemd/system/lumencraft.service   # 按需修改密码、名字等
sudo systemctl daemon-reload
sudo systemctl enable --now lumencraft
journalctl -u lumencraft -f                        # 查看日志：谁加入了、谁离开了
```

## 第 5 步：配置域名和 HTTPS（使用麦克风必须做）

1. 在域名服务商那里添加一条 A 记录，把 `game.你的域名.com` 指向服务器的公网 IP。
2. 安装 Caddy。它会自动申请并续期 https 证书，也会自动转发 WebSocket：

   ```bash
   sudo apt install -y caddy
   sudo cp /opt/lumencraft/server/Caddyfile.example /etc/caddy/Caddyfile
   sudo nano /etc/caddy/Caddyfile        # 把 game.example.com 改成你的域名
   sudo systemctl reload caddy
   ```

3. 在安全组里放行 TCP 80 和 443 端口。之后 8080 端口可以不用对外开放。

现在朋友们打开 `https://game.你的域名.com`，点"多人游戏"，地址留空，直接"加入"就行。

## 第 6 步：语音中继 TURN（推荐）

语音默认由玩家之间直接连接。有些网络之间没法直连，比如部分手机 4G/5G 或公司网络，这时就听不到对方。
在同一台服务器上装一个 coturn 做中转就能解决。

```bash
sudo apt install -y coturn
openssl rand -hex 24          # 生成一串随机密钥，下面两个地方要填同一串
sudo nano /etc/turnserver.conf
```

`/etc/turnserver.conf` 写入：

```
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=刚才生成的密钥
realm=game.你的域名.com
external-ip=服务器公网IP/服务器内网IP
min-port=49160
max-port=49200
no-cli
no-multicast-peers
```

云服务器上用 `ip addr` 能看到内网 IP。如果服务器直接拥有公网 IP，那一行只写公网 IP。

```bash
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable --now coturn
```

然后让游戏服务器使用这个中继。在 `lumencraft.service` 里加上：

```
Environment=TURN_URLS=turn:game.你的域名.com:3478
Environment=TURN_SECRET=刚才生成的密钥
```

执行 `sudo systemctl daemon-reload && sudo systemctl restart lumencraft`。

安全组还需要放行：**TCP 和 UDP 3478**，以及 **UDP 49160～49200**。

## 防火墙端口一览

| 端口 | 协议 | 用途 |
|---|---|---|
| 80、443 | TCP | Caddy（https 网页和联机） |
| 8080 | TCP | 游戏服务器。用了 Caddy 以后可以不对外开放 |
| 3478 | TCP + UDP | TURN 语音中继 |
| 49160～49200 | UDP | TURN 转发语音的端口范围 |

## 常见问题

**连不上服务器**：检查地址和安全组端口，并用 `journalctl -u lumencraft -f` 看服务器是否在运行。

**提示密码不对 / 名字已被使用**：同一个名字同时只能有一个人在线。换个名字，或者等之前的连接断开（最多 1 分钟）。

**听不到声音**：
- 说话的人要先打开麦克风：在暂停菜单点"开启麦克风"，或按 V 键、手柄方向键上、触屏的麦克风按钮。
- 网址必须是 `https://` 开头，否则浏览器不允许使用麦克风。
- 选了"附近语音"时，离得太远（大约 48 格以外）就听不到了。可以切换成"全员语音"。
- 有些人能听到、有些人听不到：配置第 6 步的 TURN 中继。
- 当贝投影仪之类的设备通常没有麦克风，只能听别人说话，这是正常的。

**怪物和动物**：每个玩家的电脑负责计算自己附近的生物，再同步给附近的其他人。所以一个人离开游戏后，他附近的生物也会消失。

**更新游戏**：

```bash
cd /opt/lumencraft && git pull && sudo systemctl restart lumencraft
```

如果之前打包过，更新后需要再执行一次 `npm run build`。玩家刷新网页就会用上新版本。
