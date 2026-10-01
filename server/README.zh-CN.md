# Lumencraft 联机服务器部署指南

在你的云服务器上运行这个程序，朋友们用浏览器打开你的网址就能进入同一个世界一起玩，还可以语音聊天。
服务器程序不依赖任何第三方包，只需要 Node.js。

它做这些事：

- 把游戏网页发给浏览器（朋友不用安装任何东西）
- 保存共享的世界：地形种子、所有人在主世界、下界、末地、月球和火星放置和破坏的方块、时间，以及每个玩家的背包、血量、所在维度和位置（按名字区分；在太空中的玩家记的是相对最近星球的位置）
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
| `ATRIA_API_KEY` | `llmKey` | 空 | 村民用的大模型的 API Key。留空时村民用简单的脚本对话。用一键部署时请用 `set-llm-key.sh` 设置（见下面“会说话的村民”） |
| `LLM_BASE_URL` | `llmBase` | https://api.atria-asi.ai/v1 | 大模型的地址（任何 OpenAI 兼容接口都行）。国内账号可以用 https://discovery-api.intern-ai.org.cn/v1 |
| `LLM_MODEL` | `llmModel` | Atria-Dawn-Preview | 模型名 |
| `LLM_REASONING` | `llmReasoning` | none | 思考强度 `none` / `low` / `medium` / `high`：越高越聪明但越慢，村民聊天用 `none` 就够 |
| `LLM_RPM` | `llmRpm` | 30 | 每分钟最多问大模型几次，超过的用脚本对话回答 |
| `LLM_DAILY` | `llmDaily` | 4000 | 每天最多问几次 |
| `LLM_SINGLE_PLAYER` | `llmSinglePlayer` | yes | 单人游戏（打开同一个网址玩单人模式）也能用大模型；`no` 则只有联机时才用 |

世界存档是 `server/data/world.json`，每 30 秒自动保存一次，关服时也会保存。备份时复制这个文件就行。
里面有所有被改过的方块（连同它们的朝向、开关状态、水位等）、箱子和熔炉里的东西、告示牌上的字、末影龙的战况和每个玩家的背包。
地上的掉落物不存盘，5 分钟后自动消失（和游戏里一样）。
用上面的一键脚本部署时，存档放在 `/var/lib/lumencraft/world.json`（不在程序目录里，所以更新游戏不会丢存档），
每次更新前还会自动备份一份（保留最近 5 份，文件名是 `world.json.bak-日期`）。

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

## 会说话的村民（大模型）

村民的“大脑”在服务器上：每个村民有自己的名字、性格和记忆，记得每个玩家说过的话、做过的事，会传村里的八卦、派任务、送礼物、打折、跟着人走。
大模型的 Key 只放在服务器上，不会进 GitHub，也不会发到任何人的浏览器里。没设 Key 时村民用简单的脚本对话，照样能聊天、派任务。

用一键部署的服务器上，这样设置 Key（会写到只有 root 能读的 `/etc/lumencraft/secrets.env`，然后重启游戏并问一个村民试试）：

```bash
sudo ATRIA_API_KEY=你的key bash /opt/games/lumencraft/server/deploy/set-llm-key.sh
# 国内账号的 Key：再加上 LLM_BASE_URL=https://discovery-api.intern-ai.org.cn/v1
# 去掉 Key：sudo bash /opt/games/lumencraft/server/deploy/set-llm-key.sh --remove
```

最后一行显示 `OK: the language model is answering` 就成功了。之后每次更新游戏，Key 都会保留。
村民的记忆和八卦保存在 `world.json` 的 `brain` 里，和世界一起备份。
单人游戏如果是从这个服务器的网址打开的，也会问这里的大模型（记忆存在玩家自己的浏览器里）；为了防止被滥用，每个 IP 每小时最多 120 次、每天 600 次。

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

**怪物和动物**：每个玩家的电脑负责计算自己附近的生物，再同步给附近的其他人。普通的怪物和动物在这个人离开后会消失；村民、宠物、马、船和繁殖出来的动物则由服务器保存在 `world.json` 里，交给附近的其他玩家继续计算。结构里的村民和铁傀儡整个服务器只生成一次。

**天气**：由服务器统一决定（存档里也会记住），所有人同时下雨、同时放晴。玩家在设置里把天气改成"晴天""下雨""雷暴"只影响自己。

**地形版本**：`world.json` 里记录了世界用的地形生成器版本（`gen`）。旧存档没有这一项，会一直按原来 128 格高的地形生成，已经盖好的建筑不受影响，但不会出现新的群系和结构。想换成 384 格高的新地形，需要停服后把 `world.json` 改名备份（相当于开一个新世界），再启动服务器。

**箱子、熔炉、掉落物**：这些由服务器统一管理。同一个箱子或熔炉同一时间只能一个人打开；没人打开的熔炉在服务器上继续烧（只要有人在线）；掉落物谁先走到谁拿到。
流动的水和熔岩由引起流动的那个玩家的电脑计算，结果再同步给其他人。

**提示版本不对（version）**：服务器和网页的版本要一致（现在是第 5 版协议）。更新服务器后让大家刷新网页即可。

**村民只会说简单的话**：说明没连上大模型。看 `journalctl -u lumencraft -n 50`：`the model didn't answer (HTTP 401 ...)` 是 Key 不对；`timeout` 是网络慢或连不上，国内服务器可以换成国内地址 `LLM_BASE_URL=https://discovery-api.intern-ai.org.cn/v1`（需要国内平台的 Key）。

**更新游戏**：

```bash
cd /opt/lumencraft && git pull && sudo systemctl restart lumencraft
```

如果之前打包过，更新后需要再执行一次 `npm run build`。玩家刷新网页就会用上新版本。
