#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试语音API接口的Python脚本
支持流式输入和批量发送
使用方法：
- 流式模式：python test-voice-api.py --stream
- 单次发送：python test-voice-api.py "你好，这是一条测试消息"
"""

import sys
import requests
import json
import time
import threading

def send_voice_message(message, is_streaming=False):
    """发送语音消息到Cherry Studio"""
    url = 'http://127.0.0.1:8765/voice' # 8765是Cherry Studio的Voice API端口
    
    try:
        print(f'正在发送消息到 Cherry Studio...')
        print(f'消息内容: {message}')
        print(f'目标地址: {url}')
        
        # 发送POST请求
        headers = {'Content-Type': 'text/plain; charset=utf-8'}
        if is_streaming:
            headers['X-Voice-Streaming'] = 'true'
            
        response = requests.post(
            url,
            data=message.encode('utf-8'),
            headers=headers,
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

def streaming_input():
    """流式输入模式"""
    print('进入流式输入模式...')
    print('请输入文本（按回车发送，输入 "quit" 或 "exit" 退出）：')
    
    while True:
        try:
            message = input('> ')
            if message.lower() in ['quit', 'exit', 'q']:
                print('退出流式输入模式')
                break
            elif message.strip():
                success = send_voice_message(message, is_streaming=True)
                if not success:
                    print('消息发送失败，请检查 Cherry Studio 是否正在运行')
            else:
                print('请输入有效的消息')
        except KeyboardInterrupt:
            print('\n\n通过 Ctrl+C 退出流式输入模式')
            break
        except EOFError:
            print('\n\n输入结束，退出流式输入模式')
            break

def send_word_by_word(message, delay=0.1):
    """逐字发送消息（模拟语音识别流式输出）"""
    print(f'开始逐字发送消息: "{message}"')
    words = message.split()
    current_text = ""
    
    for word in words:
        if current_text:
            current_text += " "
        current_text += word
        
        print(f'发送: {current_text}')
        success = send_voice_message(current_text, is_streaming=True)
        if not success:
            print(f'发送失败，停止在: {current_text}')
            return False
        time.sleep(delay)
    
    print('逐字发送完成')
    return True

if __name__ == '__main__':
    if len(sys.argv) > 1:
        if sys.argv[1] == '--stream':
            streaming_input()
        elif sys.argv[1] == '--word-by-word':
            # 逐字发送模式
            if len(sys.argv) > 2:
                message = ' '.join(sys.argv[2:])
                send_word_by_word(message)
            else:
                send_word_by_word('你好 这是 逐字 发送 的 测试 消息')
        else:
            # 单次发送模式
            message = ' '.join(sys.argv[1:])
            success = send_voice_message(message)
            sys.exit(0 if success else 1)
    else:
        # 默认消息
        message = '你好，这是通过Voice API发送的测试消息！'
        success = send_voice_message(message)
        sys.exit(0 if success else 1)