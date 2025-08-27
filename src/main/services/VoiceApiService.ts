import http from 'http'
import Logger from 'electron-log'
import { windowService } from './WindowService'
import { IpcChannel } from '@shared/IpcChannel'

export class VoiceApiService {
  private static instance: VoiceApiService | null = null
  private server: http.Server | null = null
  private readonly port = 8765

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

      // 只处理 POST 请求到 /voice 端点
      if (req.method === 'POST' && req.url === '/voice') {
        this.handleVoiceMessage(req, res)
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
    let body = ''

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

        // 发送消息到渲染进程
        mainWindow.webContents.send(IpcChannel.App_SendVoiceMessage, body)

        // 返回成功响应
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ 
          success: true, 
          message: 'Voice message sent successfully',
          receivedText: body
        }))

        Logger.info('Voice message sent to renderer process:', body)
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