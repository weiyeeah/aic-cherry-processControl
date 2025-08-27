#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试语音API接口的Python脚本
使用方法：python test-voice-api.py "你好，这是一条测试消息"
"""

import sys
import requests
import json

def send_voice_message(message):
    """发送语音消息到Cherry Studio"""
    url = 'http://127.0.0.1:8765/voice'
    
    try:
        print(f'正在发送消息到 Cherry Studio...')
        print(f'消息内容: {message}')
        print(f'目标地址: {url}')
        
        # 发送POST请求
        response = requests.post(
            url,
            data=message,
            headers={'Content-Type': 'text/plain'},
            timeout=10
        )
        
        print(f'状态码: {response.status_code}')
        print(f'响应内容: {response.text}')
        
        # 解析响应
        if response.status_code == 200:
            try:
                json_response = response.json()
                if json_response.get('success'):
                    print('✅ 消息发送成功！')
                    return True
                else:
                    print(f'❌ 消息发送失败: {json_response.get("error", "未知错误")}')
                    return False
            except json.JSONDecodeError:
                print('响应不是有效的JSON格式')
                return False
        else:
            print(f'❌ HTTP错误: {response.status_code}')
            return False
            
    except requests.exceptions.ConnectionError:
        print('❌ 连接失败: 无法连接到 Cherry Studio')
        print('请确保 Cherry Studio 正在运行并且Voice API服务器已启动')
        return False
    except requests.exceptions.Timeout:
        print('❌ 请求超时')
        return False
    except Exception as e:
        print(f'❌ 请求失败: {e}')
        return False

if __name__ == '__main__':
    # 从命令行参数获取消息文本，如果没有提供则使用默认消息
    if len(sys.argv) > 1:
        message = ' '.join(sys.argv[1:])
    else:
        message = '你好，这是通过Voice API发送的测试消息！'
    
    success = send_voice_message(message)
    sys.exit(0 if success else 1)