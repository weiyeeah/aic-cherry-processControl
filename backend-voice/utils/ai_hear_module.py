import websocket
import threading
import json
import pyaudio
import uuid
import time
import logging
from urllib.parse import urlencode

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class RealTimeSpeechTranscriber:
    def __init__(self, appid, access_token, client_type, device_type,
                 operating_system, network_type, device_identifier, api_version,
                 app_type=None, base_url="wss://ai.csg.cn/aihear-50-249"):
        """
        初始化实时语音转写器

        参数:
            appid: 应用标识
            access_token: 访问令牌
            client_type: 客户端类型 (1-APP, 2-PC, 3-WEB)
            device_type: 设备机型
            operating_system: 操作系统
            network_type: 网络类型
            device_identifier: 设备标识符
            api_version: API版本号
            app_type: APP类型 (1-安卓, 2-iOS)，客户端类型为1时必需
            base_url: WebSocket基础URL
        """
        self.appid = appid
        self.access_token = access_token
        self.client_type = client_type
        self.app_type = app_type
        self.device_type = device_type
        self.operating_system = operating_system
        self.network_type = network_type
        self.device_identifier = device_identifier
        self.api_version = api_version
        self.base_url = base_url

        # 生成客户端UUID
        self.client_uuid = str(uuid.uuid4())

        # WebSocket连接
        self.ws = None
        self.is_connected = False

        # 音频参数
        self.audio_format = pyaudio.paInt16
        self.channels = 1  # 单声道
        self.rate = 16000  # 采样率16kHz
        self.chunk_size = 4096  # 每包字节数

        # PyAudio实例和流
        self.p = None
        self.stream = None

        # 转写结果回调
        self.on_transcription_callback = None

    def connect(self):
        """建立WebSocket连接"""
        # 构建请求头
        headers = {
            "appid": self.appid,
            "access-token": self.access_token,
            "client-type": str(self.client_type),
            "device-type": self.device_type,
            "operating-system": self.operating_system,
            "network-type": self.network_type,
            "device-identifier": self.device_identifier,
            "api-version": self.api_version
        }

        if self.app_type is not None:
            headers["app-type"] = str(self.app_type)

        # 构建URL参数
        params = {
            "appid": self.appid,
            "uid": self.client_uuid,
            "ack": "1",
            "pk_on": "1"
        }
        params_str = urlencode(params)

        # 构建完整URL
        url = f"{self.base_url}/app/hisee/websocket/storage/{self.client_uuid}/{params_str}"

        logger.info(f"连接WebSocket: {url}")

        # 创建WebSocket连接
        self.ws = websocket.WebSocketApp(
            url,
            header=[f"{k}: {v}" for k, v in headers.items()],
            on_open=self._on_open,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close
        )

        # 在后台线程中运行WebSocket
        self.ws_thread = threading.Thread(target=self.ws.run_forever)
        self.ws_thread.daemon = True
        self.ws_thread.start()

        # 等待连接建立
        timeout = 10
        start_time = time.time()
        while not self.is_connected and time.time() - start_time < timeout:
            time.sleep(0.1)

        if not self.is_connected:
            raise Exception("WebSocket连接超时")

        logger.info("WebSocket连接成功")

    def _on_open(self, ws):
        """WebSocket连接打开时的回调"""
        logger.info("WebSocket连接已打开")
        self.is_connected = True

    def _on_message(self, ws, message):
        """接收到WebSocket消息时的回调"""
        try:
            # 解析响应
            response = json.loads(message)

            if response.get("code") == 0:
                # 解析content字段
                content_str = response.get("content", "")
                if content_str:
                    # 尝试解析content字段中的JSON
                    try:
                        content_data = json.loads(content_str)
                    except json.JSONDecodeError:
                        # 如果content不是有效的JSON，直接使用字符串
                        content_data = content_str

                    # 处理转写结果
                    self._handle_transcription(content_data, response.get("sessionId"))
            else:
                logger.error(f"接收错误响应: {response}")

        except Exception as e:
            logger.error(f"处理消息时出错: {e}")

    def _handle_transcription(self, content_data, session_id):
        """处理转写结果"""
        # 如果是中间结果或最终结果
        if isinstance(content_data, dict) and "msgtype" in content_data:
            msgtype = content_data.get("msgtype")

            if msgtype == "sentence" or msgtype == "Progressive":
                # 提取文本
                text = self._extract_text(content_data)

                if text:
                    logger.info(f"转写结果: {text}")

                    # 如果有回调函数，调用它
                    if self.on_transcription_callback:
                        self.on_transcription_callback(text, session_id)

        # 直接输出文本内容（如果content是字符串）
        elif isinstance(content_data, str):
            logger.info(f"转写结果: {content_data}")

            if self.on_transcription_callback:
                self.on_transcription_callback(content_data, session_id)

    def _extract_text(self, content_data):
        """从content数据中提取文本"""
        text_parts = []

        # 检查是否有ws字段（词序列）
        if "ws" in content_data and isinstance(content_data["ws"], list):
            for word_segment in content_data["ws"]:
                if "cw" in word_segment and isinstance(word_segment["cw"], list):
                    for word_info in word_segment["cw"]:
                        if "w" in word_info:
                            text_parts.append(word_info["w"])

        # 如果没有提取到文本，尝试其他可能的字段
        if not text_parts and "text" in content_data:
            text_parts.append(content_data["text"])

        return "".join(text_parts) if text_parts else None

    def _on_error(self, ws, error):
        """WebSocket错误回调"""
        logger.error(f"WebSocket错误: {error}")
        self.is_connected = False

    def _on_close(self, ws, close_status_code, close_msg):
        """WebSocket关闭回调"""
        logger.info(f"WebSocket连接已关闭: {close_status_code} - {close_msg}")
        self.is_connected = False

    def start_recording(self):
        """开始录制音频并发送到服务器"""
        if not self.is_connected:
            raise Exception("WebSocket未连接")

        # 初始化PyAudio
        self.p = pyaudio.PyAudio()

        # 打开音频流
        self.stream = self.p.open(
            format=self.audio_format,
            channels=self.channels,
            rate=self.rate,
            input=True,
            frames_per_buffer=self.chunk_size
        )

        logger.info("开始录制音频...")

        # 持续录制和发送音频
        try:
            while self.is_connected:
                # 读取音频数据
                data = self.stream.read(self.chunk_size, exception_on_overflow=False)

                # 发送音频数据
                if self.is_connected:
                    try:
                        self.ws.send(data, opcode=websocket.ABNF.OPCODE_BINARY)
                    except Exception as e:
                        logger.error(f"发送音频数据时出错: {e}")
                        break
        except KeyboardInterrupt:
            logger.info("用户中断录制")
        except Exception as e:
            logger.error(f"录制音频时出错: {e}")
        finally:
            # 不在finally中自动调用stop_recording，避免递归和意外副作用
            logger.info("录制循环结束")

    def stop_recording(self):
        """停止录制但不完全清理PyAudio"""
        logger.info("停止录制音频...")

        if self.stream and self.stream.is_active():
            self.stream.stop_stream()
            self.stream.close()
            self.stream = None

        if self.ws:
            self.ws.close()
            self.ws = None

        self.is_connected = False

    def shut_down(self):
        """完全清理PyAudio资源（在程序退出时调用）"""
        if self.p:
            self.p.terminate()
            self.p = None
        logger.info("PyAudio资源已完全清理")

    def safe_stop_recording(self):
        """安全停止录制，不阻塞主线程"""
        logger.info("安全停止录制音频...")

        if self.stream and self.stream.is_active():
            self.stream.stop_stream()
            self.stream.close()
            self.stream = None

        # 不直接关闭WebSocket，而是设置标志位让循环自然退出
        self.is_connected = False

        # 延迟关闭WebSocket，避免阻塞
        def delayed_close():
            time.sleep(0.5)  # 等待一段时间确保音频发送完成
            if self.ws:
                try:
                    self.ws.close()
                except:
                    pass
                self.ws = None

        close_thread = threading.Thread(target=delayed_close)
        close_thread.daemon = True
        close_thread.start()

    def set_transcription_callback(self, callback):
        """设置转写结果回调函数"""
        self.on_transcription_callback = callback

    def run(self):
        """运行转写器（连接并开始录制）"""
        try:
            self.connect()
            self.start_recording()
        except Exception as e:
            logger.error(f"运行转写器时出错: {e}")
            # 不自动调用stop_recording，让外部代码控制


# 使用示例
if __name__ == "__main__":
    # 配置参数（需要根据实际情况修改）
    config = {
        "appid": "NWAICMCPClient",
        "access_token": "9ae014eb708e4d8899080fe80527b51e",
        "client_type": 2,  # 2-PC
        "device_type": "PC",
        "operating_system": "Windows 11",
        "network_type": "Wifi",
        "device_identifier": "NWAIC-MCP-CHERRY-1",
        "api_version": "1.0.0"
    }

    # 创建转写器实例
    transcriber = RealTimeSpeechTranscriber(**config)


    # 设置转写结果回调
    def on_transcription(text, session_id):
        print(f"接收到转写文本: {text}")
        # 这里可以添加将文本发送到其他接口的代码


    transcriber.set_transcription_callback(on_transcription)

    # 运行转写器
    try:
        transcriber.run()
    except KeyboardInterrupt:
        logger.info("程序被用户中断")
    finally:
        transcriber.stop_recording()
        # 彻底关闭（会关闭父进程）
        transcriber.shut_down()