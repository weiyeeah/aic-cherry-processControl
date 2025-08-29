#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
语音识别后端服务 V2
使用完全隔离的设计，确保语音识别问题不会影响HTTP服务
"""

import sys
import json
import time
import threading
import requests
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import logging
import subprocess
import os

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
        self.voice_process = None  # 使用子进程而不是线程
        
    def start_voice_recognition(self):
        """开始语音识别（使用子进程）"""
        if self.is_recording:
            logger.info("语音识别已在运行中")
            return
            
        try:
            # 启动独立的语音识别子进程
            script_path = os.path.join(os.path.dirname(__file__), 'voice_worker.py')
            self.voice_process = subprocess.Popen([
                sys.executable, script_path, self.cherry_studio_url
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            
            self.is_recording = True
            logger.info(f"语音识别子进程已启动，PID: {self.voice_process.pid}")
            
        except Exception as e:
            logger.error(f"启动语音识别失败: {e}")
            self.is_recording = False
        
    def stop_voice_recognition(self):
        """停止语音识别（终止子进程）"""
        if not self.is_recording:
            logger.info("语音识别未在运行")
            return
            
        self.is_recording = False
        
        if self.voice_process:
            try:
                logger.info("正在停止语音识别子进程...")
                self.voice_process.terminate()
                
                # 等待进程结束
                try:
                    self.voice_process.wait(timeout=3)
                    logger.info("语音识别子进程已正常结束")
                except subprocess.TimeoutExpired:
                    logger.warning("子进程未在超时时间内结束，强制杀死")
                    self.voice_process.kill()
                    self.voice_process.wait()
                    
            except Exception as e:
                logger.error(f"停止语音识别时出错: {e}")
            finally:
                self.voice_process = None
                
        logger.info("语音识别已停止，HTTP服务继续运行")
        
    def get_status(self):
        """获取服务状态"""
        if self.voice_process:
            # 检查子进程是否还在运行
            poll_result = self.voice_process.poll()
            if poll_result is not None:
                # 进程已结束
                self.is_recording = False
                self.voice_process = None
                
        return {
            "is_recording": self.is_recording,
            "process_running": self.voice_process is not None,
            "process_pid": self.voice_process.pid if self.voice_process else None
        }

class VoiceControlHandler(BaseHTTPRequestHandler):
    def __init__(self, voice_service, *args, **kwargs):
        self.voice_service = voice_service
        super().__init__(*args, **kwargs)
        
    def do_OPTIONS(self):
        """处理预检请求"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
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
            try:
                self._send_error_response(500, "Internal server error")
            except:
                pass  # 即使发送错误响应失败也不影响服务
            
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
            try:
                self._send_error_response(400, "Invalid request")
            except:
                pass
            
    def _handle_voice_status(self):
        """处理状态查询请求"""
        try:
            status_info = self.voice_service.get_status()
            response = {
                "success": True,
                "status": "recording" if status_info["is_recording"] else "stopped",
                "port": self.voice_service.port,
                "target_url": self.voice_service.cherry_studio_url,
                "process_info": status_info
            }
            self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
        except Exception as e:
            logger.error(f"处理状态查询出错: {e}")
            try:
                self._send_error_response(500, "Status query failed")
            except:
                pass
        
    def _send_error_response(self, code, message):
        """发送错误响应"""
        try:
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = {"success": False, "error": message}
            self.wfile.write(json.dumps(response).encode('utf-8'))
        except Exception as e:
            logger.error(f"发送错误响应失败: {e}")
        
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