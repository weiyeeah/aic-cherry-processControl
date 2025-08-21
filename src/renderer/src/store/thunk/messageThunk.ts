import db from '@renderer/databases'
import { autoRenameTopic } from '@renderer/hooks/useTopic'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import FileManager from '@renderer/services/FileManager'
import { NotificationService } from '@renderer/services/NotificationService'
import { createStreamProcessor, type StreamProcessorCallbacks } from '@renderer/services/StreamProcessingService'
import { estimateMessagesUsage } from '@renderer/services/TokenService'
import store from '@renderer/store'
import type { Assistant, ExternalToolResult, FileType, MCPToolResponse, Model, Topic } from '@renderer/types'
import type {
  CitationMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  Message,
  MessageBlock,
  PlaceholderMessageBlock,
  ToolMessageBlock
} from '@renderer/types/newMessage'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { Response } from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'
import { formatErrorMessage, isAbortError } from '@renderer/utils/error'
import { abortCompletion } from '@renderer/utils/abortController'
import {
  createAssistantMessage,
  createBaseMessageBlock,
  createCitationBlock,
  createErrorBlock,
  createImageBlock,
  createMainTextBlock,
  createThinkingBlock,
  createToolBlock,
  createTranslationBlock,
  resetAssistantMessage
} from '@renderer/utils/messageUtils/create'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { getTopicQueue } from '@renderer/utils/queue'
import { isOnHomePage } from '@renderer/utils/window'
import { t } from 'i18next'
import { isEmpty, throttle } from 'lodash'
import { LRUCache } from 'lru-cache'

import type { AppDispatch, RootState } from '../index'
import { removeManyBlocks, updateOneBlock, upsertManyBlocks, upsertOneBlock } from '../messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '../newMessage'

// const handleChangeLoadingOfTopic = async (topicId: string) => {
//   await waitForTopicQueue(topicId)
//   store.dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
// }
// TODO: 后续可以将db操作移到Listener Middleware中
export const saveMessageAndBlocksToDB = async (message: Message, blocks: MessageBlock[], messageIndex: number = -1) => {
  try {
    if (blocks.length > 0) {
      await db.message_blocks.bulkPut(blocks)
    }
    const topic = await db.topics.get(message.topicId)
    if (topic) {
      const _messageIndex = topic.messages.findIndex((m) => m.id === message.id)
      const updatedMessages = [...topic.messages]

      if (_messageIndex !== -1) {
        updatedMessages[_messageIndex] = message
      } else {
        if (messageIndex !== -1) {
          updatedMessages.splice(messageIndex, 0, message)
        } else {
          updatedMessages.push(message)
        }
      }
      await db.topics.update(message.topicId, { messages: updatedMessages })
    } else {
      console.error(`[saveMessageAndBlocksToDB] Topic ${message.topicId} not found.`)
    }
  } catch (error) {
    console.error(`[saveMessageAndBlocksToDB] Failed to save message ${message.id}:`, error)
  }
}

const updateExistingMessageAndBlocksInDB = async (
  updatedMessage: Partial<Message> & Pick<Message, 'id' | 'topicId'>,
  updatedBlocks: MessageBlock[]
) => {
  try {
    await db.transaction('rw', db.topics, db.message_blocks, async () => {
      // Always update blocks if provided
      if (updatedBlocks.length > 0) {
        await db.message_blocks.bulkPut(updatedBlocks)
      }

      // Check if there are message properties to update beyond id and topicId
      const messageKeysToUpdate = Object.keys(updatedMessage).filter((key) => key !== 'id' && key !== 'topicId')

      // Only proceed with topic update if there are actual message changes
      if (messageKeysToUpdate.length > 0) {
        // 使用 where().modify() 进行原子更新
        await db.topics
          .where('id')
          .equals(updatedMessage.topicId)
          .modify((topic) => {
            if (!topic) return

            const messageIndex = topic.messages.findIndex((m) => m.id === updatedMessage.id)
            if (messageIndex !== -1) {
              // 直接在原对象上更新需要修改的属性
              messageKeysToUpdate.forEach((key) => {
                topic.messages[messageIndex][key] = updatedMessage[key]
              })
            }
          })
      }
    })
  } catch (error) {
    console.error(`[updateExistingMsg] Failed to update message ${updatedMessage.id}:`, error)
  }
}

/**
 * 消息块节流器。
 * 每个消息块有独立节流器，并发更新时不会互相影响
 */
const blockUpdateThrottlers = new LRUCache<string, ReturnType<typeof throttle>>({
  max: 100,
  ttl: 1000 * 60 * 5,
  updateAgeOnGet: true
})

/**
 * 消息块 RAF 缓存。
 * 用于管理 RAF 请求创建和取消。
 */
const blockUpdateRafs = new LRUCache<string, number>({
  max: 100,
  ttl: 1000 * 60 * 5,
  updateAgeOnGet: true
})

/**
 * 获取或创建消息块专用的节流函数。
 */
const getBlockThrottler = (id: string) => {
  if (!blockUpdateThrottlers.has(id)) {
    const throttler = throttle(async (blockUpdate: any) => {
      const existingRAF = blockUpdateRafs.get(id)
      if (existingRAF) {
        cancelAnimationFrame(existingRAF)
      }

      const rafId = requestAnimationFrame(() => {
        store.dispatch(updateOneBlock({ id, changes: blockUpdate }))
        blockUpdateRafs.delete(id)
      })

      blockUpdateRafs.set(id, rafId)
      await db.message_blocks.update(id, blockUpdate)
    }, 150)

    blockUpdateThrottlers.set(id, throttler)
  }

  return blockUpdateThrottlers.get(id)!
}

/**
 * 更新单个消息块。
 */
const throttledBlockUpdate = (id: string, blockUpdate: any) => {
  const throttler = getBlockThrottler(id)
  throttler(blockUpdate)
}

/**
 * 取消单个块的节流更新，移除节流器和 RAF。
 */
const cancelThrottledBlockUpdate = (id: string) => {
  const rafId = blockUpdateRafs.get(id)
  if (rafId) {
    cancelAnimationFrame(rafId)
    blockUpdateRafs.delete(id)
  }

  const throttler = blockUpdateThrottlers.get(id)
  if (throttler) {
    throttler.cancel()
    blockUpdateThrottlers.delete(id)
  }
}

/**
 * 批量清理多个消息块。
 */
export const cleanupMultipleBlocks = (dispatch: AppDispatch, blockIds: string[]) => {
  blockIds.forEach((id) => {
    cancelThrottledBlockUpdate(id)
  })

  const getBlocksFiles = async (blockIds: string[]) => {
    const blocks = await db.message_blocks.where('id').anyOf(blockIds).toArray()
    const files = blocks
      .filter((block) => block.type === MessageBlockType.FILE || block.type === MessageBlockType.IMAGE)
      .map((block) => block.file)
      .filter((file): file is FileType => file !== undefined)
    return isEmpty(files) ? [] : files
  }

  const cleanupFiles = async (files: FileType[]) => {
    await Promise.all(files.map((file) => FileManager.deleteFile(file.id, false)))
  }

  getBlocksFiles(blockIds).then(cleanupFiles)

  if (blockIds.length > 0) {
    dispatch(removeManyBlocks(blockIds))
  }
}

// // 修改: 节流更新单个块的内容/状态到数据库 (仅用于 Text/Thinking Chunks)
// export const throttledBlockDbUpdate = throttle(
//   async (blockId: string, blockChanges: Partial<MessageBlock>) => {
//     // Check if blockId is valid before attempting update
//     if (!blockId) {
//       console.warn('[DB Throttle Block Update] Attempted to update with null/undefined blockId. Skipping.')
//       return
//     }
//     const state = store.getState()
//     const block = state.messageBlocks.entities[blockId]
//     // throttle是异步函数,可能会在complete事件触发后才执行
//     if (
//       blockChanges.status === MessageBlockStatus.STREAMING &&
//       (block?.status === MessageBlockStatus.SUCCESS || block?.status === MessageBlockStatus.ERROR)
//     )
//       return
//     try {
//     } catch (error) {
//       console.error(`[DB Throttle Block Update] Failed for block ${blockId}:`, error)
//     }
//   },
//   300, // 可以调整节流间隔
//   { leading: false, trailing: true }
// )

// 新增: 通用的、非节流的函数，用于保存消息和块的更新到数据库
const saveUpdatesToDB = async (
  messageId: string,
  topicId: string,
  messageUpdates: Partial<Message>, // 需要更新的消息字段
  blocksToUpdate: MessageBlock[] // 需要更新/创建的块
) => {
  try {
    const messageDataToSave: Partial<Message> & Pick<Message, 'id' | 'topicId'> = {
      id: messageId,
      topicId,
      ...messageUpdates
    }
    await updateExistingMessageAndBlocksInDB(messageDataToSave, blocksToUpdate)
  } catch (error) {
    console.error(`[DB Save Updates] Failed for message ${messageId}:`, error)
  }
}

// 新增: 辅助函数，用于获取并保存单个更新后的 Block 到数据库
const saveUpdatedBlockToDB = async (
  blockId: string | null,
  messageId: string,
  topicId: string,
  getState: () => RootState
) => {
  if (!blockId) {
    console.warn('[DB Save Single Block] Received null/undefined blockId. Skipping save.')
    return
  }
  const state = getState()
  const blockToSave = state.messageBlocks.entities[blockId]
  if (blockToSave) {
    await saveUpdatesToDB(messageId, topicId, {}, [blockToSave]) // Pass messageId, topicId, empty message updates, and the block
  } else {
    console.warn(`[DB Save Single Block] Block ${blockId} not found in state. Cannot save.`)
  }
}

// --- Helper Function for Multi-Model Dispatch ---
// 多模型创建和发送请求的逻辑，用于用户消息多模型发送和重发
const dispatchMultiModelResponses = async (
  dispatch: AppDispatch,
  getState: () => RootState,
  topicId: string,
  triggeringMessage: Message, // userMessage or messageToResend
  assistant: Assistant,
  mentionedModels: Model[]
) => {
  const assistantMessageStubs: Message[] = []
  const tasksToQueue: { assistantConfig: Assistant; messageStub: Message }[] = []

  for (const mentionedModel of mentionedModels) {
    const assistantForThisMention = { ...assistant, model: mentionedModel }
    const assistantMessage = createAssistantMessage(assistant.id, topicId, {
      askId: triggeringMessage.id,
      model: mentionedModel,
      modelId: mentionedModel.id
    })
    dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))
    assistantMessageStubs.push(assistantMessage)
    tasksToQueue.push({ assistantConfig: assistantForThisMention, messageStub: assistantMessage })
  }

  const topicFromDB = await db.topics.get(topicId)
  if (topicFromDB) {
    const currentTopicMessageIds = getState().messages.messageIdsByTopic[topicId] || []
    const currentEntities = getState().messages.entities
    const messagesToSaveInDB = currentTopicMessageIds.map((id) => currentEntities[id]).filter((m): m is Message => !!m)
    await db.topics.update(topicId, { messages: messagesToSaveInDB })
  } else {
    console.error(`[dispatchMultiModelResponses] Topic ${topicId} not found in DB during multi-model save.`)
    throw new Error(`Topic ${topicId} not found in DB.`)
  }

  const queue = getTopicQueue(topicId)
  for (const task of tasksToQueue) {
    queue.add(async () => {
      await fetchAndProcessAssistantResponseImpl(dispatch, getState, topicId, task.assistantConfig, task.messageStub)
    })
  }
}

// --- End Helper Function ---

// 智能上下文压缩函数 - 针对智慧办公助手的大上下文处理
const compressContextForOfficeAssistant = async (
  messages: Message[],
  dispatch: AppDispatch,
  getState: () => RootState
): Promise<Message[]> => {
  const state = getState()
  const messageBlocks = state.messageBlocks.entities
  
  // 计算上下文总token数（粗略估算：中文1字符≈1token，英文1单词≈1token）
  let totalTokens = 0
  const TOKEN_LIMIT = 8000 // 设置合理的token限制
  const COMPRESSION_THRESHOLD = 6000 // 超过此阈值开始压缩
  
  for (const message of messages) {
    if (message.blocks) {
      for (const blockId of message.blocks) {
        const block = messageBlocks[blockId]
        if (block && 'content' in block && typeof block.content === 'string') {
          // 粗略估算token数
          const content = block.content
          const estimatedTokens = content.length + content.split(/\s+/).length
          totalTokens += estimatedTokens
        }
      }
    }
  }
  
  console.log(`[上下文压缩] 当前上下文token估算: ${totalTokens}`)
  
  // 如果token数未超过阈值，直接返回
  if (totalTokens <= COMPRESSION_THRESHOLD) {
    console.log(`[上下文压缩] 上下文大小在合理范围内，无需压缩`)
    return messages
  }
  
  console.log(`[上下文压缩] 上下文过大，开始智能压缩...`)
  
  try {
    // 找到最后一条用户消息（当前查询）
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    
    if (!lastUserMessage) {
      console.warn('[上下文压缩] 未找到用户消息，跳过压缩')
      return messages
    }
    
    // 保留最后的用户消息，压缩历史上下文
    const historicalMessages = messages.filter(m => m.id !== lastUserMessage.id)
    
    if (historicalMessages.length === 0) {
      console.log('[上下文压缩] 只有当前用户消息，无需压缩')
      return messages
    }
    
    // 构建历史对话内容用于压缩
    let historicalContent = ''
    for (const message of historicalMessages) {
      if (message.blocks) {
        for (const blockId of message.blocks) {
          const block = messageBlocks[blockId]
          if (block && 'content' in block && typeof block.content === 'string') {
            const role = message.role === 'user' ? '用户' : '助手'
            historicalContent += `${role}: ${block.content}\n\n`
          }
        }
      }
    }
    
    // 使用智能压缩策略
    const compressedContent = await smartCompressContext(historicalContent, totalTokens)
    
    // 创建压缩后的上下文消息
    const compressedMessage: Message = {
      id: `compressed-${Date.now()}`,
      role: 'user',
      topicId: lastUserMessage.topicId,
      assistantId: lastUserMessage.assistantId || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'success',
      blocks: []
    }
    
    // 创建压缩内容的block
    const compressedBlock = createMainTextBlock(compressedMessage.id, compressedContent, {
      status: MessageBlockStatus.SUCCESS
    })
    
    compressedMessage.blocks = [compressedBlock.id]
    
    // 添加压缩后的block到状态（临时的，不保存到数据库）
    dispatch(upsertOneBlock(compressedBlock))
    
    console.log(`[上下文压缩] 压缩完成，原始${totalTokens}token -> 压缩后约${compressedContent.length}token`)
    
    // 返回压缩后的上下文：压缩的历史 + 当前用户消息
    return [compressedMessage, lastUserMessage]
    
  } catch (error) {
    console.error('[上下文压缩] 压缩过程出错，使用原始上下文:', error)
    // 出错时回退到简单截取策略
    return messages.slice(-2) // 只保留最后2条消息
  }
}

// 智能上下文压缩函数 - 支持多种压缩策略
const smartCompressContext = async (content: string, originalTokens: number): Promise<string> => {
  console.log(`[智能压缩] 开始压缩${originalTokens}token的内容`)
  
  // 策略1: 内容较小时使用简单压缩
  if (content.length <= 1000) {
    return `历史对话摘要：${content}`
  }
  
  // 策略2: 中等大小时使用关键词提取
  if (originalTokens <= 10000) {
    return extractKeyInformation(content)
  }
  
  // 策略3: 超大内容时使用LLM压缩（模拟，可实际调用API）
  if (originalTokens > 10000) {
    console.log('[智能压缩] 内容过大，使用高级压缩策略')
    return await advancedContextCompression(content)
  }
  
  return extractKeyInformation(content)
}

// 关键信息提取压缩
const extractKeyInformation = (content: string): string => {
  const lines = content.split('\n').filter(line => line.trim())
  const importantLines: string[] = []
  const keywordGroups = {
    work: ['工作','计划', '任务', '完成情况', '进度'],
    meeting: ['周会', '会议', '布置'],
    team: ['团队', '成员', '负责人'],
    time: ['周数', '日期', '时间节点'],
    data: ['查询', '数据', '表格', 'MCP'],
    status: ['完成', '进行中', '延期', '状态']
  }
  
  // 按重要程度分类收集信息
  const categorizedInfo: Record<string, string[]> = {}
  
  for (const line of lines) {
    for (const [category, keywords] of Object.entries(keywordGroups)) {
      if (keywords.some((keyword: string) => line.includes(keyword))) {
        if (!categorizedInfo[category]) categorizedInfo[category] = []
        categorizedInfo[category].push(line)
        break
      }
    }
    
    // 保留时间和数字信息
    if (line.match(/\d+周/) || line.match(/\d{4}-\d{2}-\d{2}/) || line.match(/第\d+周/)) {
      if (!categorizedInfo.time) categorizedInfo.time = []
      categorizedInfo.time.push(line)
    }
  }
  
  // 构建压缩摘要
  let compressed = '历史对话关键信息摘要：\n\n'
  
  if (categorizedInfo.work) {
    compressed += '【工作相关】\n' + categorizedInfo.work.slice(0, 3).join('\n') + '\n\n'
  }
  
  if (categorizedInfo.meeting) {
    compressed += '【会议任务】\n' + categorizedInfo.meeting.slice(0, 3).join('\n') + '\n\n'
  }
  
  if (categorizedInfo.team) {
    compressed += '【团队信息】\n' + categorizedInfo.team.slice(0, 2).join('\n') + '\n\n'
  }
  
  if (categorizedInfo.time) {
    compressed += '【时间信息】\n' + categorizedInfo.time.slice(0, 3).join('\n') + '\n\n'
  }
  
  // 如果压缩后仍然太长，进一步截取
  if (compressed.length > 1500) {
    compressed = compressed.substring(0, 1500) + '...(内容已截取)'
  }
  
  compressed += '\n\n⚠️ 重要提醒：以上为历史对话摘要，请专注于当前用户查询，必须调用MCP工具获取最新实时数据！'
  
  return compressed
}

// 高级上下文压缩 - 模拟LLM压缩（可改为实际API调用）
const advancedContextCompression = async (content: string): Promise<string> => {
  console.log('[高级压缩] 处理超大内容，使用高级压缩算法')
  
  // 这里可以调用外部LLM API进行压缩
  // 现在使用更激进的规则压缩
  
  const lines = content.split('\n').filter(line => line.trim())
  const veryImportantLines: string[] = []
  
  // 更严格的过滤规则
  for (const line of lines) {
    if (
      line.includes('工作计划') ||
      line.includes('任务内容') ||
      line.includes('责任主体') ||
      line.includes('完成情况') ||
      line.includes('时间节点') ||
      line.match(/第?\d+周/) ||
      line.match(/\d{4}-\d{2}-\d{2}/) ||
      (line.includes('团队') && (line.includes('大模型') || line.includes('科学计算') || line.includes('具身智能') || line.includes('技术管理')))
    ) {
      veryImportantLines.push(line)
    }
  }
  
  // 按类型进一步分组和去重
  const uniqueInfo = [...new Set(veryImportantLines)]
  
  let compressed = '历史对话核心信息（高级压缩）：\n\n'
  compressed += uniqueInfo.slice(0, 10).join('\n')
  
  if (compressed.length > 1000) {
    compressed = compressed.substring(0, 1000) + '...'
  }
  
  compressed += '\n\n🔥 关键提醒：上述为超大上下文的核心摘要，请忽略历史细节，专注当前查询，强制调用MCP工具获取实时数据！'
  
  return compressed
}

// 自动重试包装器 - 当智慧办公助手需要强制调用工具但未调用时自动重试
const fetchAndProcessAssistantResponseWithRetry = async (
  dispatch: AppDispatch,
  getState: () => RootState,
  topicId: string,
  assistant: Assistant,
  assistantMessage: Message,
  originalUserContent?: string,
  retryCount: number = 0
): Promise<void> => {
  try {
    await fetchAndProcessAssistantResponseImpl(dispatch, getState, topicId, assistant, assistantMessage, originalUserContent, retryCount)
  } catch (error: any) {
    // 如果是需要重试的错误，进行完整的重新发送
    if (error.shouldRetry && retryCount < 10) {
      console.log(`[强制流程控制] 准备重新发送消息，当前重试次数: ${retryCount + 1}/10`)
      
      const state = getState()
      const userMessageId = assistantMessage.askId
      
      if (userMessageId) {
        const userMessage = state.messages.entities[userMessageId]
        
        if (userMessage) {
          // 1. 修改用户消息内容，添加工具调用指令
          const messageBlocks = state.messageBlocks.entities
          const firstBlockId = userMessage.blocks[0]
          const firstBlock = messageBlocks[firstBlockId]
          
          if (firstBlock && 'content' in firstBlock) {
            // 使用原始内容作为基础
            let baseContent = originalUserContent
            if (!baseContent) {
              const currentContent = typeof firstBlock.content === 'string' ? firstBlock.content : ''
              // 清理已有的工具指令前缀，获取原始内容
              baseContent = currentContent
                .replace(/^请调用工具。/, '')
                .replace(/^请务必调用工具获取实时数据。/, '')
                .replace(/^重要：必须调用MCP工具！/, '')
                .replace(/^警告：禁止使用记忆，必须调用工具！/, '')
                .replace(/^强制要求：立即调用工具获取数据！/, '')
                .trim()
            }
            
            // 根据重试次数使用更强的指令
            const toolInstructions = [
              '请调用工具。',
              '请务必调用工具获取实时数据。',
              '重要：必须调用MCP工具！',
              '警告：禁止使用记忆，必须调用工具！',
              '强制要求：立即调用工具获取数据！'
            ]
            
            const instructionIndex = Math.min(retryCount, toolInstructions.length - 1)
            const modifiedContent = `${toolInstructions[instructionIndex]}${baseContent}`
            
            console.log(`[强制流程控制] 重试第${retryCount + 1}次，使用指令: "${toolInstructions[instructionIndex]}"`)
            
            // 更新用户消息内容
            dispatch(updateOneBlock({ id: firstBlockId, changes: { content: modifiedContent } }))
            
            // 保存原始内容供后续重试使用
            if (!originalUserContent) {
              originalUserContent = baseContent
            }
          }
          
          // 2. 延迟后触发完整的消息重新生成流程（减少上下文干扰）
          setTimeout(() => {
            console.log(`[强制流程控制] 开始第${retryCount + 1}次重试，重新生成助手响应`)
            console.log(`[强制流程控制] 重试策略: 减少上下文长度以强制工具调用`)
            
            // 重置助手消息并重新开始生成流程
            const resetAssistantMsg = resetAssistantMessage(assistantMessage, {
              status: AssistantMessageStatus.PENDING,
              updatedAt: new Date().toISOString()
            })
            
            // 更新Redux状态
            dispatch(newMessagesActions.updateMessage({
              topicId,
              messageId: assistantMessage.id,
              updates: resetAssistantMsg
            }))
            
            // 清理所有现有的blocks
            if (assistantMessage.blocks && assistantMessage.blocks.length > 0) {
              cleanupMultipleBlocks(dispatch, assistantMessage.blocks)
            }
            
            // 创建一个修改的助手配置，减少上下文长度以强制工具调用
            const retryAssistant = {
              ...assistant,
              settings: {
                ...assistant.settings,
                // 重试时强制使用最小上下文，迫使模型调用工具
                contextCount: 1
              }
            }
            
            console.log(`[强制流程控制] 重试配置: contextCount=${retryAssistant.settings?.contextCount}`)
            
            // 重新开始生成流程（带重试计数和减少的上下文）
            fetchAndProcessAssistantResponseWithRetry(dispatch, getState, topicId, retryAssistant, resetAssistantMsg, originalUserContent, retryCount + 1)
          }, 2000) // 减少延迟到2秒，快速重试
          
          return // 防止继续执行
        }
      }
      
      // 如果无法获取用户消息，回退到原有逻辑
      throw error
    } else {
      // 超过最大重试次数或其他错误，抛出
      throw error
    }
  }
}

// Internal function extracted from sendMessage to handle fetching and processing assistant response
const fetchAndProcessAssistantResponseImpl = async (
  dispatch: AppDispatch,
  getState: () => RootState,
  topicId: string,
  assistant: Assistant,
  assistantMessage: Message, // Pass the prepared assistant message (new or reset)
  _originalUserContent?: string,
  currentRetryCount: number = 0
) => {
  const assistantMsgId = assistantMessage.id
  let callbacks: StreamProcessorCallbacks = {}
  
  // 智慧办公助手强制流程控制变量 - 每次调用都重置
  let hasToolCall = false
  let hasMCPToolCall = false // 专门检测MCP工具调用
  let isOfficeAssistant = assistant.name === '智慧办公助手'
  let textLength = 0
  let forcedToolCallRequired = false
  let originalUserQuery = '' // 原始用户问题
  
  // 每次调用都重置检测状态，确保准确检测
  console.log(`[强制流程控制] 开始新的检测周期 - 重试次数: ${currentRetryCount}, 助手: ${assistant.name}`)
  console.log(`[强制流程控制] 初始状态 - hasToolCall: ${hasToolCall}, hasMCPToolCall: ${hasMCPToolCall}`)
  
  // 智慧办公助手强制MCP工具调用检查
  if (isOfficeAssistant) {
    console.log('[强制流程控制] 检测到智慧办公助手，检查是否需要强制调用MCP工具')
    
    // 获取用户消息内容
    const userMessageId = assistantMessage.askId
    if (userMessageId) {
      const state = getState()
      const userMessage = state.messages.entities[userMessageId]
      
      if (userMessage && userMessage.blocks.length > 0) {
        // 获取消息块实体
        const messageBlocks = state.messageBlocks.entities
        
        // 提取用户查询文本
        const userQuery = userMessage.blocks
          .map(blockId => {
            const block = messageBlocks[blockId]
            // 只从有内容的块类型中提取文本
            if (block && 'content' in block) {
              return block.content || ''
            }
            return ''
          })
          .join(' ')
        
        // 保存原始用户查询（用于重试）
        originalUserQuery = userQuery
        
        // 智慧办公助手强制要求所有询问都调用MCP工具
        forcedToolCallRequired = true
        console.log('[强制流程控制] 智慧办公助手强制要求所有询问都调用MCP工具:', userQuery.substring(0, 100))
      }
    }
  }
  
  try {
    dispatch(newMessagesActions.setTopicLoading({ topicId, loading: true }))

    // 如果是强制要求调用工具的查询，设置一个延时检查
    if (forcedToolCallRequired) {
      setTimeout(() => {
        if (!hasToolCall) {
          console.warn('[强制流程控制] 30秒内未检测到MCP工具调用，可能需要强制中断')
        }
      }, 30000)
    }

    let accumulatedContent = ''
    let accumulatedThinking = ''
    // 专注于管理UI焦点和块切换
    let lastBlockId: string | null = null
    let lastBlockType: MessageBlockType | null = null
    // 专注于块内部的生命周期处理
    let initialPlaceholderBlockId: string | null = null
    let citationBlockId: string | null = null
    let mainTextBlockId: string | null = null
    let thinkingBlockId: string | null = null
    let imageBlockId: string | null = null
    let toolBlockId: string | null = null
    let hasWebSearch = false
    const toolCallIdToBlockIdMap = new Map<string, string>()
    const notificationService = NotificationService.getInstance()

    const handleBlockTransition = async (newBlock: MessageBlock, newBlockType: MessageBlockType) => {
      lastBlockId = newBlock.id
      lastBlockType = newBlockType
      if (newBlockType !== MessageBlockType.MAIN_TEXT) {
        accumulatedContent = ''
      }
      if (newBlockType !== MessageBlockType.THINKING) {
        accumulatedThinking = ''
      }
      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId: assistantMsgId,
          updates: { blockInstruction: { id: newBlock.id } }
        })
      )
      dispatch(upsertOneBlock(newBlock))
      dispatch(
        newMessagesActions.upsertBlockReference({
          messageId: assistantMsgId,
          blockId: newBlock.id,
          status: newBlock.status
        })
      )

      const currentState = getState()
      const updatedMessage = currentState.messages.entities[assistantMsgId]
      if (updatedMessage) {
        await saveUpdatesToDB(assistantMsgId, topicId, { blocks: updatedMessage.blocks }, [newBlock])
      } else {
        console.error(`[handleBlockTransition] Failed to get updated message ${assistantMsgId} from state for DB save.`)
      }
    }

    const allMessagesForTopic = selectMessagesForTopic(getState(), topicId)

    let messagesForContext: Message[] = []
    const userMessageId = assistantMessage.askId
    const userMessageIndex = allMessagesForTopic.findIndex((m) => m?.id === userMessageId)

    if (userMessageIndex === -1) {
      console.error(
        `[fetchAndProcessAssistantResponseImpl] Triggering user message ${userMessageId} (askId of ${assistantMsgId}) not found. Falling back.`
      )
      const assistantMessageIndexFallback = allMessagesForTopic.findIndex((m) => m?.id === assistantMsgId)
      messagesForContext = (
        assistantMessageIndexFallback !== -1
          ? allMessagesForTopic.slice(0, assistantMessageIndexFallback)
          : allMessagesForTopic
      ).filter((m) => m && !m.status?.includes('ing'))
    } else {
      const contextSlice = allMessagesForTopic.slice(0, userMessageIndex + 1)
      messagesForContext = contextSlice.filter((m) => m && !m.status?.includes('ing'))
    }

    // 智慧办公助手的智能上下文压缩
    if (isOfficeAssistant) {
      messagesForContext = await compressContextForOfficeAssistant(messagesForContext, dispatch, getState)
    }

    callbacks = {
      onLLMResponseCreated: async () => {
        const baseBlock = createBaseMessageBlock(assistantMsgId, MessageBlockType.UNKNOWN, {
          status: MessageBlockStatus.PROCESSING
        })
        initialPlaceholderBlockId = baseBlock.id
        await handleBlockTransition(baseBlock as PlaceholderMessageBlock, MessageBlockType.UNKNOWN)
      },
      onTextChunk: async (text) => {
        textLength += text.length
        
        // 智慧办公助手强制流程控制：检测未调用MCP工具的文本生成
        // 使用更合理的阈值，确保能检测到真正的文本生成而非工具调用过程
        const textThreshold = 50
        if (isOfficeAssistant && !hasMCPToolCall && textLength > textThreshold) {
          console.warn(`[强制流程控制] 智慧办公助手在未调用MCP工具情况下生成文本，准备自动重试`)
          console.log(`[强制流程控制] 检测状态详情:`, {
            hasToolCall,
            hasMCPToolCall,
            forcedToolCallRequired,
            textLength,
            textThreshold,
            currentRetryCount,
            assistantName: assistant.name,
            textPreview: text.substring(0, 50) + '...'
          })
          
          // 智慧办公助手必须调用MCP工具，未达到最大重试次数时自动重试
          if (currentRetryCount < 10) {
            // 显示"请稍等"提示（更简洁）
            const waitingText = '⏳ 重新尝试获取实时数据...'
            
            if (mainTextBlockId) {
              const changes = {
                content: waitingText,
                status: MessageBlockStatus.PROCESSING
              }
              dispatch(updateOneBlock({ id: mainTextBlockId, changes }))
            } else if (initialPlaceholderBlockId) {
              const changes = {
                type: MessageBlockType.MAIN_TEXT,
                content: waitingText,
                status: MessageBlockStatus.PROCESSING
              }
              dispatch(updateOneBlock({ id: initialPlaceholderBlockId, changes }))
            }
            
            // 中断当前流处理
            try {
              abortCompletion(assistantMsgId)
            } catch (error) {
              console.warn('[强制流程控制] AbortController中断失败:', error)
            }
            
            // 抛出重试错误
            const retryError: any = new Error('智慧办公助手必须调用MCP工具获取实时数据')
            retryError.shouldRetry = true
            retryError.originalQuery = originalUserQuery
            throw retryError
          } else {
            // 达到最大重试次数，显示最终错误
            const errorText = '❌ **无法获取实时数据**\n\n经过多次尝试，系统仍无法调用MCP工具获取实时数据。请检查工具配置或重新提问。'
            
            if (mainTextBlockId) {
              const changes = {
                content: errorText,
                status: MessageBlockStatus.ERROR
              }
              dispatch(updateOneBlock({ id: mainTextBlockId, changes }))
              saveUpdatedBlockToDB(mainTextBlockId, assistantMsgId, topicId, getState)
            }
            
            dispatch(
              newMessagesActions.updateMessage({
                topicId,
                messageId: assistantMsgId,
                updates: { status: AssistantMessageStatus.SUCCESS }
              })
            )
            
            dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
            return
          }
        }
        
        accumulatedContent += text
        if (mainTextBlockId) {
          const blockChanges: Partial<MessageBlock> = {
            content: accumulatedContent,
            status: MessageBlockStatus.STREAMING
          }
          throttledBlockUpdate(mainTextBlockId, blockChanges)
        } else if (initialPlaceholderBlockId) {
          // 将占位块转换为主文本块
          const initialChanges: Partial<MessageBlock> = {
            type: MessageBlockType.MAIN_TEXT,
            content: accumulatedContent,
            status: MessageBlockStatus.STREAMING,
            citationReferences: citationBlockId ? [{ citationBlockId }] : []
          }
          mainTextBlockId = initialPlaceholderBlockId
          // 清理占位块
          initialPlaceholderBlockId = null
          lastBlockType = MessageBlockType.MAIN_TEXT
          dispatch(updateOneBlock({ id: mainTextBlockId, changes: initialChanges }))
          saveUpdatedBlockToDB(mainTextBlockId, assistantMsgId, topicId, getState)
        } else {
          const newBlock = createMainTextBlock(assistantMsgId, accumulatedContent, {
            status: MessageBlockStatus.STREAMING,
            citationReferences: citationBlockId ? [{ citationBlockId }] : []
          })
          mainTextBlockId = newBlock.id // 立即设置ID，防止竞态条件
          await handleBlockTransition(newBlock, MessageBlockType.MAIN_TEXT)
        }
      },
      onTextComplete: async (finalText) => {
        // 使用自动重试机制，无需在这里添加警告
        
        if (mainTextBlockId) {
          const changes = {
            content: finalText,
            status: MessageBlockStatus.SUCCESS
          }
          cancelThrottledBlockUpdate(mainTextBlockId)
          dispatch(updateOneBlock({ id: mainTextBlockId, changes }))
          saveUpdatedBlockToDB(mainTextBlockId, assistantMsgId, topicId, getState)
          mainTextBlockId = null
        } else {
          console.warn(
            `[onTextComplete] Received text.complete but last block was not MAIN_TEXT (was ${lastBlockType}) or lastBlockId  is null.`
          )
        }
        if (citationBlockId && !hasWebSearch) {
          const changes: Partial<CitationMessageBlock> = {
            status: MessageBlockStatus.SUCCESS
          }
          dispatch(updateOneBlock({ id: citationBlockId, changes }))
          saveUpdatedBlockToDB(citationBlockId, assistantMsgId, topicId, getState)
          citationBlockId = null
        }
      },
      onThinkingChunk: async (text, thinking_millsec) => {
        accumulatedThinking += text
        if (thinkingBlockId) {
          const blockChanges: Partial<MessageBlock> = {
            content: accumulatedThinking,
            status: MessageBlockStatus.STREAMING,
            thinking_millsec: thinking_millsec
          }
          throttledBlockUpdate(thinkingBlockId, blockChanges)
        } else if (initialPlaceholderBlockId) {
          // First chunk for this block: Update type and status immediately
          lastBlockType = MessageBlockType.THINKING
          const initialChanges: Partial<MessageBlock> = {
            type: MessageBlockType.THINKING,
            content: accumulatedThinking,
            status: MessageBlockStatus.STREAMING
          }
          thinkingBlockId = initialPlaceholderBlockId
          initialPlaceholderBlockId = null
          dispatch(updateOneBlock({ id: thinkingBlockId, changes: initialChanges }))
          saveUpdatedBlockToDB(thinkingBlockId, assistantMsgId, topicId, getState)
        } else {
          const newBlock = createThinkingBlock(assistantMsgId, accumulatedThinking, {
            status: MessageBlockStatus.STREAMING,
            thinking_millsec: 0
          })
          thinkingBlockId = newBlock.id // 立即设置ID，防止竞态条件
          await handleBlockTransition(newBlock, MessageBlockType.THINKING)
        }
      },
      onThinkingComplete: (finalText, final_thinking_millsec) => {
        if (thinkingBlockId) {
          const changes = {
            type: MessageBlockType.THINKING,
            content: finalText,
            status: MessageBlockStatus.SUCCESS,
            thinking_millsec: final_thinking_millsec
          }
          cancelThrottledBlockUpdate(thinkingBlockId)
          dispatch(updateOneBlock({ id: thinkingBlockId, changes }))
          saveUpdatedBlockToDB(thinkingBlockId, assistantMsgId, topicId, getState)
        } else {
          console.warn(
            `[onThinkingComplete] Received thinking.complete but last block was not THINKING (was ${lastBlockType}) or lastBlockId  is null.`
          )
        }
        thinkingBlockId = null
      },
      onToolCallInProgress: (toolResponse: MCPToolResponse) => {
        // 重点检测MCP_TOOL_IN_PROGRESS和invoking状态
        console.log('[MCP检测] 工具调用进行中 - 状态:', toolResponse.status, '工具:', toolResponse.tool?.name, 'ID:', toolResponse.id)
        
        // 任何工具调用都标记为hasToolCall
        hasToolCall = true
        
        // 更宽松的MCP工具检测条件，检测到任何工具调用就算成功
        if (toolResponse.tool && toolResponse.tool.name) {
          hasMCPToolCall = true
          
          if (isOfficeAssistant) {
            console.log('[强制流程控制] ✅ 智慧办公助手检测到MCP工具调用:', {
              toolName: toolResponse.tool.name,
              status: toolResponse.status,
              id: toolResponse.id,
              serverId: toolResponse.tool.serverId,
              serverName: toolResponse.tool.serverName,
              retryCount: currentRetryCount
            })
          }
        } else {
          // 即使没有工具信息，只要有status也可能是MCP调用
          if (toolResponse.status === 'invoking' || toolResponse.status === 'processing') {
            hasMCPToolCall = true
            hasToolCall = true
            
            if (isOfficeAssistant) {
              console.log('[强制流程控制] ✅ 智慧办公助手检测到工具状态:', {
                status: toolResponse.status,
                id: toolResponse.id,
                retryCount: currentRetryCount
              })
            }
          } else if (isOfficeAssistant) {
            console.warn('[强制流程控制] ❌ 检测到工具调用但缺少关键信息:', {
              status: toolResponse.status,
              hasTool: !!toolResponse.tool,
              toolName: toolResponse.tool?.name,
              id: toolResponse.id
            })
          }
        }
        
        if (initialPlaceholderBlockId) {
          lastBlockType = MessageBlockType.TOOL
          const changes = {
            type: MessageBlockType.TOOL,
            status: MessageBlockStatus.PROCESSING,
            metadata: { rawMcpToolResponse: toolResponse }
          }
          toolBlockId = initialPlaceholderBlockId
          initialPlaceholderBlockId = null
          dispatch(updateOneBlock({ id: toolBlockId, changes }))
          saveUpdatedBlockToDB(toolBlockId, assistantMsgId, topicId, getState)
          toolCallIdToBlockIdMap.set(toolResponse.id, toolBlockId)
        } else if (toolResponse.status === 'invoking') {
          const toolBlock = createToolBlock(assistantMsgId, toolResponse.id, {
            toolName: toolResponse.tool.name,
            status: MessageBlockStatus.PROCESSING,
            metadata: { rawMcpToolResponse: toolResponse }
          })
          handleBlockTransition(toolBlock, MessageBlockType.TOOL)
          toolCallIdToBlockIdMap.set(toolResponse.id, toolBlock.id)
        } else {
          console.warn(
            `[onToolCallInProgress] Received unhandled tool status: ${toolResponse.status} for ID: ${toolResponse.id}`
          )
        }
      },
      onToolCallComplete: (toolResponse: MCPToolResponse) => {
        // 检测MCP工具调用完成状态
        console.log('[MCP检测] 工具调用完成 - 状态:', toolResponse.status, '工具:', toolResponse.tool?.name, 'ID:', toolResponse.id)
        
        // 确保工具调用标记
        hasToolCall = true
        
        // 更宽松的MCP工具调用完成检测
        if (toolResponse.tool && toolResponse.tool.name) {
          hasMCPToolCall = true
          
          if (isOfficeAssistant) {
            console.log('[强制流程控制] ✅ 智慧办公助手工具调用完成:', {
              toolName: toolResponse.tool.name,
              status: toolResponse.status,
              id: toolResponse.id,
              hasResponse: !!toolResponse.response,
              responseType: typeof toolResponse.response,
              responsePreview: toolResponse.response ? 
                (typeof toolResponse.response === 'string' ? 
                  toolResponse.response.substring(0, 100) + '...' : 
                  'object-type') : 'no-response',
              retryCount: currentRetryCount
            })
          }
        } else {
          // 即使没有工具信息，只要状态为完成也算成功
          if (toolResponse.status === 'done' || toolResponse.status === 'error' || toolResponse.status === 'success') {
            hasMCPToolCall = true
            hasToolCall = true
            
            if (isOfficeAssistant) {
              console.log('[强制流程控制] ✅ 智慧办公助手检测到工具完成状态:', {
                status: toolResponse.status,
                id: toolResponse.id,
                hasResponse: !!toolResponse.response,
                retryCount: currentRetryCount
              })
            }
          } else if (isOfficeAssistant) {
            console.warn('[强制流程控制] ❌ 工具调用完成但缺少关键信息:', {
              status: toolResponse.status,
              hasTool: !!toolResponse.tool,
              toolName: toolResponse.tool?.name,
              id: toolResponse.id,
              hasResponse: !!toolResponse.response
            })
          }
        }
        
        const existingBlockId = toolCallIdToBlockIdMap.get(toolResponse.id)
        toolCallIdToBlockIdMap.delete(toolResponse.id)
        if (toolResponse.status === 'done' || toolResponse.status === 'error') {
          if (!existingBlockId) {
            console.error(
              `[onToolCallComplete] No existing block found for completed/error tool call ID: ${toolResponse.id}. Cannot update.`
            )
            return
          }
          const finalStatus = toolResponse.status === 'done' ? MessageBlockStatus.SUCCESS : MessageBlockStatus.ERROR
          const changes: Partial<ToolMessageBlock> = {
            content: toolResponse.response,
            status: finalStatus,
            metadata: { rawMcpToolResponse: toolResponse }
          }
          if (finalStatus === MessageBlockStatus.ERROR) {
            changes.error = { message: `Tool execution failed/error`, details: toolResponse.response }
          }
          cancelThrottledBlockUpdate(existingBlockId)
          dispatch(updateOneBlock({ id: existingBlockId, changes }))
          saveUpdatedBlockToDB(existingBlockId, assistantMsgId, topicId, getState)
        } else {
          console.warn(
            `[onToolCallComplete] Received unhandled tool status: ${toolResponse.status} for ID: ${toolResponse.id}`
          )
        }
      },
      onExternalToolInProgress: async () => {
        const citationBlock = createCitationBlock(assistantMsgId, {}, { status: MessageBlockStatus.PROCESSING })
        citationBlockId = citationBlock.id
        await handleBlockTransition(citationBlock, MessageBlockType.CITATION)
        // saveUpdatedBlockToDB(citationBlock.id, assistantMsgId, topicId, getState)
      },
      onExternalToolComplete: (externalToolResult: ExternalToolResult) => {
        if (citationBlockId) {
          const changes: Partial<CitationMessageBlock> = {
            response: externalToolResult.webSearch,
            knowledge: externalToolResult.knowledge,
            status: MessageBlockStatus.SUCCESS
          }
          dispatch(updateOneBlock({ id: citationBlockId, changes }))
          saveUpdatedBlockToDB(citationBlockId, assistantMsgId, topicId, getState)
        } else {
          console.error('[onExternalToolComplete] citationBlockId is null. Cannot update.')
        }
      },
      onLLMWebSearchInProgress: async () => {
        if (initialPlaceholderBlockId) {
          lastBlockType = MessageBlockType.CITATION
          citationBlockId = initialPlaceholderBlockId
          const changes = {
            type: MessageBlockType.CITATION,
            status: MessageBlockStatus.PROCESSING
          }
          lastBlockType = MessageBlockType.CITATION
          dispatch(updateOneBlock({ id: initialPlaceholderBlockId, changes }))
          saveUpdatedBlockToDB(initialPlaceholderBlockId, assistantMsgId, topicId, getState)
          initialPlaceholderBlockId = null
        } else {
          const citationBlock = createCitationBlock(assistantMsgId, {}, { status: MessageBlockStatus.PROCESSING })
          citationBlockId = citationBlock.id
          await handleBlockTransition(citationBlock, MessageBlockType.CITATION)
        }
      },
      onLLMWebSearchComplete: async (llmWebSearchResult) => {
        if (citationBlockId) {
          hasWebSearch = true
          const changes: Partial<CitationMessageBlock> = {
            response: llmWebSearchResult,
            status: MessageBlockStatus.SUCCESS
          }
          dispatch(updateOneBlock({ id: citationBlockId, changes }))
          saveUpdatedBlockToDB(citationBlockId, assistantMsgId, topicId, getState)

          if (mainTextBlockId) {
            const state = getState()
            const existingMainTextBlock = state.messageBlocks.entities[mainTextBlockId]
            if (existingMainTextBlock && existingMainTextBlock.type === MessageBlockType.MAIN_TEXT) {
              const currentRefs = existingMainTextBlock.citationReferences || []
              const mainTextChanges = {
                citationReferences: [
                  ...currentRefs,
                  { citationBlockId, citationBlockSource: llmWebSearchResult.source }
                ]
              }
              dispatch(updateOneBlock({ id: mainTextBlockId, changes: mainTextChanges }))
              saveUpdatedBlockToDB(mainTextBlockId, assistantMsgId, topicId, getState)
            }
            mainTextBlockId = null
          }
        }
      },
      onImageCreated: async () => {
        if (initialPlaceholderBlockId) {
          lastBlockType = MessageBlockType.IMAGE
          const initialChanges: Partial<MessageBlock> = {
            type: MessageBlockType.IMAGE,
            status: MessageBlockStatus.STREAMING
          }
          lastBlockType = MessageBlockType.IMAGE
          imageBlockId = initialPlaceholderBlockId
          initialPlaceholderBlockId = null
          dispatch(updateOneBlock({ id: imageBlockId, changes: initialChanges }))
          saveUpdatedBlockToDB(imageBlockId, assistantMsgId, topicId, getState)
        } else if (!imageBlockId) {
          const imageBlock = createImageBlock(assistantMsgId, {
            status: MessageBlockStatus.STREAMING
          })
          imageBlockId = imageBlock.id
          await handleBlockTransition(imageBlock, MessageBlockType.IMAGE)
        }
      },
      onImageDelta: (imageData) => {
        const imageUrl = imageData.images?.[0] || 'placeholder_image_url'
        if (imageBlockId) {
          const changes: Partial<ImageMessageBlock> = {
            url: imageUrl,
            metadata: { generateImageResponse: imageData },
            status: MessageBlockStatus.STREAMING
          }
          dispatch(updateOneBlock({ id: imageBlockId, changes }))
          saveUpdatedBlockToDB(imageBlockId, assistantMsgId, topicId, getState)
        }
      },
      onImageGenerated: (imageData) => {
        if (imageBlockId) {
          if (!imageData) {
            const changes: Partial<ImageMessageBlock> = {
              status: MessageBlockStatus.SUCCESS
            }
            dispatch(updateOneBlock({ id: imageBlockId, changes }))
            saveUpdatedBlockToDB(imageBlockId, assistantMsgId, topicId, getState)
          } else {
            const imageUrl = imageData.images?.[0] || 'placeholder_image_url'
            const changes: Partial<ImageMessageBlock> = {
              url: imageUrl,
              metadata: { generateImageResponse: imageData },
              status: MessageBlockStatus.SUCCESS
            }
            dispatch(updateOneBlock({ id: imageBlockId, changes }))
            saveUpdatedBlockToDB(imageBlockId, assistantMsgId, topicId, getState)
          }
        } else {
          console.error('[onImageGenerated] Last block was not an Image block or ID is missing.')
        }
        imageBlockId = null
      },
      onError: async (error) => {
        console.dir(error, { depth: null })
        const isErrorTypeAbort = isAbortError(error)
        let pauseErrorLanguagePlaceholder = ''
        if (isErrorTypeAbort) {
          pauseErrorLanguagePlaceholder = 'pause_placeholder'
        }

        const serializableError = {
          name: error.name,
          message: pauseErrorLanguagePlaceholder || error.message || formatErrorMessage(error),
          originalMessage: error.message,
          stack: error.stack,
          status: error.status || error.code,
          requestId: error.request_id
        }
        if (!isOnHomePage()) {
          await notificationService.send({
            id: uuid(),
            type: 'error',
            title: t('notification.assistant'),
            message: serializableError.message,
            silent: false,
            timestamp: Date.now(),
            source: 'assistant'
          })
        }
        const possibleBlockId =
          mainTextBlockId || thinkingBlockId || toolBlockId || imageBlockId || citationBlockId || lastBlockId
        if (possibleBlockId) {
          // 更改上一个block的状态为ERROR
          const changes: Partial<MessageBlock> = {
            status: isErrorTypeAbort ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
          }
          cancelThrottledBlockUpdate(possibleBlockId)
          dispatch(updateOneBlock({ id: possibleBlockId, changes }))
          saveUpdatedBlockToDB(possibleBlockId, assistantMsgId, topicId, getState)
        }

        const errorBlock = createErrorBlock(assistantMsgId, serializableError, { status: MessageBlockStatus.SUCCESS })
        await handleBlockTransition(errorBlock, MessageBlockType.ERROR)
        const messageErrorUpdate = {
          status: isErrorTypeAbort ? AssistantMessageStatus.SUCCESS : AssistantMessageStatus.ERROR
        }
        dispatch(newMessagesActions.updateMessage({ topicId, messageId: assistantMsgId, updates: messageErrorUpdate }))

        saveUpdatesToDB(assistantMsgId, topicId, messageErrorUpdate, [])

        EventEmitter.emit(EVENT_NAMES.MESSAGE_COMPLETE, {
          id: assistantMsgId,
          topicId,
          status: isErrorTypeAbort ? 'pause' : 'error',
          error: error.message
        })
      },
      onComplete: async (status: AssistantMessageStatus, response?: Response) => {
        // 智慧办公助手：在完成时最终验证是否调用了MCP工具
        if (isOfficeAssistant && status === 'success') {
          console.log(`[强制流程控制] 助手响应完成，最终检查MCP工具调用状态:`, {
            hasToolCall,
            hasMCPToolCall,
            forcedToolCallRequired,
            textLength,
            currentRetryCount
          })
          
          // 如果是智慧办公助手但没有调用MCP工具，触发重试
          if (!hasMCPToolCall && currentRetryCount < 10) {
            console.warn(`[强制流程控制] 响应完成但未检测到MCP工具调用，准备重试`)
            
            // 显示重试提示
            const retryText = '⏳ **正在重试**\n\n检测到未调用MCP工具，正在重新尝试获取实时数据...'
            
            const state = getState()
            const currentMessage = state.messages.entities[assistantMsgId]
            if (currentMessage && currentMessage.blocks && currentMessage.blocks.length > 0) {
              const firstBlockId = currentMessage.blocks[0]
              dispatch(updateOneBlock({ 
                id: firstBlockId, 
                changes: { 
                  content: retryText,
                  status: MessageBlockStatus.PROCESSING
                } 
              }))
            }
            
            // 抛出重试错误
            const retryError: any = new Error('智慧办公助手必须调用MCP工具获取实时数据')
            retryError.shouldRetry = true
            retryError.originalQuery = originalUserQuery
            throw retryError
          }
          
          // 如果达到最大重试次数仍未调用工具
          if (!hasMCPToolCall && currentRetryCount >= 10) {
            console.error(`[强制流程控制] 达到最大重试次数，仍未检测到MCP工具调用`)
            
            const errorText = '❌ **无法获取实时数据**\n\n经过多次尝试，系统仍无法调用MCP工具获取实时数据。请检查工具配置或重新提问。'
            
            const state = getState()
            const currentMessage = state.messages.entities[assistantMsgId]
            if (currentMessage && currentMessage.blocks && currentMessage.blocks.length > 0) {
              const firstBlockId = currentMessage.blocks[0]
              dispatch(updateOneBlock({ 
                id: firstBlockId, 
                changes: { 
                  content: errorText,
                  status: MessageBlockStatus.ERROR
                } 
              }))
            }
            
            dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
            return
          }
        }

        const finalStateOnComplete = getState()
        const finalAssistantMsg = finalStateOnComplete.messages.entities[assistantMsgId]

        if (status === 'success' && finalAssistantMsg) {
          const userMsgId = finalAssistantMsg.askId
          const orderedMsgs = selectMessagesForTopic(finalStateOnComplete, topicId)
          const userMsgIndex = orderedMsgs.findIndex((m) => m.id === userMsgId)
          const contextForUsage = userMsgIndex !== -1 ? orderedMsgs.slice(0, userMsgIndex + 1) : []
          const finalContextWithAssistant = [...contextForUsage, finalAssistantMsg]

          const possibleBlockId =
            mainTextBlockId || thinkingBlockId || toolBlockId || imageBlockId || citationBlockId || lastBlockId
          if (possibleBlockId) {
            const changes: Partial<MessageBlock> = {
              status: MessageBlockStatus.SUCCESS
            }
            cancelThrottledBlockUpdate(possibleBlockId)
            dispatch(updateOneBlock({ id: possibleBlockId, changes }))
            saveUpdatedBlockToDB(possibleBlockId, assistantMsgId, topicId, getState)
          }

          const endTime = Date.now()
          const duration = endTime - startTime
          const content = getMainTextContent(finalAssistantMsg)
          if (!isOnHomePage() && duration > 60 * 1000) {
            await notificationService.send({
              id: uuid(),
              type: 'success',
              title: t('notification.assistant'),
              message: content.length > 50 ? content.slice(0, 47) + '...' : content,
              silent: false,
              timestamp: Date.now(),
              source: 'assistant'
            })
          }

          // 更新topic的name
          autoRenameTopic(assistant, topicId)

          if (
            response &&
            (response.usage?.total_tokens === 0 ||
              response?.usage?.prompt_tokens === 0 ||
              response?.usage?.completion_tokens === 0)
          ) {
            const usage = await estimateMessagesUsage({ assistant, messages: finalContextWithAssistant })
            response.usage = usage
          }
          dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
        }
        if (response && response.metrics) {
          if (response.metrics.completion_tokens === 0 && response.usage?.completion_tokens) {
            response = {
              ...response,
              metrics: {
                ...response.metrics,
                completion_tokens: response.usage.completion_tokens
              }
            }
          }
        }

        const messageUpdates: Partial<Message> = { status, metrics: response?.metrics, usage: response?.usage }
        dispatch(
          newMessagesActions.updateMessage({
            topicId,
            messageId: assistantMsgId,
            updates: messageUpdates
          })
        )
        saveUpdatesToDB(assistantMsgId, topicId, messageUpdates, [])

        EventEmitter.emit(EVENT_NAMES.MESSAGE_COMPLETE, { id: assistantMsgId, topicId, status })
      }
    }

    const streamProcessorCallbacks = createStreamProcessor(callbacks)

    const startTime = Date.now()
    await fetchChatCompletion({
      messages: messagesForContext,
      assistant: assistant,
      onChunkReceived: streamProcessorCallbacks
    })
  } catch (error: any) {
    console.error('Error fetching chat completion:', error)
    if (assistantMessage) {
      callbacks.onError?.(error)
      throw error
    }
  }
}

/**
 * 发送消息并处理助手回复
 * @param userMessage 已创建的用户消息
 * @param userMessageBlocks 用户消息关联的消息块
 * @param assistant 助手对象
 * @param topicId 主题ID
 */
export const sendMessage =
  (userMessage: Message, userMessageBlocks: MessageBlock[], assistant: Assistant, topicId: Topic['id']) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      if (userMessage.blocks.length === 0) {
        console.warn('sendMessage: No blocks in the provided message.')
        return
      }
      await saveMessageAndBlocksToDB(userMessage, userMessageBlocks)
      dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))
      if (userMessageBlocks.length > 0) {
        dispatch(upsertManyBlocks(userMessageBlocks))
      }

      const mentionedModels = userMessage.mentions
      const queue = getTopicQueue(topicId)

      if (mentionedModels && mentionedModels.length > 0) {
        await dispatchMultiModelResponses(dispatch, getState, topicId, userMessage, assistant, mentionedModels)
      } else {
        const assistantMessage = createAssistantMessage(assistant.id, topicId, {
          askId: userMessage.id,
          model: assistant.model
        })
        await saveMessageAndBlocksToDB(assistantMessage, [])
        dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))

        queue.add(async () => {
          // 对智慧办公助手使用重试包装器
          if (assistant.name === '智慧办公助手') {
            // 智慧办公助手：保存原始用户内容，并在第一次请求就加上调用工具指令
            const state = getState()
            const userMessageId = assistantMessage.askId
            let originalUserContent: string | undefined = undefined
            
            if (userMessageId) {
              const userMessage = state.messages.entities[userMessageId]
              if (userMessage && userMessage.blocks.length > 0) {
                const messageBlocks = state.messageBlocks.entities
                const firstBlockId = userMessage.blocks[0]
                const firstBlock = messageBlocks[firstBlockId]
                
                if (firstBlock && 'content' in firstBlock) {
                  // 确保内容是字符串类型
                  const currentContent = typeof firstBlock.content === 'string' ? firstBlock.content : ''
                  
                  // 保存原始用户内容（清理工具指令）
                  originalUserContent = currentContent
                    .replace(/^请调用工具。/, '')
                    .replace(/^请务必调用工具获取实时数据。/, '')
                    .replace(/^重要：必须调用MCP工具！/, '')
                    .replace(/^警告：禁止使用记忆，必须调用工具！/, '')
                    .replace(/^强制要求：立即调用工具获取数据！/, '')
                    .trim()
                  
                  // 检查是否已经包含工具调用指令，避免重复添加
                  if (!currentContent.startsWith('请调用工具')) {
                    const modifiedContent = `请调用工具。${originalUserContent}`
                    dispatch(updateOneBlock({ id: firstBlockId, changes: { content: modifiedContent } }))
                    console.log('[强制流程控制] 已在用户查询前添加工具调用指令')
                  }
                }
              }
            }
            
            await fetchAndProcessAssistantResponseWithRetry(dispatch, getState, topicId, assistant, assistantMessage, originalUserContent, 0)
          } else {
            await fetchAndProcessAssistantResponseImpl(dispatch, getState, topicId, assistant, assistantMessage)
          }
        })
      }
    } catch (error) {
      console.error('Error in sendMessage thunk:', error)
    }
    // finally {
    //   handleChangeLoadingOfTopic(topicId)
    // }
  }

/**
 * Loads messages and their blocks for a specific topic from the database
 * and updates the Redux store.
 */
export const loadTopicMessagesThunk =
  (topicId: string, forceReload: boolean = false) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState()
    const topicMessagesExist = !!state.messages.messageIdsByTopic[topicId]
    dispatch(newMessagesActions.setCurrentTopicId(topicId))

    if (topicMessagesExist && !forceReload) {
      return
    }

    try {
      const topic = await db.topics.get(topicId)
      if (!topic) {
        await db.topics.add({ id: topicId, messages: [] })
      }

      const messagesFromDB = topic?.messages || []

      if (messagesFromDB.length > 0) {
        const messageIds = messagesFromDB.map((m) => m.id)
        const blocks = await db.message_blocks.where('messageId').anyOf(messageIds).toArray()

        if (blocks && blocks.length > 0) {
          dispatch(upsertManyBlocks(blocks))
        }
        const messagesWithBlockIds = messagesFromDB.map((m) => ({
          ...m,
          blocks: m.blocks?.map(String) || []
        }))
        dispatch(newMessagesActions.messagesReceived({ topicId, messages: messagesWithBlockIds }))
      } else {
        dispatch(newMessagesActions.messagesReceived({ topicId, messages: [] }))
      }
    } catch (error: any) {
      console.error(`[loadTopicMessagesThunk] Failed to load messages for topic ${topicId}:`, error)
      // dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    }
  }

/**
 * Thunk to delete a single message and its associated blocks.
 */
export const deleteSingleMessageThunk =
  (topicId: string, messageId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
    const currentState = getState()
    const messageToDelete = currentState.messages.entities[messageId]
    if (!messageToDelete || messageToDelete.topicId !== topicId) {
      console.error(`[deleteSingleMessage] Message ${messageId} not found in topic ${topicId}.`)
      return
    }

    const blockIdsToDelete = messageToDelete.blocks || []

    try {
      dispatch(newMessagesActions.removeMessage({ topicId, messageId }))
      cleanupMultipleBlocks(dispatch, blockIdsToDelete)
      await db.message_blocks.bulkDelete(blockIdsToDelete)
      const topic = await db.topics.get(topicId)
      if (topic) {
        const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
        await db.topics.update(topicId, { messages: finalMessagesToSave })
      }
    } catch (error) {
      console.error(`[deleteSingleMessage] Failed to delete message ${messageId}:`, error)
    }
  }

/**
 * Thunk to delete a group of messages (user query + assistant responses) based on askId.
 */
export const deleteMessageGroupThunk =
  (topicId: string, askId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
    const currentState = getState()
    const topicMessageIds = currentState.messages.messageIdsByTopic[topicId] || []
    const messagesToDelete: Message[] = []

    topicMessageIds.forEach((id) => {
      const msg = currentState.messages.entities[id]
      if (msg && msg.askId === askId) {
        messagesToDelete.push(msg)
      }
    })

    // const userQuery = currentState.messages.entities[askId]
    // if (userQuery && userQuery.topicId === topicId && !idsToDelete.includes(askId)) {
    //   messagesToDelete.push(userQuery)
    //   idsToDelete.push(askId)
    // }

    if (messagesToDelete.length === 0) {
      console.warn(`[deleteMessageGroup] No messages found with askId ${askId} in topic ${topicId}.`)
      return
    }

    const blockIdsToDelete = messagesToDelete.flatMap((m) => m.blocks || [])

    try {
      dispatch(newMessagesActions.removeMessagesByAskId({ topicId, askId }))
      cleanupMultipleBlocks(dispatch, blockIdsToDelete)
      await db.message_blocks.bulkDelete(blockIdsToDelete)
      const topic = await db.topics.get(topicId)
      if (topic) {
        const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
        await db.topics.update(topicId, { messages: finalMessagesToSave })
      }
    } catch (error) {
      console.error(`[deleteMessageGroup] Failed to delete messages with askId ${askId}:`, error)
    }
  }

/**
 * Thunk to clear all messages and associated blocks for a topic.
 */
export const clearTopicMessagesThunk =
  (topicId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const state = getState()
      const messageIdsToClear = state.messages.messageIdsByTopic[topicId] || []
      const blockIdsToDeleteSet = new Set<string>()

      messageIdsToClear.forEach((messageId) => {
        const message = state.messages.entities[messageId]
        message?.blocks?.forEach((blockId) => blockIdsToDeleteSet.add(blockId))
      })

      const blockIdsToDelete = Array.from(blockIdsToDeleteSet)

      dispatch(newMessagesActions.clearTopicMessages(topicId))
      cleanupMultipleBlocks(dispatch, blockIdsToDelete)

      await db.topics.update(topicId, { messages: [] })
      if (blockIdsToDelete.length > 0) {
        await db.message_blocks.bulkDelete(blockIdsToDelete)
      }
    } catch (error) {
      console.error(`[clearTopicMessagesThunk] Failed to clear messages for topic ${topicId}:`, error)
    }
  }

/**
 * Thunk to resend a user message by regenerating its associated assistant responses.
 * Finds all assistant messages responding to the given user message, resets them,
 * and queues them for regeneration without deleting other messages.
 */
export const resendMessageThunk =
  (topicId: Topic['id'], userMessageToResend: Message, assistant: Assistant) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const state = getState()
      // Use selector to get all messages for the topic
      const allMessagesForTopic = selectMessagesForTopic(state, topicId)

      // Filter to find the assistant messages to reset
      const assistantMessagesToReset = allMessagesForTopic.filter(
        (m) => m.askId === userMessageToResend.id && m.role === 'assistant'
      )

      // Clear cached search results for the user message being resent
      // This ensures that the regenerated responses will not use stale search results
      try {
        window.keyv.remove(`web-search-${userMessageToResend.id}`)
        window.keyv.remove(`knowledge-search-${userMessageToResend.id}`)
      } catch (error) {
        console.warn(`Failed to clear keyv cache for message ${userMessageToResend.id}:`, error)
      }

      const resetDataList: Message[] = []

      if (assistantMessagesToReset.length === 0) {
        // 没有相关的助手消息就创建一个或多个

        if (userMessageToResend?.mentions?.length) {
          console.log('userMessageToResend.mentions', userMessageToResend.mentions)
          for (const mention of userMessageToResend.mentions) {
            const assistantMessage = createAssistantMessage(assistant.id, topicId, {
              askId: userMessageToResend.id,
              model: mention,
              modelId: mention.id
            })
            resetDataList.push(assistantMessage)
          }
        } else {
          const assistantMessage = createAssistantMessage(assistant.id, topicId, {
            askId: userMessageToResend.id,
            model: assistant.model
          })
          resetDataList.push(assistantMessage)
        }

        resetDataList.forEach((message) => {
          dispatch(newMessagesActions.addMessage({ topicId, message }))
        })
      }

      const allBlockIdsToDelete: string[] = []
      const messagesToUpdateInRedux: { topicId: string; messageId: string; updates: Partial<Message> }[] = []

      for (const originalMsg of assistantMessagesToReset) {
        const blockIdsToDelete = [...(originalMsg.blocks || [])]
        const resetMsg = resetAssistantMessage(originalMsg, {
          status: AssistantMessageStatus.PENDING,
          updatedAt: new Date().toISOString(),
          ...(assistantMessagesToReset.length === 1 ? { model: assistant.model } : {})
        })

        resetDataList.push(resetMsg)
        allBlockIdsToDelete.push(...blockIdsToDelete)
        messagesToUpdateInRedux.push({ topicId, messageId: resetMsg.id, updates: resetMsg })
      }

      messagesToUpdateInRedux.forEach((update) => dispatch(newMessagesActions.updateMessage(update)))
      cleanupMultipleBlocks(dispatch, allBlockIdsToDelete)

      try {
        if (allBlockIdsToDelete.length > 0) {
          await db.message_blocks.bulkDelete(allBlockIdsToDelete)
        }
        const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)
        await db.topics.update(topicId, { messages: finalMessagesToSave })
      } catch (dbError) {
        console.error('[resendMessageThunk] Error updating database:', dbError)
      }

      const queue = getTopicQueue(topicId)
      for (const resetMsg of resetDataList) {
        const assistantConfigForThisRegen = {
          ...assistant,
          ...(resetMsg.model ? { model: resetMsg.model } : {})
        }
        queue.add(async () => {
          await fetchAndProcessAssistantResponseImpl(dispatch, getState, topicId, assistantConfigForThisRegen, resetMsg)
        })
      }
    } catch (error) {
      console.error(`[resendMessageThunk] Error resending user message ${userMessageToResend.id}:`, error)
    }
    // finally {
    //   handleChangeLoadingOfTopic(topicId)
    // }
  }

/**
 * Thunk to resend a user message after its content has been edited.
 * Updates the user message's text block and then triggers the regeneration
 * of its associated assistant responses using resendMessageThunk.
 */
export const resendUserMessageWithEditThunk =
  (topicId: Topic['id'], originalMessage: Message, assistant: Assistant) => async (dispatch: AppDispatch) => {
    // Trigger the regeneration logic for associated assistant messages
    dispatch(resendMessageThunk(topicId, originalMessage, assistant))
  }

/**
 * Thunk to regenerate a specific assistant response.
 */
export const regenerateAssistantResponseThunk =
  (topicId: Topic['id'], assistantMessageToRegenerate: Message, assistant: Assistant) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const state = getState()

      // 1. Use selector to get all messages for the topic
      const allMessagesForTopic = selectMessagesForTopic(state, topicId)

      // 2. Find the original user query (Restored Logic)
      const originalUserQuery = allMessagesForTopic.find((m) => m.id === assistantMessageToRegenerate.askId)
      if (!originalUserQuery) {
        console.error(
          `[regenerateAssistantResponseThunk] Original user query (askId: ${assistantMessageToRegenerate.askId}) not found for assistant message ${assistantMessageToRegenerate.id}. Cannot regenerate.`
        )
        return
      }

      // 3. Verify the assistant message itself exists in entities
      const messageToResetEntity = state.messages.entities[assistantMessageToRegenerate.id]
      if (!messageToResetEntity) {
        // No need to check topicId again as selector implicitly handles it
        console.error(
          `[regenerateAssistantResponseThunk] Assistant message ${assistantMessageToRegenerate.id} not found in entities despite being in the topic list. State might be inconsistent.`
        )
        return
      }

      // 4. Get Block IDs to delete
      const blockIdsToDelete = [...(messageToResetEntity.blocks || [])]

      // 5. Reset the message entity in Redux
      const resetAssistantMsg = resetAssistantMessage(
        messageToResetEntity,
        // Grouped message (mentioned model message) should not reset model and modelId, always use the original model
        assistantMessageToRegenerate.modelId
          ? {
              status: AssistantMessageStatus.PENDING,
              updatedAt: new Date().toISOString()
            }
          : {
              status: AssistantMessageStatus.PENDING,
              updatedAt: new Date().toISOString(),
              model: assistant.model
            }
      )

      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId: resetAssistantMsg.id,
          updates: resetAssistantMsg
        })
      )

      // 6. Remove old blocks from Redux
      cleanupMultipleBlocks(dispatch, blockIdsToDelete)

      // 7. Update DB: Save the reset message state within the topic and delete old blocks
      // Fetch the current state *after* Redux updates to get the latest message list
      // Use the selector to get the final ordered list of messages for the topic
      const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)

      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        // Use the result from the selector to update the DB
        await db.topics.update(topicId, { messages: finalMessagesToSave })
        if (blockIdsToDelete.length > 0) {
          await db.message_blocks.bulkDelete(blockIdsToDelete)
        }
      })

      // 8. Add fetch/process call to the queue
      const queue = getTopicQueue(topicId)
      const assistantConfigForRegen = {
        ...assistant,
        ...(resetAssistantMsg.model ? { model: resetAssistantMsg.model } : {})
      }
      queue.add(async () => {
        await fetchAndProcessAssistantResponseImpl(
          dispatch,
          getState,
          topicId,
          assistantConfigForRegen,
          resetAssistantMsg
        )
      })
    } catch (error) {
      console.error(
        `[regenerateAssistantResponseThunk] Error regenerating response for assistant message ${assistantMessageToRegenerate.id}:`,
        error
      )
      // dispatch(newMessagesActions.setTopicLoading({ topicId, loading: false }))
    }
    //  finally {
    //   handleChangeLoadingOfTopic(topicId)
    // }
  }

// --- Thunk to initiate translation and create the initial block ---
export const initiateTranslationThunk =
  (
    messageId: string,
    topicId: string,
    targetLanguage: string,
    sourceBlockId?: string, // Optional: If known
    sourceLanguage?: string // Optional: If known
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState): Promise<string | undefined> => {
    // Return the new block ID
    try {
      const state = getState()
      const originalMessage = state.messages.entities[messageId]

      if (!originalMessage) {
        console.error(`[initiateTranslationThunk] Original message ${messageId} not found.`)
        return undefined
      }

      // 1. Create the initial translation block (streaming state)
      const newBlock = createTranslationBlock(
        messageId,
        '', // Start with empty content
        targetLanguage,
        {
          status: MessageBlockStatus.STREAMING, // Set to STREAMING
          sourceBlockId,
          sourceLanguage
        }
      )

      // 2. Update Redux State
      const updatedBlockIds = [...(originalMessage.blocks || []), newBlock.id]
      dispatch(upsertOneBlock(newBlock)) // Add the new block
      dispatch(
        newMessagesActions.updateMessage({
          topicId,
          messageId,
          updates: { blocks: updatedBlockIds } // Update message's block list
        })
      )

      // 3. Update Database
      // Get the final message list from Redux state *after* updates
      const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)

      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        await db.message_blocks.put(newBlock) // Save the initial block
        await db.topics.update(topicId, { messages: finalMessagesToSave }) // Save updated message list
      })
      return newBlock.id // Return the ID
    } catch (error) {
      console.error(`[initiateTranslationThunk] Failed for message ${messageId}:`, error)
      return undefined
      // Optional: Dispatch an error action or show notification
    }
  }

// --- Thunk to update the translation block with new content ---
export const updateTranslationBlockThunk =
  (blockId: string, accumulatedText: string, isComplete: boolean = false) =>
  async (dispatch: AppDispatch) => {
    // Logger.log(`[updateTranslationBlockThunk] 更新翻译块 ${blockId}, isComplete: ${isComplete}`)
    try {
      const status = isComplete ? MessageBlockStatus.SUCCESS : MessageBlockStatus.STREAMING
      const changes: Partial<MessageBlock> = {
        content: accumulatedText,
        status: status
      }

      // 更新Redux状态
      dispatch(updateOneBlock({ id: blockId, changes }))

      // 更新数据库
      await db.message_blocks.update(blockId, changes)
      // Logger.log(`[updateTranslationBlockThunk] Successfully updated translation block ${blockId}.`)
    } catch (error) {
      console.error(`[updateTranslationBlockThunk] Failed to update translation block ${blockId}:`, error)
    }
  }

/**
 * Thunk to append a new assistant response (using a potentially different model)
 * in reply to the same user query as an existing assistant message.
 */
export const appendAssistantResponseThunk =
  (
    topicId: Topic['id'],
    existingAssistantMessageId: string, // ID of the assistant message the user interacted with
    newModel: Model, // The new model selected by the user
    assistant: Assistant // Base assistant configuration
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      const state = getState()

      // 1. Find the existing assistant message to get the original askId
      const existingAssistantMsg = state.messages.entities[existingAssistantMessageId]
      if (!existingAssistantMsg) {
        console.error(
          `[appendAssistantResponseThunk] Existing assistant message ${existingAssistantMessageId} not found.`
        )
        return // Stop if the reference message doesn't exist
      }
      if (existingAssistantMsg.role !== 'assistant') {
        console.error(
          `[appendAssistantResponseThunk] Message ${existingAssistantMessageId} is not an assistant message.`
        )
        return // Ensure it's an assistant message
      }
      const askId = existingAssistantMsg.askId
      if (!askId) {
        console.error(
          `[appendAssistantResponseThunk] Existing assistant message ${existingAssistantMessageId} does not have an askId.`
        )
        return // Stop if askId is missing
      }

      // (Optional but recommended) Verify the original user query exists
      if (!state.messages.entities[askId]) {
        console.warn(
          `[appendAssistantResponseThunk] Original user query (askId: ${askId}) not found in entities. Proceeding, but state might be inconsistent.`
        )
        // Decide whether to proceed or return based on requirements
      }

      // 2. Create the new assistant message stub
      const newAssistantStub = createAssistantMessage(assistant.id, topicId, {
        askId: askId, // Crucial: Use the original askId
        model: newModel,
        modelId: newModel.id
      })

      // 3. Update Redux Store
      const currentTopicMessageIds = getState().messages.messageIdsByTopic[topicId] || []
      const existingMessageIndex = currentTopicMessageIds.findIndex((id) => id === existingAssistantMessageId)
      const insertAtIndex = existingMessageIndex !== -1 ? existingMessageIndex + 1 : currentTopicMessageIds.length

      dispatch(newMessagesActions.insertMessageAtIndex({ topicId, message: newAssistantStub, index: insertAtIndex }))

      // 4. Update Database (Save the stub to the topic's message list)
      await saveMessageAndBlocksToDB(newAssistantStub, [], insertAtIndex)

      // 5. Prepare and queue the processing task
      const assistantConfigForThisCall = {
        ...assistant,
        model: newModel
      }
      const queue = getTopicQueue(topicId)
      queue.add(async () => {
        await fetchAndProcessAssistantResponseImpl(
          dispatch,
          getState,
          topicId,
          assistantConfigForThisCall,
          newAssistantStub // Pass the newly created stub
        )
      })
    } catch (error) {
      console.error(`[appendAssistantResponseThunk] Error appending assistant response:`, error)
      // Optionally dispatch an error action or notification
      // Resetting loading state should be handled by the underlying fetchAndProcessAssistantResponseImpl
    }
    // finally {
    //   handleChangeLoadingOfTopic(topicId)
    // }
  }

/**
 * Clones messages from a source topic up to a specified index into a *pre-existing* new topic.
 * Generates new unique IDs for all cloned messages and blocks.
 * Updates the DB and Redux message/block state for the new topic.
 * Assumes the newTopic object already exists in Redux topic state and DB.
 * @param sourceTopicId The ID of the topic to branch from.
 * @param branchPointIndex The index *after* which messages should NOT be copied (slice endpoint).
 * @param newTopic The newly created Topic object (created and added to Redux/DB by the caller).
 */
export const cloneMessagesToNewTopicThunk =
  (
    sourceTopicId: string,
    branchPointIndex: number,
    newTopic: Topic // Receive newTopic object
  ) =>
  async (dispatch: AppDispatch, getState: () => RootState): Promise<boolean> => {
    if (!newTopic || !newTopic.id) {
      console.error(`[cloneMessagesToNewTopicThunk] Invalid newTopic provided.`)
      return false
    }
    try {
      const state = getState()
      const sourceMessages = selectMessagesForTopic(state, sourceTopicId)

      if (!sourceMessages || sourceMessages.length === 0) {
        console.error(`[cloneMessagesToNewTopicThunk] Source topic ${sourceTopicId} not found or is empty.`)
        return false
      }

      // 1. Slice messages to clone
      const messagesToClone = sourceMessages.slice(0, branchPointIndex)
      if (messagesToClone.length === 0) {
        console.warn(`[cloneMessagesToNewTopicThunk] No messages to branch (index ${branchPointIndex}).`)
        return true // Nothing to clone, operation considered successful but did nothing.
      }

      // 2. Prepare for cloning: Maps and Arrays
      const clonedMessages: Message[] = []
      const clonedBlocks: MessageBlock[] = []
      const filesToUpdateCount: FileType[] = []
      const originalToNewMsgIdMap = new Map<string, string>() // Map original message ID -> new message ID

      // 3. Clone Messages and Blocks with New IDs
      for (const oldMessage of messagesToClone) {
        const newMsgId = uuid()
        originalToNewMsgIdMap.set(oldMessage.id, newMsgId) // Store mapping for all cloned messages

        let newAskId: string | undefined = undefined // Initialize newAskId
        if (oldMessage.role === 'assistant' && oldMessage.askId) {
          // If it's an assistant message with an askId, find the NEW ID of the user message it references
          const mappedNewAskId = originalToNewMsgIdMap.get(oldMessage.askId)
          if (mappedNewAskId) {
            newAskId = mappedNewAskId // Use the new ID
          } else {
            // This happens if the user message corresponding to askId was *before* the branch point index
            // and thus wasn't included in messagesToClone or the map.
            // In this case, the link is broken in the new topic.
            console.warn(
              `[cloneMessages] Could not find new ID mapping for original askId ${oldMessage.askId} (likely outside branch). Setting askId to undefined for new assistant message ${newMsgId}.`
            )
            // newAskId remains undefined
          }
        }

        // --- Clone Blocks ---
        const newBlockIds: string[] = []
        if (oldMessage.blocks && oldMessage.blocks.length > 0) {
          for (const oldBlockId of oldMessage.blocks) {
            const oldBlock = state.messageBlocks.entities[oldBlockId]
            if (oldBlock) {
              const newBlockId = uuid()
              const newBlock: MessageBlock = {
                ...oldBlock,
                id: newBlockId,
                messageId: newMsgId // Link block to the NEW message ID
              }
              clonedBlocks.push(newBlock)
              newBlockIds.push(newBlockId)

              if (newBlock.type === MessageBlockType.FILE || newBlock.type === MessageBlockType.IMAGE) {
                const fileInfo = (newBlock as FileMessageBlock | ImageMessageBlock).file
                if (fileInfo) {
                  filesToUpdateCount.push(fileInfo)
                }
              }
            } else {
              console.warn(
                `[cloneMessagesToNewTopicThunk] Block ${oldBlockId} not found in state for message ${oldMessage.id}. Skipping block clone.`
              )
            }
          }
        }

        // --- Create New Message Object ---
        const newMessage: Message = {
          ...oldMessage,
          id: newMsgId,
          topicId: newTopic.id, // Use the NEW topic ID provided
          blocks: newBlockIds // Use the NEW block IDs
        }
        if (newMessage.role === 'assistant') {
          newMessage.askId = newAskId // Use the mapped/updated askId
        }
        clonedMessages.push(newMessage)
      }

      // 4. Update Database (Atomic Transaction)
      await db.transaction('rw', db.topics, db.message_blocks, db.files, async () => {
        // Update the NEW topic with the cloned messages
        // Assumes topic entry was added by caller, so we UPDATE.
        await db.topics.put({ id: newTopic.id, messages: clonedMessages })

        // Add the NEW blocks
        if (clonedBlocks.length > 0) {
          await db.message_blocks.bulkAdd(clonedBlocks)
        }
        // Update file counts
        const uniqueFiles = [...new Map(filesToUpdateCount.map((f) => [f.id, f])).values()]
        for (const file of uniqueFiles) {
          await db.files
            .where('id')
            .equals(file.id)
            .modify((f) => {
              if (f) {
                // Ensure file exists before modifying
                f.count = (f.count || 0) + 1
              }
            })
        }
      })

      // --- Update Redux State ---
      dispatch(newMessagesActions.messagesReceived({ topicId: newTopic.id, messages: clonedMessages }))
      if (clonedBlocks.length > 0) {
        dispatch(upsertManyBlocks(clonedBlocks))
      }

      return true // Indicate success
    } catch (error) {
      console.error(`[cloneMessagesToNewTopicThunk] Failed to clone messages:`, error)
      return false // Indicate failure
    }
  }

/**
 * Thunk to edit properties of a message and/or its associated blocks.
 * Updates Redux state and persists changes to the database within a transaction.
 * Message updates are optional if only blocks need updating.
 */
export const updateMessageAndBlocksThunk =
  (
    topicId: string,
    // Allow messageUpdates to be optional or just contain the ID if only blocks are updated
    messageUpdates: (Partial<Message> & Pick<Message, 'id'>) | null, // ID is always required for context
    blockUpdatesList: MessageBlock[] // Block updates remain required for this thunk's purpose
  ) =>
  async (dispatch: AppDispatch): Promise<void> => {
    const messageId = messageUpdates?.id

    if (messageUpdates && !messageId) {
      console.error('[updateMessageAndUpdateBlocksThunk] Message ID is required.')
      return
    }

    try {
      // 1. 更新 Redux Store
      if (messageUpdates && messageId) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: msgId, ...actualMessageChanges } = messageUpdates // Separate ID from actual changes

        // Only dispatch message update if there are actual changes beyond the ID
        if (Object.keys(actualMessageChanges).length > 0) {
          dispatch(newMessagesActions.updateMessage({ topicId, messageId, updates: actualMessageChanges }))
        }
      }

      if (blockUpdatesList.length > 0) {
        dispatch(upsertManyBlocks(blockUpdatesList))
      }

      // 2. 更新数据库 (在事务中)
      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        // Only update topic.messages if there were actual message changes
        if (messageUpdates && Object.keys(messageUpdates).length > 0) {
          const topic = await db.topics.get(topicId)
          if (topic && topic.messages) {
            const messageIndex = topic.messages.findIndex((m) => m.id === messageId)
            if (messageIndex !== -1) {
              Object.assign(topic.messages[messageIndex], messageUpdates)
              await db.topics.update(topicId, { messages: topic.messages })
            } else {
              console.error(
                `[updateMessageAndBlocksThunk] Message ${messageId} not found in DB topic ${topicId} for property update.`
              )
              throw new Error(`Message ${messageId} not found in DB topic ${topicId} for property update.`)
            }
          } else {
            console.error(
              `[updateMessageAndBlocksThunk] Topic ${topicId} not found or empty for message property update.`
            )
            throw new Error(`Topic ${topicId} not found or empty for message property update.`)
          }
        }

        if (blockUpdatesList.length > 0) {
          await db.message_blocks.bulkPut(blockUpdatesList)
        }
      })
    } catch (error) {
      console.error(`[updateMessageAndBlocksThunk] Failed to process updates for message ${messageId}:`, error)
    }
  }

export const removeBlocksThunk =
  (topicId: string, messageId: string, blockIdsToRemove: string[]) =>
  async (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    if (!blockIdsToRemove.length) {
      console.warn('[removeBlocksFromMessageThunk] No block IDs provided to remove.')
      return
    }

    try {
      const state = getState()
      const message = state.messages.entities[messageId]

      if (!message) {
        console.error(`[removeBlocksFromMessageThunk] Message ${messageId} not found in state.`)
        return
      }
      const blockIdsToRemoveSet = new Set(blockIdsToRemove)

      const updatedBlockIds = (message.blocks || []).filter((id) => !blockIdsToRemoveSet.has(id))

      // 1. Update Redux state
      dispatch(newMessagesActions.updateMessage({ topicId, messageId, updates: { blocks: updatedBlockIds } }))

      cleanupMultipleBlocks(dispatch, blockIdsToRemove)

      const finalMessagesToSave = selectMessagesForTopic(getState(), topicId)

      // 2. Update database (in a transaction)
      await db.transaction('rw', db.topics, db.message_blocks, async () => {
        // Update the message in the topic
        await db.topics.update(topicId, { messages: finalMessagesToSave })
        // Delete the blocks from the database
        if (blockIdsToRemove.length > 0) {
          await db.message_blocks.bulkDelete(blockIdsToRemove)
        }
      })

      return
    } catch (error) {
      console.error(`[removeBlocksFromMessageThunk] Failed to remove blocks from message ${messageId}:`, error)
      throw error
    }
  }
