import { isMac } from '@renderer/config/constant'
import { isLocalAi } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import KnowledgeQueue from '@renderer/queue/KnowledgeQueue'
import { useAppDispatch } from '@renderer/store'

import { addMCPServer } from '@renderer/store/mcp'
import { setAvatar, setFilesPath, setResourcesPath, setUpdateState } from '@renderer/store/runtime'
import { delay, runAsyncFunction } from '@renderer/utils'
import { defaultLanguage } from '@shared/config/constant'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'

import { useDefaultModel } from './useAssistant'
import useFullScreenNotice from './useFullScreenNotice'
import { useMCPServers } from './useMCPServers'
import { useRuntime } from './useRuntime'
import { useSettings } from './useSettings'
import useUpdateHandler from './useUpdateHandler'

export function useAppInit() {
  const dispatch = useAppDispatch()
  const { proxyUrl, language, windowStyle, autoCheckUpdate, proxyMode, customCss, enableDataCollection } = useSettings()
  const { minappShow } = useRuntime()
  const { setDefaultModel, setTopicNamingModel, setTranslateModel } = useDefaultModel()

  const { mcpServers } = useMCPServers()
  const avatar = useLiveQuery(() => db.settings.get('image://avatar'))
  const { theme } = useTheme()

  useEffect(() => {
    document.getElementById('spinner')?.remove()
    console.timeEnd('init')
  }, [])

  useEffect(() => {
    window.api.getDataPathFromArgs().then((dataPath) => {
      if (dataPath) {
        window.navigate('/settings/data', { replace: true })
      }
    })
  }, [])

  useUpdateHandler()
  useFullScreenNotice()

  useEffect(() => {
    avatar?.value && dispatch(setAvatar(avatar.value))
  }, [avatar, dispatch])

  useEffect(() => {
    runAsyncFunction(async () => {
      const { isPackaged } = await window.api.getAppInfo()
      if (isPackaged && autoCheckUpdate) {
        await delay(2)
        const { updateInfo } = await window.api.checkForUpdate()
        dispatch(setUpdateState({ info: updateInfo }))
      }
    })
  }, [dispatch, autoCheckUpdate])

  useEffect(() => {
    if (proxyMode === 'system') {
      window.api.setProxy('system')
    } else if (proxyMode === 'custom') {
      proxyUrl && window.api.setProxy(proxyUrl)
    } else {
      window.api.setProxy('')
    }
  }, [proxyUrl, proxyMode])

  useEffect(() => {
    i18n.changeLanguage(language || navigator.language || defaultLanguage)
  }, [language])

  useEffect(() => {
    const transparentWindow = windowStyle === 'transparent' && isMac && !minappShow

    if (minappShow) {
      window.root.style.background =
        windowStyle === 'transparent' && isMac ? 'var(--color-background)' : 'var(--navbar-background)'
      return
    }

    window.root.style.background = transparentWindow ? 'var(--navbar-background-mac)' : 'var(--navbar-background)'
  }, [windowStyle, minappShow, theme])

  useEffect(() => {
    if (isLocalAi) {
      const model = JSON.parse(import.meta.env.VITE_RENDERER_INTEGRATED_MODEL)
      setDefaultModel(model)
      setTopicNamingModel(model)
      setTranslateModel(model)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // set files path
    window.api.getAppInfo().then((info) => {
      dispatch(setFilesPath(info.filesPath))
      dispatch(setResourcesPath(info.resourcesPath))
    })
  }, [dispatch])

  useEffect(() => {
    KnowledgeQueue.checkAllBases()
  }, [])

  useEffect(() => {
    let customCssElement = document.getElementById('user-defined-custom-css') as HTMLStyleElement
    if (customCssElement) {
      customCssElement.remove()
    }

    if (customCss) {
      customCssElement = document.createElement('style')
      customCssElement.id = 'user-defined-custom-css'
      customCssElement.textContent = customCss
      document.head.appendChild(customCssElement)
    }
  }, [customCss])

  useEffect(() => {
    // TODO: init data collection
  }, [enableDataCollection])

  // 初始化默认配置
  useEffect(() => {
    const initializeDefaults = async () => {
      // 设置默认硅基流动API密钥
      const siliconProvider = await db.providers.where('id').equals('silicon').first()
      if (siliconProvider && !siliconProvider.apiKey) {
        await db.providers.update('silicon', { 
          apiKey: 'sk-ktficbaurnhwtomuwfqypwcpqhvdmgycaaoyqzelgzzwashx'
        })
      }

      // 检查并创建默认MCP服务
      const teableServerExists = mcpServers.find(s => s.name === 'teable-server')
      if (!teableServerExists) {
        const teableServer = {
          id: 'teable-server',
          name: 'teable-server',
          type: 'streamableHttp' as const,
          description: 'Teable多维表格服务',
          baseUrl: 'http://127.0.0.1:6008/mcp-teable',
          isActive: true
        }
        dispatch(addMCPServer(teableServer))
      }

      const dateServerExists = mcpServers.find(s => s.name === 'date-server')
      if (!dateServerExists) {
        const dateServer = {
          id: 'date-server',
          name: 'date-server',
          type: 'streamableHttp' as const,
          description: '日期时间服务',
          baseUrl: 'http://127.0.0.1:6008/mcp-date',
          isActive: true
        }
        dispatch(addMCPServer(dateServer))
      }
    }

    // 只在第一次加载时执行初始化
    initializeDefaults()
  }, [mcpServers, dispatch])
}
