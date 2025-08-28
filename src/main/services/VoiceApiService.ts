import http from 'http'
import Logger from 'electron-log'
import { windowService } from './WindowService'
import { IpcChannel } from '@shared/IpcChannel'

export class VoiceApiService {
  private static instance: VoiceApiService | null = null
  private server: http.Server | null = null
  private readonly port = 8765
  private isVoiceReceivingEnabled = false

  public static getInstance(): VoiceApiService {
    if (!VoiceApiService.instance) {
      VoiceApiService.instance = new VoiceApiService()
    }
    return VoiceApiService.instance
  }

  public async startServer(): Promise<void> {
    if (this.server) {
      Logger.info('Voice API server is already running')
      return
    }

    this.server = http.createServer((req, res) => {
      // 设置 CORS 头部以允许跨域请求
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      // 处理 OPTIONS 预检请求
      if (req.method === 'OPTIONS') {
        res.writeHead(200)
        res.end()
        return
      }

      // 处理不同的端点
      if (req.method === 'POST' && req.url === '/voice') {
        this.handleVoiceMessage(req, res)
      } else if (req.method === 'POST' && req.url === '/voice/toggle') {
        this.handleToggleVoiceReceiving(req, res)
      } else if (req.method === 'GET' && req.url === '/voice/status') {
        this.handleGetVoiceStatus(req, res)
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Endpoint not found' }))
      }
    })

    // 处理服务器错误
    this.server.on('error', (error) => {
      Logger.error('Voice API server error:', error)
    })

    return new Promise<void>((resolve, reject) => {
      this.server?.listen(this.port, '127.0.0.1', () => {
        Logger.info(`Voice API server listening on http://127.0.0.1:${this.port}`)
        resolve()
      })

      this.server?.on('error', (error) => {
        reject(error)
      })
    })
  }

  private handleVoiceMessage(req: http.IncomingMessage, res: http.ServerResponse): void {
    // 检查是否启用了语音接收
    if (!this.isVoiceReceivingEnabled) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ 
        error: 'Voice receiving is disabled',
        enabled: false
      }))
      return
    }

    let body = ''
    const isStreaming = req.headers['x-voice-streaming'] === 'true'

    req.on('data', (chunk) => {
      body += chunk.toString()
    })

    req.on('end', () => {
      try {
        // 检查主窗口是否存在
        const mainWindow = windowService.getMainWindow()
        if (!mainWindow || mainWindow.isDestroyed()) {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Main window not available' }))
          return
        }

        // 发送消息到渲染进程，包含流式标识
        mainWindow.webContents.send(IpcChannel.App_SendVoiceMessage, {
          text: body,
          isStreaming: isStreaming
        })

        // 返回成功响应
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ 
          success: true, 
          message: 'Voice message sent successfully',
          receivedText: body,
          isStreaming: isStreaming,
          enabled: this.isVoiceReceivingEnabled
        }))

        Logger.info('Voice message sent to renderer process:', { text: body, isStreaming })
      } catch (error) {
        Logger.error('Error handling voice message:', error)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
      }
    })

    req.on('error', (error) => {
      Logger.error('Error reading voice message request:', error)
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Bad request' }))
    })
  }

  private handleToggleVoiceReceiving(_req: http.IncomingMessage, res: http.ServerResponse): void {
    this.isVoiceReceivingEnabled = !this.isVoiceReceivingEnabled
    
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ 
      success: true,
      enabled: this.isVoiceReceivingEnabled,
      message: this.isVoiceReceivingEnabled ? 'Voice receiving enabled' : 'Voice receiving disabled'
    }))

    Logger.info(`Voice receiving ${this.isVoiceReceivingEnabled ? 'enabled' : 'disabled'}`)

    // 通知前端状态变更
    const mainWindow = windowService.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannel.App_VoiceReceivingToggled, this.isVoiceReceivingEnabled)
    }
  }

  private handleGetVoiceStatus(_req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ 
      enabled: this.isVoiceReceivingEnabled,
      port: this.port
    }))
  }

  public async stopServer(): Promise<void> {
    if (!this.server) {
      return
    }

    return new Promise<void>((resolve) => {
      this.server?.close(() => {
        Logger.info('Voice API server stopped')
        this.server = null
        resolve()
      })
    })
  }

  public isRunning(): boolean {
    return this.server !== null && this.server.listening
  }
}

export const voiceApiService = VoiceApiService.getInstance()