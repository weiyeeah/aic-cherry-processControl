#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试段落模式语音识别
验证Python后端服务的段落发送功能
"""

import time
import requests
import json

def test_paragraph_recognition():
    """测试段落模式的语音识别"""
    print("🎤 测试段落模式语音识别")
    print("=" * 50)
    
    # 检查服务状态
    try:
        print("🔍 检查Python后端服务状态...")
        response = requests.post('http://127.0.0.1:8766/voice/status', timeout=5)
        if response.status_code != 200:
            print("❌ Python后端服务不可用，请先启动: python voice-backend-service.py")
            return
        print("✅ Python后端服务正常")
    except Exception as e:
        print(f"❌ 无法连接Python后端服务: {e}")
        return
    
    try:
        print("🔍 检查Cherry Studio API状态...")
        response = requests.get('http://127.0.0.1:8765/voice/status', timeout=5)
        if response.status_code != 200:
            print("❌ Cherry Studio API不可用，请确保Cherry Studio正在运行")
            return
        print("✅ Cherry Studio API正常")
    except Exception as e:
        print(f"❌ 无法连接Cherry Studio API: {e}")
        return
    
    print("\n🚀 开始测试段落模式识别")
    
    # 启动Python后端语音识别
    try:
        print("📝 启动Python后端语音识别...")
        control_data = {
            "action": "start",
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%S.000Z'),
            "targetUrl": "http://127.0.0.1:8765/voice"
        }
        
        response = requests.post(
            'http://127.0.0.1:8766/voice/control',
            json=control_data,
            headers={'Content-Type': 'application/json'},
            timeout=5
        )
        
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                print(f"✅ {result.get('message')}")
            else:
                print(f"❌ 启动失败: {result.get('message')}")
                return
        else:
            print(f"❌ 启动失败: HTTP {response.status_code}")
            return
    except Exception as e:
        print(f"❌ 启动失败: {e}")
        return
    
    print("\n⏳ 语音识别运行中，观察以下过程:")
    print("   1. Python后端会按段落识别语音")
    print("   2. 每完成一句话会累计到当前段落")
    print("   3. Cherry Studio输入框会显示完整段落")
    print("   4. 20秒后自动停止测试")
    
    # 等待20秒观察识别过程
    for i in range(20, 0, -1):
        print(f"\r⏰ 倒计时: {i:2d}秒", end="", flush=True)
        time.sleep(1)
    
    print("\n")
    
    # 停止Python后端语音识别
    try:
        print("🛑 停止Python后端语音识别...")
        control_data = {
            "action": "stop",
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%S.000Z')
        }
        
        response = requests.post(
            'http://127.0.0.1:8766/voice/control',
            json=control_data,
            headers={'Content-Type': 'application/json'},
            timeout=5
        )
        
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                print(f"✅ {result.get('message')}")
            else:
                print(f"❌ 停止失败: {result.get('message')}")
        else:
            print(f"❌ 停止失败: HTTP {response.status_code}")
    except Exception as e:
        print(f"❌ 停止失败: {e}")
    
    print("\n" + "=" * 50)
    print("✅ 段落模式测试完成")
    print("\n📝 预期结果:")
    print("   - Cherry Studio输入框应显示完整的段落文字")
    print("   - 每个段落包含多句话，而不是逐字显示")
    print("   - 段落之间有明显的停顿和分隔")

if __name__ == '__main__':
    test_paragraph_recognition()