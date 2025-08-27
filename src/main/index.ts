// don't reorder this file, it's used to initialize the app data dir and
// other which should be run before the main process is ready
// eslint-disable-next-line
import './bootstrap'

import '@main/config'

import { electronApp, optimizer } from '@electron-toolkit/utils'
import { replaceDevtoolsFont } from '@main/utils/windowUtil'
import { app } from 'electron'
import installExtension, { REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS } from 'electron-devtools-installer'
import Logger from 'electron-log'

import { isDev, isWin } from './constant'
import { registerIpc } from './ipc'
import { configManager } from './services/ConfigManager'
import mcpService from './services/MCPService'
import {
  handleProtocolUrl,
  registerProtocolClient,
  SCIENCE_CALCULATOR_PROTOCOL,
  setupAppImageDeepLink
} from './services/ProtocolClient'
import selectionService, { initSelectionService } from './services/SelectionService'
import { registerShortcuts } from './services/ShortcutService'
import { TrayService } from './services/TrayService'
import { voiceApiService } from './services/VoiceApiService'
import { windowService } from './services/WindowService'

Logger.initialize()

/**
 * Disable chromium's window animations
 * main purpose for this is to avoid the transparent window flashing when it is shown
 * (especially on Windows for SelectionAssistant Toolbar)
 * Know Issue: https://github.com/electron/electron/issues/12130#issuecomment-627198990
 */
if (isWin) {
  app.commandLine.appendSwitch('wm-window-animations-disabled')
}

// Enable features for unresponsive renderer js call stacks
app.commandLine.appendSwitch('enable-features', 'DocumentPolicyIncludeJSCallStacksInCrashReports')
app.on('web-contents-created', (_, webContents) => {
  webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Document-Policy': ['include-js-call-stacks-in-crash-reports']
      }
    })
  })

  webContents.on('unresponsive', async () => {
    // Interrupt execution and collect call stack from unresponsive renderer
    Logger.error('Renderer unresponsive start')
    const callStack = await webContents.mainFrame.collectJavaScriptCallStack()
    Logger.error('Renderer unresponsive js call stack\n', callStack)
  })
})

// in production mode, handle uncaught exception and unhandled rejection globally
if (!isDev) {
  // handle uncaught exception
  process.on('uncaughtException', (error) => {
    Logger.error('Uncaught Exception:', error)
  })

  // handle unhandled rejection
  process.on('unhandledRejection', (reason, promise) => {
    Logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
  })
}

// Check for single instance lock
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
} else {
  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.

  app.whenReady().then(async () => {
    // Set app user model id for windows
    electronApp.setAppUserModelId(import.meta.env.VITE_MAIN_BUNDLE_ID || 'com.nwaic')

    // Mac: Hide dock icon before window creation when launch to tray is set
    const isLaunchToTray = configManager.getLaunchToTray()
    if (isLaunchToTray) {
      app.dock?.hide()
    }

    const mainWindow = windowService.createMainWindow()
    new TrayService()

    app.on('activate', function () {
      const mainWindow = windowService.getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) {
        windowService.createMainWindow()
      } else {
        windowService.showMainWindow()
      }
    })

    registerShortcuts(mainWindow)

    registerIpc(mainWindow, app)

    replaceDevtoolsFont(mainWindow)

    // Setup deep link for AppImage on Linux
    await setupAppImageDeepLink()

    if (isDev) {
      installExtension([REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS])
        .then((name) => console.log(`Added Extension:  ${name}`))
        .catch((err) => console.log('An error occurred: ', err))
    }

    //start selection assistant service
    initSelectionService()

    // 启动语音API服务器
    try {
      await voiceApiService.startServer()
    } catch (error) {
      Logger.error('Failed to start Voice API server:', error)
    }
  })

  registerProtocolClient(app)

  // macOS specific: handle protocol when app is already running
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleProtocolUrl(url)
  })

  // Listen for second instance
  app.on('second-instance', (_event, argv) => {
    windowService.showMainWindow()

    // Protocol handler for Windows/Linux
    // The commandLine is an array of strings where the last item might be the URL
    const url = argv.find((arg) => arg.startsWith(SCIENCE_CALCULATOR_PROTOCOL + '://'))
    if (url) handleProtocolUrl(url)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('before-quit', () => {
    app.isQuitting = true

    // quit selection service
    if (selectionService) {
      selectionService.quit()
    }
  })

  app.on('will-quit', async () => {
    // event.preventDefault()
    try {
      await mcpService.cleanup()
      await voiceApiService.stopServer()
    } catch (error) {
      Logger.error('Error cleaning up MCP service:', error)
    }
  })

  // In this file you can include the rest of your app"s specific main process
  // code. You can also put them in separate files and require them here.
}
