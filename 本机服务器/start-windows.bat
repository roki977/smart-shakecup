@echo off
chcp 65001 >nul
rem 微醺练习室 · 本机服务器（Windows）
rem 一次性启动：MQTT 服务器（Mosquitto）+ 网站。板子、这台电脑、手机都连同一个手机热点。
rem 用法：右键本文件 → 以管理员身份运行（第一次要放行防火墙）。关掉：关这个窗口。
cd /d "%~dp0.."
set "SITE=%cd%"
set "CONF=%SITE%\本机服务器\mosquitto.conf"
set "MOSQ=C:\Program Files\mosquitto\mosquitto.exe"

if not exist "%MOSQ%" (
  echo.
  echo 没找到 Mosquitto。去 https://mosquitto.org/download/ 下载 Windows 64 位安装包，
  echo 装在默认位置（C:\Program Files\mosquitto），装完再运行本文件。
  echo 也可以在 PowerShell 里运行：winget install EclipseFoundation.Mosquitto
  pause & exit /b 1
)
where python >nul 2>&1 || (
  echo 没找到 python。去 https://www.python.org/downloads/ 安装，安装时勾选 "Add python.exe to PATH"。
  pause & exit /b 1
)

rem 放行防火墙（需要管理员；已经有规则不会重复加）
netsh advfirewall firewall show rule name="shakecup-mqtt" >nul 2>&1 || netsh advfirewall firewall add rule name="shakecup-mqtt" dir=in action=allow protocol=TCP localport=1883,9001,8765 >nul 2>&1
if errorlevel 1 echo （防火墙规则没加上：如果手机、板子连不上，请右键“以管理员身份运行”本文件）

rem 这台电脑在 WiFi 里的 IP
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi*','WLAN*' -ErrorAction SilentlyContinue | Where-Object {$_.IPAddress -notlike '169.*'} | Select-Object -First 1).IPAddress"`) do set "IP=%%i"
if "%IP%"=="" (
  echo 这台电脑好像没连 WiFi。先连上手机热点再运行。
  pause & exit /b 1
)

taskkill /im mosquitto.exe /f >nul 2>&1
start "Mosquitto" /min "%MOSQ%" -c "%CONF%" -v
start "网站" /min python -m http.server 8765 --bind 0.0.0.0
timeout /t 2 >nul

echo.
echo  都启动好了。最小化的两个窗口（Mosquitto、网站）别关。
echo.
echo  1. 固件（shakecup_mqtt.ino）开头改成：
echo        MQTT_HOST = "%IP%"      MQTT_PORT = 1883
echo     WiFi 填手机热点的名字和密码，重新烧录。
echo.
echo  2. 这台电脑打开：  http://localhost:8765
echo     手机（连同一个热点）打开：  http://%IP%:8765
echo     调试台：  http://%IP%:8765/debug.html
echo     网页会自动连 ws://…:9001，只要填设备 ID。
echo.
echo  热点断开重连后 IP 可能会变：重新运行本文件，看这里的新 IP。
echo.
start "" "http://localhost:8765/debug.html"
pause
