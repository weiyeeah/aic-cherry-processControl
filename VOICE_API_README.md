# Cherry Studio Voice API 接口文档

## 概述

Cherry Studio 现在支持通过 HTTP API 接口接收语音消息并自动发送。该功能允许外部应用程序通过 POST 请求向 Cherry Studio 发送文本消息，模拟用户"点击发送"的操作。

## 功能特性

- ✅ HTTP 服务器监听 `127.0.0.1:8765` 端口
- ✅ 支持 `/voice` POST 端点
- ✅ 自动将接收到的文本设置到输入框并发送
- ✅ 支持 CORS 跨域请求
- ✅ 完整的错误处理和日志记录

## API 端点

### POST /voice

**URL:** `http://127.0.0.1:8765/voice`

**方法:** POST

**请求头:**
```
Content-Type: text/plain
```

**请求体:**
- 发送要输入的文本内容（字符串格式）

**响应:**

成功响应 (200):
```json
{
  "success": true,
  "message": "Voice message sent successfully",
  "receivedText": "你的消息内容"
}
```

错误响应:
- 404: 端点不存在
- 500: 内部服务器错误
- 503: 主窗口不可用

## 使用示例

### 1. 使用 curl

```bash
# 发送简单文本消息
curl -X POST http://127.0.0.1:8765/voice \
     -H "Content-Type: text/plain" \
     -d "你好，这是通过API发送的消息"

# 发送多行文本
curl -X POST http://127.0.0.1:8765/voice \
     -H "Content-Type: text/plain" \
     -d "请帮我总结一下：
今天的会议讨论了项目进度
明天需要完成代码审查"
```

### 2. 使用 JavaScript (Node.js)

```javascript
const http = require('http');

function sendVoiceMessage(message) {
  const postData = message;
  
  const options = {
    hostname: '127.0.0.1',
    port: 8765,
    path: '/voice',
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Content-Length': Buffer.byteLength(postData, 'utf8')
    }
  };

  const req = http.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => {
      responseData += chunk;
    });
    res.on('end', () => {
      console.log('响应:', JSON.parse(responseData));
    });
  });

  req.on('error', (e) => {
    console.error('请求失败:', e.message);
  });

  req.write(postData);
  req.end();
}

// 使用示例
sendVoiceMessage("你好，这是通过Node.js发送的消息");
```

### 3. 使用 Python

```python
import requests

def send_voice_message(message):
    url = 'http://127.0.0.1:8765/voice'
    
    try:
        response = requests.post(
            url,
            data=message,
            headers={'Content-Type': 'text/plain'},
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                print('消息发送成功！')
                return True
        
        print(f'发送失败: {response.text}')
        return False
        
    except requests.exceptions.ConnectionError:
        print('连接失败，请确保 Cherry Studio 正在运行')
        return False

# 使用示例
send_voice_message("你好，这是通过Python发送的消息")
```

## 测试脚本

项目根目录下提供了两个测试脚本：

### test-voice-api.js (Node.js)
```bash
# 使用默认消息测试
node test-voice-api.js

# 使用自定义消息测试
node test-voice-api.js "你好，这是自定义测试消息"
```

### test-voice-api.py (Python)
```bash
# 使用默认消息测试
python test-voice-api.py

# 使用自定义消息测试
python test-voice-api.py "你好，这是自定义测试消息"
```

## 技术实现

### 架构概述

1. **主进程 (Main Process)**
   - `VoiceApiService`: HTTP 服务器服务，监听 8765 端口
   - 接收 POST 请求并通过 IPC 通道发送到渲染进程

2. **渲染进程 (Renderer Process)**
   - `Inputbar` 组件监听 `App_SendVoiceMessage` IPC 事件
   - **智能验证**：检查当前是否有活跃的助手和话题
   - 自动设置文本内容并触发发送消息功能
   - **精确发送**：消息只发送到当前选定的助手和话题

3. **IPC 通信**
   - 新增 `App_SendVoiceMessage` IPC 通道
   - 主进程通过 `webContents.send()` 发送消息到渲染进程

### 消息发送逻辑

```typescript
// 验证当前环境
if (!assistant || !topic) {
  console.warn('Voice message ignored: No active assistant or topic')
  return
}

// 发送到当前选定的助手和话题
setText(voiceText.trim())
sendMessage() // 使用当前的 assistant 和 topic
```

### 关键文件

- `src/main/services/VoiceApiService.ts`: HTTP 服务器实现
- `src/main/index.ts`: 服务器启动和停止逻辑
- `packages/shared/IpcChannel.ts`: IPC 通道定义
- `src/renderer/src/pages/home/Inputbar/Inputbar.tsx`: 消息处理逻辑

## 安全注意事项

- 服务器只监听本地回环地址 `127.0.0.1`，不接受外部网络连接
- 支持 CORS 跨域请求，便于本地开发和集成
- 所有请求都会记录到应用日志中
- 当主窗口不可用时，会返回 503 错误

## 故障排除

### 常见问题

1. **连接被拒绝**
   - 确保 Cherry Studio 应用程序正在运行
   - 检查端口 8765 是否被其他程序占用

2. **消息没有发送**
   - 确保 Cherry Studio 主窗口是打开的
   - 检查应用程序日志中的错误信息

3. **端口冲突**
   - 如果端口 8765 被占用，可以修改 `VoiceApiService.ts` 中的端口设置

### 日志调试

Voice API 相关的日志会显示在 Cherry Studio 的日志中：
- 服务器启动/停止事件
- 接收到的消息内容
- 错误和异常信息

## 使用场景

- **语音识别集成**: 将语音转文本后发送到 Cherry Studio
- **自动化脚本**: 批量发送消息进行测试
- **第三方集成**: 其他应用程序与 Cherry Studio 的集成
- **快捷输入**: 通过外部工具快速输入常用文本

## 更新日志

### v1.0.0
- 初始版本
- 支持基本的 POST 请求处理
- 自动消息发送功能
- 完整的错误处理和日志记录