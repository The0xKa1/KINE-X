# KINE//X 服务器开发与演示 Cheatsheet

> AutoDL 实例上的完整工作流：连接、开发、构建、演示。黑客松（7.21–23）期间照此操作。

## 一、服务器信息

| 项目 | 值 |
|------|-----|
| SSH | `ssh -p 24060 root@connect.westc.seetacloud.com`（密码见 AutoDL 控制台实例页） |
| 免密密钥（本机 Mac） | `/Users/zhangjinkai/KINE-X/.deploy-tmp/autodl_ed25519` |
| GPU | vGPU-32GB（RTX 4080 SUPER 级），¥1.68/时，按秒计费 |
| 项目目录 | `/root/KINE-X` |
| 一键启动服务 | `bash /root/start_all.sh`（拉起导入后端 :8765 + 前端静态服务 :5173） |
| 磁盘 | 系统盘 30G（剩 ~25G）+ 数据盘 50G（`/root/autodl-tmp`） |

## 二、每天的开始（3 步）

```bash
# 1. AutoDL 控制台确认实例已开机；服务没起则 SSH 进去跑：
bash /root/start_all.sh

# 2. 本地 Mac 挂双端口隧道（后台常驻）
nohup ssh -i /Users/zhangjinkai/KINE-X/.deploy-tmp/autodl_ed25519 -p 24060 \
  -N -L 15173:localhost:5173 -L 18765:localhost:8765 \
  -o ServerAliveInterval=30 root@connect.westc.seetacloud.com &

# 3. 浏览器打开（backend 地址已存 localStorage，只需设一次）
open http://localhost:15173
# 首次或换浏览器时：http://localhost:15173/?backend=http://localhost:18765
```

自检：隧道是否通 → `curl -s http://localhost:18765/healthz` 应返回 `{"ok":true,"device":"cuda",...}`

## 三、在服务器上开发（推荐姿势）

```bash
ssh -p 24060 root@connect.westc.seetacloud.com
tmux new -s dev          # 防断线；重连用 tmux attach -t dev
kx                       # = cd /root/KINE-X（zsh 别名）
kimi                     # 启动 kimi-code（首次用 /login，会给 URL 到本地浏览器授权）
```

改完代码构建 + 生效：

```bash
npm run build            # 服务器上直接构建（Node v22.14 已装好）
# 浏览器刷新 http://localhost:15173 即可，无需重启静态服务
```

其他别名：`startall`（重启服务）、`backend-log`、`frontend-log`、`gpu`。

**访问 GitHub/HuggingFace 必须走 AutoDL 学术加速**（直连超时）：

```bash
gclone https://github.com/xxx/yyy.git   # 单条 clone 走代理（推荐）
turbo                                   # 当前 shell 全局开启（连续下载时用）
unturbo                                 # 用完关闭，避免 pip 等国内源变慢
```

## 四、导入视频 → 前端可见（无需回传）

1. 浏览器里走导入抽屉上传视频，或命令行：
   ```bash
   curl --noproxy '*' -F file=@视频.webm -F motion=squat -F name=My_clip \
        http://localhost:18765/import/video
   ```
2. 产物直接落在服务器 `/root/KINE-X/public/coach_clips/jobs/<jobId>/`，前端同源立即可用。
3. 想归档到本地仓库（可选）：
   ```bash
   rsync -az -e "ssh -i /Users/zhangjinkai/KINE-X/.deploy-tmp/autodl_ed25519 -p 24060" \
     root@connect.westc.seetacloud.com:/root/KINE-X/public/coach_clips/jobs/ \
     /Users/zhangjinkai/KINE-X/public/coach_clips/jobs/
   ```

## 五、本地改了代码想同步到服务器

```bash
npm run build && rsync -az --delete \
  -e "ssh -i /Users/zhangjinkai/KINE-X/.deploy-tmp/autodl_ed25519 -p 24060" \
  /Users/zhangjinkai/KINE-X/dist /Users/zhangjinkai/KINE-X/index.html \
  /Users/zhangjinkai/KINE-X/src /Users/zhangjinkai/KINE-X/public \
  --exclude 'coach_clips/jobs' \
  root@connect.westc.seetacloud.com:/root/KINE-X/
```

（在服务器上直接开发则不需要这步；两边都改时注意以服务器副本为准。）

## 六、演示当天检查清单（7.21 早上）

- [ ] 实例已开机，`bash /root/start_all.sh` 两个服务都 200/ok
- [ ] 本地隧道已挂，`curl -s http://localhost:18765/healthz` 返回 cuda
- [ ] 浏览器能打开 `http://localhost:15173`，摄像头授权正常
- [ ] 提前导入好 1–2 个演示视频，种子列表里能看到
- [ ] 账户余额 ≥ ¥30（够 18 小时）；演示期间**不要关机**
- [ ] 备选：本地前端 `npm run dev` 也能跑（本地 5173 + 隧道 18765）

## 七、费用与收工

- 用完当天：**AutoDL 控制台 → 关机**（停止 GPU 计费，磁盘保留，环境不丢）
- 实例连续关机 **15 天会被释放**，数据清空——黑客松后要么留几块钱开机一次，要么把 `jobs/` 和代码 rsync 回本地
- 参考消耗：¥1.68/时，三天全程约 ¥121；当前余额 ¥150
