/*
  智能 Shake 杯 · ESP32 / ESP32-C3 上报程序（Arduino 框架）

  第一次用：FAKE_SENSORS 保持 1，什么传感器都不用接，先把板子烧好、连上热点，
  打开网站点右上角“杯子”填同一个设备 ID，能看到“在线”就说明整条链路通了。
  板子会循环发一段假的摇酒过程（静止 2 秒 → 摇 12 秒、温度从 22 ℃ 降到 -3 ℃ → 放下 5 秒）。
  接好真传感器后改成 0。

  做的事：连 WiFi → 连 MQTT 服务器 → 每 100 ms 发一帧 JSON 到 shakecup/<设备ID>/data。
  网页（微醺练习室）订阅同一个主题，收到后实时显示和打分。格式见《接口说明.md》。

  需要的库（Arduino 库管理器里搜）：
    - PubSubClient（Nick O'Leary）
    - MAX31865（PT100 测温）：不用装库，程序里直接用 SPI 读，见 rtdBegin() / readTemps()，按实际接线改引脚。
    - IMU 用各自的库，比如 MPU6050 装 Adafruit MPU6050，在 readAccel() / readGyro() 里补上。

  两种发法（SEND_RAW_ACC 切换）：
    1  发原始加速度，网页自己算节奏和幅度（推荐，改算法不用重新烧录）
    0  板子上算好节奏 hz 和幅度 amp 再发
  SEND_GYRO = 1 时再加发陀螺仪（°/s），网页上的 3D 杯子转得快时也能跟上；只发加速度也能看出倾斜和来回。

  装传感器的方向：网页会在杯子竖直静止半秒时自动把那一刻当作“竖直”，所以芯片怎么贴都行，
  但最好让芯片的某一根轴和杯子长轴平行，这样来回的动作最清楚。
*/
#include <WiFi.h>
#include <PubSubClient.h>

// ======== 按实际情况改 ========
const char* WIFI_SSID   = "手机热点名";        // 学校网络连不上，用手机热点；ESP32 只支持 2.4 GHz，iPhone 要打开“最大兼容性”
const char* WIFI_PASS   = "密码";
const char* MQTT_HOST   = "broker.emqx.io";   // 和网页填的是同一台服务器（网页用 wss 端口，板子用 1883）
const uint16_t MQTT_PORT = 1883;
const char* MQTT_USER   = "";                 // 公共测试服务器留空
const char* MQTT_PASS   = "";
const char* DEVICE_ID   = "cup-01";           // 网页里填一样的。公共服务器谁都能订阅，建议改成不容易撞名的，如 hkustgz-roki-01
#define SEND_RAW_ACC 1
#define SEND_GYRO 1                           // 1 = 加发陀螺仪（要 SEND_RAW_ACC 也是 1）
#define FAKE_SENSORS 1                        // 1 = 不接传感器，发模拟数据；接好传感器后改 0
const int LED_PIN = 8;                        // 板载灯：C3 SuperMini 是 GPIO8（低电平亮）；没有或不确定就填 -1
#define LOW_TX_POWER 1                        // C3 SuperMini 这类小板天线差，满功率反而连不上 WiFi，降功率更稳
// =============================

const uint16_t ACC_HZ   = 50;                 // 加速度采样率
const uint16_t FRAME_MS = 100;                // 每 100 ms 发一帧（10 帧/秒）
const uint8_t  ACC_PER_FRAME = ACC_HZ * FRAME_MS / 1000;   // = 5

WiFiClient net;
PubSubClient mqtt(net);
char topicData[64], topicStatus[64];
uint32_t seq = 0;

// ---------- 传感器：按实际芯片改这两个函数 ----------
// 三路 PT100，单位 ℃。读不到或明显异常就填 NAN，网页会自动跳过这一路。
#if FAKE_SENSORS
// 模拟一段摇酒：周期 19 秒
float fakePhase() { return (millis() % 19000) / 1000.0f; }
void readTemps(float out[3]) {
  float t = fakePhase(), temp = 22;
  if (t >= 2 && t < 14) temp = 22 - 25 * (1 - expf(-(t - 2) / 4.5f)) / (1 - expf(-12 / 4.5f));
  else if (t >= 14) temp = -3;
  out[0] = temp; out[1] = temp + 0.2f; out[2] = temp - 0.1f;
}
// 模拟的杯子：传感器 z 轴是杯子长轴。摇的时候 1 秒内倒向 55°，沿长轴 3 Hz、约 14 cm 来回
float fakeTilt(float t) {
  if (t < 2 || t >= 15) return 0;
  float k = t < 3 ? (t - 2) : t > 14 ? (15 - t) : 1;
  return k * 55 * PI / 180;
}
void readAccel(float a[3]) {
  float t = fakePhase(), th = fakeTilt(t);
  bool shaking = t >= 2 && t < 14;
  float s = shaking ? 5.0f * sinf(2 * PI * 3.0f * millis() / 1000.0f) : 0;
  a[0] = 0; a[1] = sinf(th); a[2] = cosf(th) + s;
}
void readGyro(float g[3]) {                   // °/s
  float t = fakePhase();
  g[0] = (fakeTilt(t + 0.01f) - fakeTilt(t)) / 0.01f * 180 / PI; g[1] = 0; g[2] = 0;
}
#else
// ---------- 三路 MAX31865（PT100），连续转换模式 ----------
// 为什么不用 Adafruit 库的 temperature()：它每读一次都要先开偏置电流等 10 ms、再等一次转换 65 ms，
// 这 75 ms 里程序停着，什么也干不了；三路就是 225 ms，超过了每 100 ms 发一帧的节拍，
// 加速度也采不到。这里让芯片自己一直转换（50 Hz 滤波下每 20 ms 出一个新值），
// 程序要用时直接读结果寄存器，三路加起来不到 0.1 ms。不用装 Adafruit MAX31865 库。
#include <SPI.h>
const int RTD_CS[3] = {10, 3, 1};               // 三个模块的 CS 引脚，按实际接线改；没接的那路填 -1
const int SPI_SCK = 6, SPI_MISO = 2, SPI_MOSI = 7; // 和《硬件接入指南》里建议的接法一致
const float RTD_R0  = 100.0f;                    // PT100 填 100，PT1000 填 1000
const float RTD_REF = 430.0f;                    // 模块上的参考电阻：Adafruit PT100 板 430，PT1000 板 4300（看板子上的丝印）
const bool  RTD_3WIRE = false;                   // 3 线 PT100 填 true（模块上的跳线也要按说明改）
SPISettings rtdSpi(1000000, MSBFIRST, SPI_MODE1); // MAX31865 用 SPI 模式 1

uint8_t rtdConfig() { return 0x80 | 0x40 | (RTD_3WIRE ? 0x10 : 0) | 0x01; }   // 偏置开 + 自动转换 + 50 Hz 滤波
void rtdWrite(int cs, uint8_t reg, uint8_t v) {
  SPI.beginTransaction(rtdSpi); digitalWrite(cs, LOW);
  SPI.transfer(reg | 0x80); SPI.transfer(v);
  digitalWrite(cs, HIGH); SPI.endTransaction();
}
uint16_t rtdRead16(int cs, uint8_t reg) {
  SPI.beginTransaction(rtdSpi); digitalWrite(cs, LOW);
  SPI.transfer(reg & 0x7F); uint16_t v = (uint16_t)SPI.transfer(0) << 8; v |= SPI.transfer(0);
  digitalWrite(cs, HIGH); SPI.endTransaction();
  return v;
}
void rtdBegin() {
  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI);
  for (int k = 0; k < 3; k++) {
    if (RTD_CS[k] < 0) continue;
    pinMode(RTD_CS[k], OUTPUT); digitalWrite(RTD_CS[k], HIGH);
    rtdWrite(RTD_CS[k], 0x00, rtdConfig() | 0x02);   // 写配置，顺便清掉故障标志
  }
  delay(100);                                      // 等第一次转换完成（只在开机时等这一次）
}
// 电阻 → 温度（Callendar–Van Dusen 公式；0 ℃ 以下用多项式近似，-30 ℃ 以内误差远小于 0.1 ℃）
float rtdToC(float r) {
  const float A = 3.9083e-3f, B = -5.775e-7f;
  float t = (-A + sqrtf(A * A - 4 * B * (1 - r / RTD_R0))) / (2 * B);
  if (t >= 0) return t;
  float x = r / RTD_R0 * 100, x2 = x * x, x3 = x2 * x, x4 = x3 * x, x5 = x4 * x;
  return -242.02f + 2.2228f * x + 2.5859e-3f * x2 - 4.8260e-6f * x3 - 2.8183e-8f * x4 + 1.5243e-10f * x5;
}
void readTemps(float out[3]) {
  for (int k = 0; k < 3; k++) {
    out[k] = NAN;
    if (RTD_CS[k] < 0) continue;
    uint16_t raw = rtdRead16(RTD_CS[k], 0x01);     // RTD 结果寄存器，最低位是故障标志
    if (raw & 1) {                                 // 断线、短路等：这一路报 NAN，网页自动跳过；清掉故障，下次再试
      rtdWrite(RTD_CS[k], 0x00, rtdConfig() | 0x02);
      continue;
    }
    raw >>= 1;
    if (raw == 0 || raw == 0x7FFF) continue;       // 全 0 / 全 1：模块没接上或 SPI 接线不对
    out[k] = rtdToC(raw * RTD_REF / 32768.0f);
  }
}
// 加速度，单位 g（1 g ≈ 9.81 m/s²）。轴的方向无所谓，网页会自动挑起伏最大的轴。
void readAccel(float a[3]) {
  // 例：Adafruit MPU6050
  //   sensors_event_t acc, gyro, tmp; mpu.getEvent(&acc, &gyro, &tmp);
  //   a[0] = acc.acceleration.x / 9.81; a[1] = acc.acceleration.y / 9.81; a[2] = acc.acceleration.z / 9.81;
  a[0] = 0; a[1] = 0; a[2] = 1;
}
// 角速度，单位 °/s。和 readAccel 用同一颗芯片、同一套轴。
void readGyro(float g[3]) {
  // 例：Adafruit MPU6050（getEvent 给的是 rad/s，要乘 57.2958）
  //   g[0] = gyro.gyro.x * 57.2958; g[1] = gyro.gyro.y * 57.2958; g[2] = gyro.gyro.z * 57.2958;
  //   （可以和 readAccel 共用一次 getEvent，把结果存在全局变量里）
  g[0] = 0; g[1] = 0; g[2] = 0;
}
#endif
int readBatteryPercent() { return -1; }       // 没接电量检测就返回 -1
// ---------------------------------------------------

void led(bool on) { if (LED_PIN >= 0) digitalWrite(LED_PIN, on ? LOW : HIGH); }   // SuperMini 板载灯低电平亮

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  WiFi.setSleep(false);                       // 关掉 WiFi 省电：开着时板子每隔一阵才醒来收发一次，数据会一批一批地晚到
#if LOW_TX_POWER
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
#endif
  Serial.printf("WiFi 连接中（%s）", WIFI_SSID);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(250); Serial.print("."); led(i % 2); }
  if (WiFi.status() == WL_CONNECTED) Serial.printf(" 已连上，IP %s，信号 %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  else Serial.println(" 失败，稍后重试。检查：热点名和密码、是不是 2.4 GHz、iPhone 有没有开“最大兼容性”");
}

void connectMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  String clientId = String("cup-") + DEVICE_ID + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  // 遗嘱消息：板子意外掉线时，服务器替它发 {"online":false}，网页马上知道
  net.setNoDelay(true);                       // 有数据马上发，不等凑满一个包（Nagle），每帧能早到几十到几百毫秒
  bool ok = mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS, topicStatus, 1, true, "{\"online\":false}");
  if (ok) {
    char buf[96];
    snprintf(buf, sizeof buf, "{\"online\":true,\"fw\":\"1.0\",\"bat\":%d}", readBatteryPercent());
    mqtt.publish(topicStatus, buf, true);
    Serial.printf("MQTT 已连上，正在往 %s 发数据。网站里设备 ID 填 %s\n", topicData, DEVICE_ID);
    led(true);
  } else {
    Serial.printf("MQTT 连接失败，状态码 %d\n", mqtt.state());
  }
}

// 简单的板载节奏/幅度估计（SEND_RAW_ACC = 0 时用）：最近 2 秒里起伏最大的轴，数过零
const int WIN = ACC_HZ * 2;
float win[WIN][3]; int winN = 0, winI = 0;
void pushWin(const float a[3]) { for (int k = 0; k < 3; k++) win[winI][k] = a[k]; winI = (winI + 1) % WIN; if (winN < WIN) winN++; }
void estimate(float &hz, float &ampCm) {
  hz = 0; ampCm = 0; if (winN < ACC_HZ) return;
  float bestRms = 0; int bestK = 0; float mean[3] = {0, 0, 0};
  for (int k = 0; k < 3; k++) {
    for (int i = 0; i < winN; i++) mean[k] += win[i][k];
    mean[k] /= winN;
    float s = 0; for (int i = 0; i < winN; i++) { float d = win[i][k] - mean[k]; s += d * d; }
    float rms = sqrtf(s / winN); if (rms > bestRms) { bestRms = rms; bestK = k; }
  }
  if (bestRms < 0.15f) return;
  int cross = 0; int start = (winI - winN + WIN) % WIN;
  float prev = win[start][bestK] - mean[bestK];
  for (int j = 1; j < winN; j++) {
    float d = win[(start + j) % WIN][bestK] - mean[bestK];
    if ((prev < 0) != (d < 0)) cross++;
    prev = d;
  }
  hz = cross / 2.0f / (winN / (float)ACC_HZ);
  float w = 2 * PI * hz;
  if (hz > 0.3f) ampCm = bestRms * 1.4142f * 9.81f / (w * w) * 100.0f;
}

void setup() {
  Serial.begin(115200);
  delay(1500);                                // C3 的 USB 串口要等电脑认出来，不然开头几行看不到
  if (LED_PIN >= 0) { pinMode(LED_PIN, OUTPUT); led(false); }
  Serial.println("\n智能 Shake 杯启动" + String(FAKE_SENSORS ? "（模拟传感器）" : ""));
  snprintf(topicData, sizeof topicData, "shakecup/%s/data", DEVICE_ID);
  snprintf(topicStatus, sizeof topicStatus, "shakecup/%s/status", DEVICE_ID);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(1024);                   // 默认 256 字节装不下带原始加速度的一帧
  mqtt.setKeepAlive(10);
#if !FAKE_SENSORS
  rtdBegin();                                 // 三路 MAX31865
  // 加速度计也在这里初始化，比如 mpu.begin();
#endif
  connectWiFi();
  connectMqtt();
}

float accBuf[ACC_PER_FRAME][3]; float gyroBuf[ACC_PER_FRAME][3]; uint8_t accN = 0;
// 延迟诊断：读温度、发一帧各用了多少毫秒，随数据发出去，调试台上能看到
uint32_t lastReadMs = 0, lastPubMs = 0, skipFrames = 0;
uint32_t statFrames = 0, statSkipped = 0, statMaxPub = 0, statMaxRead = 0, statFrom = 0;
uint32_t nextAcc = 0, nextFrame = 0, lastRetry = 0;

void loop() {
  uint32_t now = millis();
  if ((WiFi.status() != WL_CONNECTED || !mqtt.connected()) && now - lastRetry > 2000) {
    lastRetry = now; led(false); connectWiFi(); connectMqtt();
  }
  mqtt.loop();

  // 50 Hz 采加速度
  if ((int32_t)(now - nextAcc) >= 0) {
    nextAcc = now + 1000 / ACC_HZ;
    float a[3], g[3] = {0, 0, 0}; readAccel(a); pushWin(a);
#if SEND_GYRO
    readGyro(g);
#endif
    if (accN < ACC_PER_FRAME) { for (int k = 0; k < 3; k++) { accBuf[accN][k] = a[k]; gyroBuf[accN][k] = g[k]; } accN++; }
  }

  // 每 100 ms 打包发一帧
  if ((int32_t)(now - nextFrame) >= 0) {
    nextFrame = now + FRAME_MS;
    uint32_t r0 = millis();
    float t[3]; readTemps(t);
    lastReadMs = millis() - r0;
    String j; j.reserve(768);
    j += "{\"v\":1,\"seq\":"; j += seq++;
    j += ",\"ms\":"; j += now;
    j += ",\"temp\":[";
    for (int k = 0; k < 3; k++) { if (k) j += ","; j += isnan(t[k]) ? String("null") : String(t[k], 2); }
    j += "]";
#if SEND_RAW_ACC
    j += ",\"acc_hz\":"; j += ACC_HZ; j += ",\"acc\":[";
    for (int i = 0; i < accN; i++) {
      if (i) j += ",";
      j += "["; j += String(accBuf[i][0], 3); j += ","; j += String(accBuf[i][1], 3); j += ","; j += String(accBuf[i][2], 3); j += "]";
    }
    j += "]";
#if SEND_GYRO
    j += ",\"gyro\":[";
    for (int i = 0; i < accN; i++) {
      if (i) j += ",";
      j += "["; j += String(gyroBuf[i][0], 1); j += ","; j += String(gyroBuf[i][1], 1); j += ","; j += String(gyroBuf[i][2], 1); j += "]";
    }
    j += "]";
#endif
#else
    float hz, ampCm; estimate(hz, ampCm);
    j += ",\"hz\":"; j += String(hz, 2); j += ",\"amp\":"; j += String(ampCm, 1);
#endif
    int bat = readBatteryPercent(); if (bat >= 0) { j += ",\"bat\":"; j += bat; }
    j += ",\"rd\":"; j += lastReadMs; j += ",\"pub\":"; j += lastPubMs;
    j += "}";
    accN = 0;
    // 网络堵了（上一帧发了很久）就跳过几帧，让积压的数据先走掉。
    // 实时显示宁可少几帧，也不要一直显示几秒前的动作。
    if (skipFrames) { skipFrames--; statSkipped++; }
    else if (mqtt.connected()) {
      uint32_t p0 = millis();
      mqtt.publish(topicData, j.c_str());
      lastPubMs = millis() - p0;
      if (lastPubMs > 60) skipFrames = lastPubMs / FRAME_MS + 1;
      statFrames++;
    }
    statMaxPub = max(statMaxPub, lastPubMs); statMaxRead = max(statMaxRead, lastReadMs);
    if (now - statFrom >= 5000) {              // 每 5 秒在串口打印一次，接电脑看
      Serial.printf("[5秒] 发出 %u 帧，跳过 %u 帧；发一帧最长 %u ms，读温度最长 %u ms，WiFi 信号 %d dBm\n",
                    statFrames, statSkipped, statMaxPub, statMaxRead, WiFi.RSSI());
      statFrames = statSkipped = statMaxPub = statMaxRead = 0; statFrom = now;
    }
  }
}
