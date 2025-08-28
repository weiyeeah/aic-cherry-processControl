#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
语音识别后端服务
接收前端控制指令，执行语音识别并发送转录文字到Cherry Studio
"""

import sys
import json
import time
import threading
import requests
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import logging

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class VoiceBackendService:
    def __init__(self, port=8766, cherry_studio_url='http://127.0.0.1:8765/voice'):
        self.port = port
        self.cherry_studio_url = cherry_studio_url
        self.is_recording = False
        self.recording_thread = None
        self.server = None
        
    def start_voice_recognition(self):
        """开始语音识别"""
        if self.is_recording:
            logger.info("语音识别已在运行中")
            return
            
        self.is_recording = True
        logger.info("开始语音识别...")
        
        # 启动语音识别线程
        self.recording_thread = threading.Thread(target=self._voice_recognition_loop)
        self.recording_thread.daemon = True
        self.recording_thread.start()
        
    def stop_voice_recognition(self):
        """停止语音识别"""
        if not self.is_recording:
            logger.info("语音识别未在运行")
            return
            
        self.is_recording = False
        logger.info("停止语音识别...")
        
        if self.recording_thread:
            self.recording_thread.join(timeout=1.0)
            
    def _voice_recognition_loop(self):
        """语音识别循环（模拟实现）"""
        logger.info("语音识别循环开始")
        
        # 模拟语音识别数据 - 按段落组织
        sample_paragraphs = [
            [
                "你好，这是语音识别的第一句话。",
                "今天天气很好，适合出门散步。",
                "希望我们的对话能够顺利进行。"
            ],
            [
                "请帮我分析一下最新的技术趋势。",
                "我想了解人工智能的发展现状。",
                "特别是在自然语言处理方面的进展。"
            ],
            [
                "能否推荐一些优秀的学习资源？",
                "我希望能够深入学习相关技术。",
                "谢谢你的帮助和建议。"
            ],
            [
                "关于未来的发展方向，",
                "我认为人工智能将会在更多领域发挥作用。",
                "这对我们的工作和生活都将产生深远影响。"
            ]
        ]
        
        paragraph_index = 0
        sentence_index = 0
        accumulated_text = ""
        
        while self.is_recording:
            try:
                # 获取当前段落
                if paragraph_index < len(sample_paragraphs):
                    current_paragraph = sample_paragraphs[paragraph_index]
                    
                    if sentence_index < len(current_paragraph):
                        sentence = current_paragraph[sentence_index]
                        
                        # 模拟语音识别过程（逐字识别但不发送）
                        logger.info(f"正在识别: {sentence}")
                        
                        # 模拟识别时间（根据句子长度调整）
                        recognition_time = len(sentence) * 0.1  # 每个字符0.1秒
                        time.sleep(recognition_time)
                        
                        # 句子识别完成，添加到累计文本
                        if accumulated_text:
                            accumulated_text += " " + sentence
                        else:
                            accumulated_text = sentence
                        
                        # 发送当前累计的段落文字到Cherry Studio
                        success = self._send_to_cherry_studio(accumulated_text, is_streaming=True)
                        if success:
                            logger.info(f"发送段落: {accumulated_text}")
                        else:
                            logger.warning("发送到Cherry Studio失败")
                        
                        sentence_index += 1
                        time.sleep(1)  # 句子间停顿
                    else:
                        # 当前段落完成，准备下一段落
                        paragraph_index += 1
                        sentence_index = 0
                        accumulated_text = ""  # 清空累计文本，开始新段落
                        time.sleep(3)  # 段落间停顿
                        logger.info("段落完成，开始下一段落...")
                else:
                    # 所有段落完成，重新开始
                    paragraph_index = 0
                    sentence_index = 0
                    accumulated_text = ""
                    time.sleep(5)  # 循环间停顿
                    logger.info("所有段落完成，重新开始...")
                    
            except Exception as e:
                logger.error(f"语音识别循环出错: {e}")
                time.sleep(1)
                
        logger.info("语音识别循环结束")
        
    def _send_to_cherry_studio(self, text, is_streaming=False):
        """发送文字到Cherry Studio"""
        try:
            headers = {'Content-Type': 'text/plain; charset=utf-8'}
            if is_streaming:
                headers['X-Voice-Streaming'] = 'true'
                
            response = requests.post(
                self.cherry_studio_url,
                data=text.encode('utf-8'),
                headers=headers,
                timeout=5
            )
            
            return response.status_code == 200
        except Exception as e:
            logger.error(f"发送到Cherry Studio失败: {e}")
            return False

class VoiceControlHandler(BaseHTTPRequestHandler):
    def __init__(self, voice_service, *args, **kwargs):
        self.voice_service = voice_service
        super().__init__(*args, **kwargs)
        
    def do_OPTIONS(self):
        """处理预检请求"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        
    def do_POST(self):
        """处理POST请求"""
        try:
            # 设置CORS头
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            # 解析URL路径
            path = urlparse(self.path).path
            
            if path == '/voice/control':
                self._handle_voice_control()
            elif path == '/voice/status':
                self._handle_voice_status()
            else:
                self._send_error_response(404, "Endpoint not found")
                
        except Exception as e:
            logger.error(f"处理请求出错: {e}")
            self._send_error_response(500, "Internal server error")
            
    def _handle_voice_control(self):
        """处理语音控制请求"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data.decode('utf-8'))
            else:
                data = {}
                
            action = data.get('action', '')
            
            if action == 'start':
                self.voice_service.start_voice_recognition()
                response = {
                    "success": True,
                    "message": "语音识别已启动",
                    "status": "recording"
                }
            elif action == 'stop':
                self.voice_service.stop_voice_recognition()
                response = {
                    "success": True,
                    "message": "语音识别已停止",
                    "status": "stopped"
                }
            else:
                response = {
                    "success": False,
                    "message": f"未知操作: {action}",
                    "status": "error"
                }
                
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            logger.info(f"语音控制请求: {action}")
            
        except Exception as e:
            logger.error(f"处理语音控制请求出错: {e}")
            self._send_error_response(400, "Invalid request")
            
    def _handle_voice_status(self):
        """处理状态查询请求"""
        response = {
            "success": True,
            "status": "recording" if self.voice_service.is_recording else "stopped",
            "port": self.voice_service.port,
            "target_url": self.voice_service.cherry_studio_url
        }
        self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
        
    def _send_error_response(self, code, message):
        """发送错误响应"""
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        response = {"success": False, "error": message}
        self.wfile.write(json.dumps(response).encode('utf-8'))
        
    def log_message(self, format, *args):
        """自定义日志格式"""
        logger.info(f"{self.address_string()} - {format % args}")

def create_handler(voice_service):
    """创建请求处理器工厂"""
    def handler(*args, **kwargs):
        return VoiceControlHandler(voice_service, *args, **kwargs)
    return handler

def main():
    # 解析命令行参数
    port = 8766
    cherry_url = 'http://127.0.0.1:8765/voice'
    
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"无效端口号: {sys.argv[1]}")
            sys.exit(1)
            
    if len(sys.argv) > 2:
        cherry_url = sys.argv[2]
    
    # 创建语音服务
    voice_service = VoiceBackendService(port=port, cherry_studio_url=cherry_url)
    
    # 创建HTTP服务器
    server = HTTPServer(('127.0.0.1', port), create_handler(voice_service))
    voice_service.server = server
    
    logger.info(f"语音后端服务启动在 http://127.0.0.1:{port}")
    logger.info(f"目标Cherry Studio地址: {cherry_url}")
    logger.info("控制端点:")
    logger.info(f"  POST http://127.0.0.1:{port}/voice/control - 控制语音识别")
    logger.info(f"  POST http://127.0.0.1:{port}/voice/status - 查询状态")
    logger.info("按 Ctrl+C 停止服务")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("接收到停止信号")
        voice_service.stop_voice_recognition()
        server.shutdown()
        logger.info("语音后端服务已停止")

if __name__ == '__main__':
    main()