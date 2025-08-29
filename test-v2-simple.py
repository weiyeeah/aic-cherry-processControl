#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简单测试V2版本基础功能
"""

import sys
import os

# 测试导入
try:
    sys.path.append('backend-voice')
    import voice_worker
    print("✅ voice_worker 导入成功")
except Exception as e:
    print(f"❌ voice_worker 导入失败: {e}")

# 测试文件路径
voice_worker_path = os.path.join('backend-voice', 'voice_worker.py')
if os.path.exists(voice_worker_path):
    print(f"✅ voice_worker.py 文件存在: {voice_worker_path}")
else:
    print(f"❌ voice_worker.py 文件不存在: {voice_worker_path}")

# 测试ai_hear_module
try:
    sys.path.append(os.path.join('backend-voice', 'utils'))
    import ai_hear_module
    print("✅ ai_hear_module 导入成功")
except Exception as e:
    print(f"❌ ai_hear_module 导入失败: {e}")

print("\n🚀 V2版本关键思路:")
print("1. 主HTTP服务只负责接收控制命令")
print("2. 语音识别在独立的子进程中运行")
print("3. 子进程崩溃不会影响主服务")
print("4. 使用subprocess.Popen管理子进程生命周期")

print("\n📋 使用步骤:")
print("1. 启动主服务: python backend-voice/voice-backend-service-v2.py")
print("2. 发送start命令启动语音识别子进程")
print("3. 发送stop命令停止子进程")
print("4. 主服务始终保持运行")