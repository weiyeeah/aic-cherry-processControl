#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
语音工作流程测试脚本
测试完整的语音识别工作流程，包括前端按钮控制和Python后端服务
"""

import time
import requests
import json
import sys

def test_cherry_studio_api():
    """测试Cherry Studio Voice API"""
    print("🔍 测试Cherry Studio Voice API...")
    
    try:
        # 测试状态查询
        response = requests.get('http://127.0.0.1:8765/voice/status', timeout=5)
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Cherry Studio API 状态: 接收{'启用' if result.get('enabled') else '禁用'}")
            return True
        else:
            print(f"❌ Cherry Studio API 不可用: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Cherry Studio API 连接失败: {e}")
        return False

def test_python_backend():
    """测试Python后端服务"""
    print("🔍 测试Python语音后端服务...")
    
    try:
        # 测试状态查询
        response = requests.post('http://127.0.0.1:8766/voice/status', timeout=5)
        if response.status_code == 200:
            result = response.json()
            status = result.get('status', 'unknown')
            print(f"✅ Python后端服务状态: {status}")
            return True
        else:
            print(f"❌ Python后端服务不可用: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Python后端服务连接失败: {e}")
        return False

def toggle_cherry_studio_voice():
    """切换Cherry Studio语音接收状态"""
    print("🎤 切换Cherry Studio语音接收状态...")
    
    try:
        response = requests.post('http://127.0.0.1:8765/voice/toggle', timeout=5)
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                enabled = result.get('enabled')
                print(f"✅ Cherry Studio语音接收: {'启用' if enabled else '禁用'}")
                return enabled
        print(f"❌ 切换失败: {response.status_code}")
        return None
    except Exception as e:
        print(f"❌ 切换失败: {e}")
        return None

def control_python_backend(action):
    """控制Python后端服务"""
    print(f"🎙️ {action}Python后端语音识别...")
    
    try:
        data = {
            "action": "start" if action == "启动" else "stop",
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%S.000Z'),
            "targetUrl": "http://127.0.0.1:8765/voice"
        }
        
        response = requests.post(
            'http://127.0.0.1:8766/voice/control',
            json=data,
            headers={'Content-Type': 'application/json'},
            timeout=5
        )
        
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                print(f"✅ Python后端: {result.get('message')}")
                return True
        print(f"❌ 控制失败: {response.status_code}")
        return False
    except Exception as e:
        print(f"❌ 控制失败: {e}")
        return False

def simulate_voice_input():
    """模拟发送语音输入"""
    print("💬 模拟发送语音文字...")
    
    test_messages = [
        "你好，",
        "你好，这是",
        "你好，这是语音",
        "你好，这是语音识别",
        "你好，这是语音识别测试"
    ]
    
    for i, message in enumerate(test_messages):
        try:
            response = requests.post(
                'http://127.0.0.1:8765/voice',
                data=message.encode('utf-8'),
                headers={
                    'Content-Type': 'text/plain; charset=utf-8',
                    'X-Voice-Streaming': 'true'
                },
                timeout=5
            )
            
            if response.status_code == 200:
                print(f"  📝 发送: {message}")
            else:
                print(f"  ❌ 发送失败: {response.status_code}")
            
            time.sleep(0.5)  # 模拟识别间隔
            
        except Exception as e:
            print(f"  ❌ 发送失败: {e}")

def main():
    print("🚀 Cherry Studio 语音工作流程测试")
    print("=" * 50)
    
    # 检查服务状态
    cherry_ok = test_cherry_studio_api()
    python_ok = test_python_backend()
    
    if not cherry_ok:
        print("\n❌ Cherry Studio API 不可用，请确保 Cherry Studio 正在运行")
        return
    
    if not python_ok:
        print("\n❌ Python后端服务不可用，请先启动: python voice-backend-service.py")
        return
    
    print("\n✅ 所有服务都已就绪")
    
    # 测试完整工作流程
    print("\n" + "=" * 50)
    print("🎯 开始测试完整工作流程")
    
    # 1. 启用Cherry Studio语音接收
    enabled = toggle_cherry_studio_voice()
    if enabled is None:
        print("❌ 无法启用Cherry Studio语音接收")
        return
    
    if enabled:
        # 2. 启动Python后端语音识别
        if control_python_backend("启动"):
            print("\n⏳ 等待3秒，然后模拟语音输入...")
            time.sleep(3)
            
            # 3. 模拟语音输入
            simulate_voice_input()
            
            print("\n⏳ 等待5秒，然后停止语音识别...")
            time.sleep(5)
            
            # 4. 停止Python后端语音识别
            control_python_backend("停止")
        
        # 5. 禁用Cherry Studio语音接收
        print("\n🔄 禁用Cherry Studio语音接收...")
        toggle_cherry_studio_voice()
    
    print("\n" + "=" * 50)
    print("✅ 测试完成")
    print("\n📝 如果一切正常，您应该能在Cherry Studio输入框中看到:")
    print("   '你好，这是语音识别测试'")

if __name__ == '__main__':
    main()