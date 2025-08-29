#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
语音识别工作进程
独立运行，不影响主HTTP服务
"""

import sys
import time
import logging
import requests
import utils.ai_hear_module as ai_hear_module

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - WORKER - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def main():
    if len(sys.argv) < 2:
        print("用法: python voice_worker.py <cherry_studio_url>")
        sys.exit(1)
        
    cherry_studio_url = sys.argv[1]
    logger.info(f"语音识别工作进程启动，目标URL: {cherry_studio_url}")
    
    # 配置参数
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
    transcriber = ai_hear_module.RealTimeSpeechTranscriber(**config)
    
    def send_to_cherry_studio(text):
        """发送文字到Cherry Studio"""
        try:
            headers = {'Content-Type': 'text/plain; charset=utf-8', 'X-Voice-Streaming': 'true'}
            response = requests.post(
                cherry_studio_url,
                data=text.encode('utf-8'),
                headers=headers,
                timeout=5
            )
            if response.status_code == 200:
                logger.info(f"发送文字成功: {text}")
            else:
                logger.warning(f"发送失败: {response.status_code}")
        except Exception as e:
            logger.error(f"发送到Cherry Studio失败: {e}")
    
    # 设置转写结果回调
    def on_transcription(text, session_id):
        send_to_cherry_studio(text)
    
    transcriber.set_transcription_callback(on_transcription)
    
    try:
        logger.info("开始语音识别...")
        transcriber.run()
    except KeyboardInterrupt:
        logger.info("工作进程被中断")
    except Exception as e:
        logger.error(f"语音识别出错: {e}")
    finally:
        try:
            transcriber.stop_recording()
            logger.info("语音识别已停止")
        except:
            pass
        try:
            transcriber.shut_down()
            logger.info("资源已清理")
        except:
            pass
    
    logger.info("语音识别工作进程结束")

if __name__ == '__main__':
    main()