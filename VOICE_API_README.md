# Cherry Studio Voice API 接口文档

## 概述

Cherry Studio 现在支持完整的语音识别生态系统。系统包含三个组件：
1. **Cherry Studio 前端** - 提供语音控制按钮和文本显示
2. **Cherry Studio Voice API** - 接收语音文本的HTTP服务 (端口8765)
3. **Python语音后端服务** - 执行语音识别并与前端通信 (端口8766)

该架构支持流式输入、状态控制和完整的语音识别工作流。

## 功能特性

### Cherry Studio Voice API (端口8765)
- ✅ HTTP 服务器监听 `127.0.0.1:8765` 端口
- ✅ 支持 `/voice` POST 端点接收语音文本
- ✅ 支持 `/voice/toggle` POST 端点切换接收状态
- ✅ 支持 `/voice/status` GET 端点查询状态
- ✅ 支持流式输入（累计添加文本）
- ✅ 自动将接收到的文本设置到输入框
- ✅ 支持 CORS 跨域请求
- ✅ 完整的错误处理和日志记录

### Python语音后端服务 (端口8766)
- ✅ HTTP 服务器监听 `127.0.0.1:8766` 端口
- ✅ 支持 `/voice/control` POST 端点接收控制指令
- ✅ 支持 `/voice/status` POST 端点查询识别状态
- ✅ 模拟语音识别并按段落发送文字
- ✅ 与Cherry Studio Voice API自动通信
- ✅ 支持启动/停止语音识别

### 前端集成
- ✅ 语音按钮控制整个识别流程
- ✅ 点击按钮同时通知两个后端服务
- ✅ 智能状态管理和错误处理
- ✅ 实时显示语音识别结果

## API 端点

## Cherry Studio Voice API (端口8765)

### POST /voice

**URL:** `http://127.0.0.1:8765/voice`

**方法:** POST

**请求头:**
```
Content-Type: text/plain; charset=utf-8
X-Voice-Streaming: true  # 可选，标识流式输入
```

**请求体:**
- 发送要输入的文本内容（字符串格式，支持UTF-8编码）

**响应:**

成功响应 (200):
```json
{
  "success": true,
  "message": "Voice message sent successfully",
  "receivedText": "你的消息内容",
  "isStreaming": true,
  "enabled": true
}
```

错误响应:
- 403: 语音接收已禁用
- 404: 端点不存在
- 500: 内部服务器错误
- 503: 主窗口不可用

### POST /voice/toggle

**URL:** `http://127.0.0.1:8765/voice/toggle`

**方法:** POST

**功能:** 切换语音接收状态（启用/禁用）

**响应:**
```json
{
  "success": true,
  "enabled": true,
  "message": "Voice receiving enabled"
}
```

### GET /voice/status

**URL:** `http://127.0.0.1:8765/voice/status`

**方法:** GET

**功能:** 查询当前语音接收状态

**响应:**
```json
{
  "enabled": true,
  "port": 8765
}
```

## Python语音后端服务 (端口8766)

### POST /voice/control

**URL:** `http://127.0.0.1:8766/voice/control`

**方法:** POST

**功能:** 控制语音识别的启动和停止

**请求体:**
```json
{
  "action": "start",  // "start" 或 "stop"
  "timestamp": "2024-01-01T00:00:00.000Z",
  "targetUrl": "http://127.0.0.1:8765/voice"
}
```

**响应:**
```json
{
  "success": true,
  "message": "语音识别已启动",
  "status": "recording"  // "recording" 或 "stopped"
}
```

### POST /voice/status

**URL:** `http://127.0.0.1:8766/voice/status`

**方法:** POST

**功能:** 查询语音识别状态

**响应:**
```json
{
  "success": true,
  "status": "recording",  // "recording" 或 "stopped"
  "port": 8766,
  "target_url": "http://127.0.0.1:8765/voice"
}
```

## 使用示例

### 完整工作流程

#### 1. 启动服务

```bash
# 1. 启动Cherry Studio应用程序

# 2. 启动Python语音后端服务
python voice-backend-service.py

# 可选：指定端口和目标URL
python voice-backend-service.py 8766 http://127.0.0.1:8765/voice
```

#### 2. 前端操作流程

1. **启用语音识别**：在Cherry Studio输入框工具栏点击语音按钮
   - 前端会自动发送请求到Cherry Studio Voice API (8765端口)
   - 同时通知Python后端服务 (8766端口) 开始语音识别

2. **语音识别过程**：Python后端开始模拟语音识别
   - 按段落进行语音识别，每句话完成后累计发送
   - 文字以段落形式实时显示在输入框中

3. **停止语音识别**：再次点击语音按钮
   - 停止Cherry Studio接收语音文字
   - 通知Python后端停止语音识别

#### 3. API控制示例

```bash
# 启用/禁用Cherry Studio语音接收
curl -X POST http://127.0.0.1:8765/voice/toggle

# 查询Cherry Studio状态
curl http://127.0.0.1:8765/voice/status

# 控制Python后端开始语音识别
curl -X POST http://127.0.0.1:8766/voice/control \
     -H "Content-Type: application/json" \
     -d '{"action":"start","timestamp":"2024-01-01T00:00:00.000Z","targetUrl":"http://127.0.0.1:8765/voice"}'

# 控制Python后端停止语音识别
curl -X POST http://127.0.0.1:8766/voice/control \
     -H "Content-Type: application/json" \
     -d '{"action":"stop"}'

# 查询Python后端状态
curl -X POST http://127.0.0.1:8766/voice/status
```

### 2. 使用 curl 发送语音消息

```bash
# 发送简单文本消息
curl -X POST http://127.0.0.1:8765/voice \
     -H "Content-Type: text/plain; charset=utf-8" \
     -d "你好，这是一条测试消息"

# 发送流式消息
curl -X POST http://127.0.0.1:8765/voice \
     -H "Content-Type: text/plain; charset=utf-8" \
     -H "X-Voice-Streaming: true" \
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

## 系统架构

### 组件关系图

```
┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│   Cherry Studio     │    │  Cherry Studio       │    │  Python语音后端     │
│      前端           │    │   Voice API          │    │      服务           │
│    (用户界面)        │    │   (端口 8765)        │    │   (端口 8766)       │
└─────────────────────┘    └──────────────────────┘    └─────────────────────┘
          │                           │                           │
          │                           │                           │
    [语音按钮点击]                [接收语音文字]              [执行语音识别]
          │                           │                           │
          ▼                           ▼                           ▼
    ┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
    │  1. 切换接收状态     │    │  1. 接收文字内容      │    │  1. 接收控制指令     │
    │  → 8765/voice/toggle│    │  ← 8765/voice         │    │  ← 8766/voice/control│
    │                     │    │                      │    │                     │
    │  2. 通知Python后端   │    │  2. 发送到前端输入框  │    │  2. 启动/停止识别    │
    │  → 8766/voice/control│    │  → IPC消息           │    │                     │
    │                     │    │                      │    │  3. 流式发送文字     │
    │  3. 更新按钮状态     │    │  3. 累计显示文字      │    │  → 8765/voice        │
    └─────────────────────┘    └──────────────────────┘    └─────────────────────┘
```

### 数据流向

1. **启动语音识别**
   ```
   用户点击语音按钮 
   → 前端发送 POST /voice/toggle 到 Cherry Studio API
   → 前端发送 POST /voice/control {"action": "start"} 到 Python后端
   → Python后端开始语音识别循环
   ```

2. **语音识别过程**
   ```
   Python后端按段落识别语音 
   → 每完成一句话，累计到当前段落
   → 发送 POST /voice 带段落文字到 Cherry Studio API
   → Cherry Studio API 通过 IPC 发送到前端
   → 前端输入框显示完整段落文字
   ```

3. **停止语音识别**
   ```
   用户再次点击语音按钮
   → 前端发送 POST /voice/toggle 到 Cherry Studio API  
   → 前端发送 POST /voice/control {"action": "stop"} 到 Python后端
   → Python后端停止语音识别循环
   ```

### 错误处理

- **Python后端服务不可用**：前端会显示警告但不影响基本功能
- **Cherry Studio API不可用**：Python后端会记录错误并继续尝试
- **网络错误**：各组件都有超时和重试机制
- **状态不同步**：可通过状态查询API进行同步
- **语音识别停止问题**：已修复停止信号处理，确保转写器正确关闭

### 最近修复

**v1.1 - 语音停止功能修复**
- 修复了前端发送stop信号后，后端不能正确停止语音识别的问题
- 改进了 `stop_voice_recognition()` 方法，使用正确的 `stop_recording()` API
- 添加了异常处理和详细日志记录
- 优化了语音识别循环，能够正确响应停止信号
- 增加了线程等待超时时间，确保完全停止

## 测试脚本和服务

项目根目录下提供了多个测试脚本和服务：

### voice-backend-service.py (Python语音后端服务)
```bash
# 启动语音后端服务（默认端口8766）
python voice-backend-service.py

# 指定端口和目标URL
python voice-backend-service.py 8766 http://127.0.0.1:8765/voice

# 服务启动后会显示：
# - 控制端点: POST http://127.0.0.1:8766/voice/control
# - 状态查询: POST http://127.0.0.1:8766/voice/status
```

### test-voice-workflow.py (完整工作流程测试)
```bash
# 测试完整的语音识别工作流程
python test-voice-workflow.py

# 此脚本会：
# 1. 检查所有服务状态
# 2. 启用Cherry Studio语音接收
# 3. 启动Python后端语音识别
# 4. 模拟发送语音文字
# 5. 停止语音识别
# 6. 禁用语音接收
```

### test-paragraph-mode.py (段落模式测试)
```bash
# 测试段落模式的语音识别
python test-paragraph-mode.py

# 此脚本会：
# 1. 检查所有服务状态
# 2. 启动Python后端语音识别
# 3. 运行20秒观察段落发送过程
# 4. 自动停止语音识别
# 5. 验证段落模式是否正常工作
```

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

# 流式输入模式（交互式）
python test-voice-api.py --stream

# 逐字发送模式（模拟语音识别）
python test-voice-api.py --word-by-word "这是 逐字 发送 的 测试"
python test-voice-api.py --word-by-word  # 使用默认文本
```

## 前端语音控制

在 Cherry Studio 的输入框工具栏中新增了语音按钮，具有以下功能：

### 语音按钮状态

- 🎤 **启用状态**：麦克风图标，蓝色高亮，表示语音接收已启用
- 🔇 **禁用状态**：静音图标，灰色，表示语音接收已禁用

### 使用方法

1. **启用语音接收**：点击语音按钮，图标变为蓝色麦克风
2. **发送语音消息**：外部程序可通过 API 发送语音文本
3. **流式输入**：支持累计接收和显示语音文本
4. **禁用语音接收**：再次点击按钮，图标变为灰色静音图标

### 流式输入特性

- **累计模式**：新接收的文本会累计添加到输入框
- **智能合并**：如果新文本包含当前文本，会智能替换而非重复
- **实时显示**：文本实时显示在输入框中，用户可以看到语音识别过程

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