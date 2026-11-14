/*
  智能 Shake 杯 · ESP32 上报程序（Arduino 框架）

  做的事：连 WiFi → 连 MQTT 服务器 → 每 100 ms 发一帧 JSON 到 shakecup/<设备ID>/data。
  网页（微醺练习室）订阅同一个主题，收到后实时显示和打分。格式见《接口说明.md》。

  需要的库（Arduino 库管理器里搜）：
    - PubSubClient（Nick O'Leary）
    - 传感器各自的库：比如 PT100 用 MAX31865 就装 Adafruit MAX31865，IMU 用 MPU6050 就装 Adafruit MPU6050。
      下面 readTemps() / readAccel() 两个函数里留了位置，按你们实际接的芯片改。

  两种发法（SEND_RAW_ACC 切换）：
    1  发原始加速度，网页自己算节奏和幅度（推荐，改算法不用重新烧录）
    0  板子上算好节奏 hz 和幅度 amp 再发
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
const char* DEVICE_ID   = "cup-01";           // 网页里填一样的
#define SEND_RAW_ACC 1
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
void readTemps(float out[3]) {
  // 例：MAX31865
  //   out[0] = rtd0.temperature(100.0, 430.0);
  //   if (rtd0.readFault()) { out[0] = NAN; rtd0.clearFault(); }
  out[0] = NAN; out[1] = NAN; out[2] = NAN;
}
// 加速度，单位 g（1 g ≈ 9.81 m/s²）。轴的方向无所谓，网页会自动挑起伏最大的轴。
void readAccel(float a[3]) {
  // 例：Adafruit MPU6050
  //   sensors_event_t acc, gyro, tmp; mpu.getEvent(&acc, &gyro, &tmp);
  //   a[0] = acc.acceleration.x / 9.81; a[1] = acc.acceleration.y / 9.81; a[2] = acc.acceleration.z / 9.81;
  a[0] = 0; a[1] = 0; a[2] = 1;
}
int readBatteryPercent() { return -1; }       // 没接电量检测就返回 -1
// ---------------------------------------------------

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi 连接中");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(250); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " 已连上" : " 失败，稍后重试");
}

void connectMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  String clientId = String("cup-") + DEVICE_ID + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  // 遗嘱消息：板子意外掉线时，服务器替它发 {"online":false}，网页马上知道
  bool ok = mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS, topicStatus, 1, true, "{\"online\":false}");
  if (ok) {
    char buf[96];
    snprintf(buf, sizeof buf, "{\"online\":true,\"fw\":\"1.0\",\"bat\":%d}", readBatteryPercent());
    mqtt.publish(topicStatus, buf, true);
    Serial.println("MQTT 已连上");
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
    if ((prev < 0) != (d < 0)) cross++; prev = d;
  }
  hz = cross / 2.0f / (winN / (float)ACC_HZ);
  float w = 2 * PI * hz;
  if (hz > 0.3f) ampCm = bestRms * 1.4142f * 9.81f / (w * w) * 100.0f;
}

void setup() {
  Serial.begin(115200);
  snprintf(topicData, sizeof topicData, "shakecup/%s/data", DEVICE_ID);
  snprintf(topicStatus, sizeof topicStatus, "shakecup/%s/status", DEVICE_ID);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(1024);                   // 默认 256 字节装不下带原始加速度的一帧
  mqtt.setKeepAlive(10);
  // 在这里初始化传感器：rtd0.begin(MAX31865_3WIRE); mpu.begin(); ...
  connectWiFi();
  connectMqtt();
}

float accBuf[ACC_PER_FRAME][3]; uint8_t accN = 0;
uint32_t nextAcc = 0, nextFrame = 0, lastRetry = 0;

void loop() {
  uint32_t now = millis();
  if ((WiFi.status() != WL_CONNECTED || !mqtt.connected()) && now - lastRetry > 2000) {
    lastRetry = now; connectWiFi(); connectMqtt();
  }
  mqtt.loop();

  // 50 Hz 采加速度
  if ((int32_t)(now - nextAcc) >= 0) {
    nextAcc = now + 1000 / ACC_HZ;
    float a[3]; readAccel(a); pushWin(a);
    if (accN < ACC_PER_FRAME) { for (int k = 0; k < 3; k++) accBuf[accN][k] = a[k]; accN++; }
  }

  // 每 100 ms 打包发一帧
  if ((int32_t)(now - nextFrame) >= 0) {
    nextFrame = now + FRAME_MS;
    float t[3]; readTemps(t);
    String j; j.reserve(512);
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
#else
    float hz, ampCm; estimate(hz, ampCm);
    j += ",\"hz\":"; j += String(hz, 2); j += ",\"amp\":"; j += String(ampCm, 1);
#endif
    int bat = readBatteryPercent(); if (bat >= 0) { j += ",\"bat\":"; j += bat; }
    j += "}";
    accN = 0;
    if (mqtt.connected()) mqtt.publish(topicData, j.c_str());
  }
}
