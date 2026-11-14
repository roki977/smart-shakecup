#!/bin/bash
# 微醺练习室 · 本机服务器（macOS）
# 一次性启动：MQTT 服务器（Mosquitto）+ 网站。板子、这台电脑、手机都连同一个手机热点。
# 用法：在“终端”里运行  bash 本机服务器/start-mac.command   （或在访达里右键 → 打开）
# 关掉：在这个终端窗口按 Ctrl+C。

cd "$(dirname "$0")/.." || exit 1
SITE="$(pwd)"
CONF="$SITE/本机服务器/mosquitto.conf"
PORT_WEB=8765

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# 1. 找 Mosquitto，没有就用 Homebrew 装
MOSQ=""
for p in /opt/homebrew/sbin/mosquitto /usr/local/sbin/mosquitto "$(command -v mosquitto 2>/dev/null)"; do
  [ -n "$p" ] && [ -x "$p" ] && MOSQ="$p" && break
done
if [ -z "$MOSQ" ]; then
  if command -v brew >/dev/null 2>&1; then
    say "第一次用，正在安装 Mosquitto（要联网，一两分钟）…"
    brew install mosquitto || { echo "安装失败，请把上面的报错发给 Claude"; exit 1; }
    for p in /opt/homebrew/sbin/mosquitto /usr/local/sbin/mosquitto; do [ -x "$p" ] && MOSQ="$p" && break; done
  else
    say "没找到 Homebrew。先在终端运行下面这行装 Homebrew，再重新运行本脚本："
    echo '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    echo "（国内网络慢可以用镜像：https://brew.idayer.com 或搜索“Homebrew 国内镜像”）"
    exit 1
  fi
fi
command -v python3 >/dev/null 2>&1 || { say "没找到 python3。终端运行 xcode-select --install 装好后再试。"; exit 1; }

# 2. 这台电脑在热点里的 IP
IP=""
for ifc in en0 en1 en2; do IP=$(ipconfig getifaddr $ifc 2>/dev/null) && [ -n "$IP" ] && break; done
if [ -z "$IP" ]; then say "这台电脑好像没连 WiFi。先连上手机热点再运行。"; exit 1; fi

# 3. 端口被占（上次没关干净）就先关掉
for port in 1883 9001 $PORT_WEB; do
  pid=$(lsof -ti tcp:$port -sTCP:LISTEN 2>/dev/null); [ -n "$pid" ] && kill $pid 2>/dev/null
done
sleep 0.5

# 4. 启动
"$MOSQ" -c "$CONF" > /tmp/shakecup-mosquitto.log 2>&1 &
MPID=$!
python3 -m http.server $PORT_WEB --bind 0.0.0.0 > /tmp/shakecup-web.log 2>&1 &
WPID=$!
trap 'kill $MPID $WPID 2>/dev/null; echo; echo "已关闭。"; exit 0' INT TERM
sleep 1
if ! kill -0 $MPID 2>/dev/null; then say "Mosquitto 没起来："; cat /tmp/shakecup-mosquitto.log; kill $WPID; exit 1; fi
if ! kill -0 $WPID 2>/dev/null; then say "网站没起来："; cat /tmp/shakecup-web.log; kill $MPID; exit 1; fi

say "都启动好了。这个窗口别关，关了服务器就停了（Ctrl+C 关闭）。"
cat <<MSG

  ① 固件（shakecup_mqtt.ino）开头改成：
       MQTT_HOST = "$IP"      MQTT_PORT = 1883
     WiFi 填手机热点的名字和密码，重新烧录。

  ② 这台电脑打开：  http://localhost:$PORT_WEB
     手机（连同一个热点）打开：  http://$IP:$PORT_WEB
     调试台：  http://$IP:$PORT_WEB/debug.html
     网页会自动连 ws://…:9001，只要填设备 ID。

  ③ 第一次运行如果 macOS 弹出“是否允许传入连接”，选“允许”。

  热点断开重连后 IP 可能会变：重新运行本脚本，看这里的新 IP。

MSG
open "http://localhost:$PORT_WEB/debug.html" 2>/dev/null
wait
