import CustomTag from '@renderer/components/CustomTag'
import TranslateButton from '@renderer/components/TranslateButton'
import { isGenerateImageModel, isVisionModel } from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import FileManager from '@renderer/services/FileManager'
import PasteService from '@renderer/services/PasteService'
import { FileType, FileTypes } from '@renderer/types'
import { Message, MessageBlock, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { classNames, getFileExtension } from '@renderer/utils'
import { getFilesFromDropEvent, isSendMessageKeyPressed } from '@renderer/utils/input'
import { createFileBlock, createImageBlock } from '@renderer/utils/messageUtils/create'
import { findAllBlocks } from '@renderer/utils/messageUtils/find'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { Tooltip } from 'antd'
import TextArea, { TextAreaRef } from 'antd/es/input/TextArea'
import { Save, Send, X } from 'lucide-react'
import { FC, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AttachmentButton, { AttachmentButtonRef } from '../Inputbar/AttachmentButton'
import { FileNameRender, getFileIcon } from '../Inputbar/AttachmentPreview'
import { ToolbarButton } from '../Inputbar/Inputbar'

interface Props {
  message: Message
  onSave: (blocks: MessageBlock[]) => void
  onResend: (blocks: MessageBlock[]) => void
  onCancel: () => void
}

const MessageBlockEditor: FC<Props> = ({ message, onSave, onResend, onCancel }) => {
  const allBlocks = findAllBlocks(message)
  const [editedBlocks, setEditedBlocks] = useState<MessageBlock[]>(allBlocks)
  const [files, setFiles] = useState<FileType[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isFileDragging, setIsFileDragging] = useState(false)
  const { assistant } = useAssistant(message.assistantId)
  const model = assistant.model || assistant.defaultModel
  const isVision = useMemo(() => isVisionModel(model), [model])
  const supportExts = useMemo(() => [...textExts, ...documentExts, ...(isVision ? imageExts : [])], [isVision])
  const { pasteLongTextAsFile, pasteLongTextThreshold, fontSize, sendMessageShortcut, enableSpellCheck } = useSettings()
  const { t } = useTranslation()
  const textareaRef = useRef<TextAreaRef>(null)
  const attachmentButtonRef = useRef<AttachmentButtonRef>(null)

  const resizeTextArea = useCallback(() => {
    const textArea = textareaRef.current?.resizableTextArea?.textArea
    if (textArea) {
      textArea.style.height = 'auto'
      textArea.style.height = textArea?.scrollHeight > 400 ? '400px' : `${textArea?.scrollHeight}px`
    }
  }, [])

  useEffect(() => {
    setTimeout(() => {
      resizeTextArea()
      if (textareaRef.current) {
        textareaRef.current.focus({ cursor: 'end' })
      }
    }, 0)
  }, [resizeTextArea])

  const onPaste = useCallback(
    async (event: ClipboardEvent) => {
      return await PasteService.handlePaste(
        event,
        isVisionModel(model),
        isGenerateImageModel(model),
        supportExts,
        setFiles,
        undefined, // 不需要setText
        pasteLongTextAsFile,
        pasteLongTextThreshold,
        undefined, // 不需要text
        resizeTextArea,
        t
      )
    },
    [model, pasteLongTextAsFile, pasteLongTextThreshold, resizeTextArea, supportExts, t]
  )

  // 添加全局粘贴事件处理
  useEffect(() => {
    PasteService.registerHandler('messageEditor', onPaste)
    PasteService.setLastFocusedComponent('messageEditor')

    return () => {
      PasteService.unregisterHandler('messageEditor')
    }
  }, [onPaste])

  const handleTextChange = (blockId: string, content: string) => {
    setEditedBlocks((prev) => prev.map((block) => (block.id === blockId ? { ...block, content } : block)))
  }

  const onTranslated = (translatedText: string) => {
    const mainTextBlock = editedBlocks.find((b) => b.type === MessageBlockType.MAIN_TEXT)
    if (mainTextBlock) {
      handleTextChange(mainTextBlock.id, translatedText)
    }
    setTimeout(() => resizeTextArea(), 0)
  }

  // 处理文件删除
  const handleFileRemove = async (blockId: string) => {
    setEditedBlocks((prev) => prev.filter((block) => block.id !== blockId))
  }

  // 处理拖拽上传
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsFileDragging(false)

    const files = await getFilesFromDropEvent(e).catch((err) => {
      console.error('[src/renderer/src/pages/home/Inputbar/Inputbar.tsx] handleDrop:', err)
      return null
    })
    if (files) {
      let supportedFiles = 0
      files.forEach((file) => {
        if (supportExts.includes(getFileExtension(file.path))) {
          setFiles((prevFiles) => [...prevFiles, file])
          supportedFiles++
        }
      })

      // 如果有文件，但都不支持
      if (files.length > 0 && supportedFiles === 0) {
        window.message.info({
          key: 'file_not_supported',
          content: t('chat.input.file_not_supported')
        })
      }
    }
  }

  // 处理编辑区块并上传文件
  const processEditedBlocks = async () => {
    const updatedBlocks = [...editedBlocks]
    if (files && files.length) {
      const uploadedFiles = await FileManager.uploadFiles(files)
      uploadedFiles.forEach((file) => {
        if (file.type === FileTypes.IMAGE) {
          const imgBlock = createImageBlock(message.id, { file, status: MessageBlockStatus.SUCCESS })
          updatedBlocks.push(imgBlock)
        } else {
          const fileBlock = createFileBlock(message.id, file, { status: MessageBlockStatus.SUCCESS })
          updatedBlocks.push(fileBlock)
        }
      })
    }
    return updatedBlocks
  }

  const handleSave = async () => {
    if (isProcessing) return
    setIsProcessing(true)
    const updatedBlocks = await processEditedBlocks()
    onSave(updatedBlocks)
  }

  const handleResend = async () => {
    if (isProcessing) return
    setIsProcessing(true)
    const updatedBlocks = await processEditedBlocks()
    onResend(updatedBlocks)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>, blockId: string) => {
    if (message.role !== 'user') {
      return
    }

    // keep the same enter behavior as inputbar
    const isEnterPressed = event.key === 'Enter' && !event.nativeEvent.isComposing
    if (isEnterPressed) {
      if (isSendMessageKeyPressed(event, sendMessageShortcut)) {
        handleResend()
        return event.preventDefault()
      } else {
        if (!event.shiftKey) {
          event.preventDefault()

          const textArea = textareaRef.current?.resizableTextArea?.textArea
          if (textArea) {
            const start = textArea.selectionStart
            const end = textArea.selectionEnd
            const text = textArea.value
            const newText = text.substring(0, start) + '\n' + text.substring(end)

            //same with onChange()
            handleTextChange(blockId, newText)

            // set cursor position in the next render cycle
            setTimeout(() => {
              textArea.selectionStart = textArea.selectionEnd = start + 1
              resizeTextArea() // trigger resizeTextArea
            }, 0)
          }
        }
      }
    }
  }

  return (
    <EditorContainer className="message-editor" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      {editedBlocks
        .filter((block) => block.type === MessageBlockType.MAIN_TEXT)
        .map((block) => (
          <Textarea
            className={classNames('editing-message', isFileDragging && 'file-dragging')}
            key={block.id}
            ref={textareaRef}
            variant="borderless"
            value={message.role === 'user' 
              ? block.content
                  .replace(/^请调用工具。/, '')
                  .replace(/^请务必调用工具获取实时数据。/, '')
                  .replace(/^重要：必须调用MCP工具！/, '')
                  .replace(/^警告：禁止使用记忆，必须调用工具！/, '')
                  .replace(/^强制要求：立即调用工具获取数据！/, '')
                  .trim()
              : block.content
            }
            onChange={(e) => {
              // 在保存时，如果是用户消息且内容不以工具指令开头，需要检查是否需要添加回去
              const newValue = e.target.value
              let valueToSave = newValue
              
              if (message.role === 'user') {
                // 查找原始内容中的工具指令前缀
                let originalContent = ''
                for (const b of allBlocks) {
                  if (b.id === block.id && 'content' in b) {
                    originalContent = b.content || ''
                    break
                  }
                }
                const toolPrefixes = [
                  '请调用工具。',
                  '请务必调用工具获取实时数据。',
                  '重要：必须调用MCP工具！',
                  '警告：禁止使用记忆，必须调用工具！',
                  '强制要求：立即调用工具获取数据！'
                ]
                
                const hasToolPrefix = toolPrefixes.some(prefix => originalContent.startsWith(prefix))
                const userAddedPrefix = toolPrefixes.some(prefix => newValue.startsWith(prefix))
                
                // 如果原来有工具指令但用户输入没有，则添加回去
                if (hasToolPrefix && !userAddedPrefix) {
                  let originalPrefix = ''
                  for (const prefix of toolPrefixes) {
                    if (originalContent.startsWith(prefix)) {
                      originalPrefix = prefix
                      break
                    }
                  }
                  valueToSave = originalPrefix + newValue
                }
              }
              
              handleTextChange(block.id, valueToSave)
              resizeTextArea()
            }}
            onKeyDown={(e) => handleKeyDown(e, block.id)}
            autoFocus
            spellCheck={enableSpellCheck}
            onPaste={(e) => onPaste(e.nativeEvent)}
            onFocus={() => {
              // 记录当前聚焦的组件
              PasteService.setLastFocusedComponent('messageEditor')
            }}
            onContextMenu={(e) => {
              // 阻止事件冒泡，避免触发全局的 Electron contextMenu
              e.stopPropagation()
            }}
            style={{
              fontSize,
              padding: '0px 15px 8px 15px'
            }}>
            <TranslateButton onTranslated={onTranslated} />
          </Textarea>
        ))}
      {(editedBlocks.some((block) => block.type === MessageBlockType.FILE || block.type === MessageBlockType.IMAGE) ||
        files.length > 0) && (
        <FileBlocksContainer>
          {editedBlocks
            .filter((block) => block.type === MessageBlockType.FILE || block.type === MessageBlockType.IMAGE)
            .map(
              (block) =>
                block.file && (
                  <CustomTag
                    key={block.id}
                    icon={getFileIcon(block.file.ext)}
                    color="#37a5aa"
                    closable
                    onClose={() => handleFileRemove(block.id)}>
                    <FileNameRender file={block.file} />
                  </CustomTag>
                )
            )}

          {files.map((file) => (
            <CustomTag
              key={file.id}
              icon={getFileIcon(file.ext)}
              color="#37a5aa"
              closable
              onClose={() => setFiles((prevFiles) => prevFiles.filter((f) => f.id !== file.id))}>
              <FileNameRender file={file} />
            </CustomTag>
          ))}
        </FileBlocksContainer>
      )}

      <ActionBar>
        <ActionBarLeft>
          <AttachmentButton
            ref={attachmentButtonRef}
            model={model}
            files={files}
            setFiles={setFiles}
            ToolbarButton={ToolbarButton}
          />
        </ActionBarLeft>
        <ActionBarMiddle />
        <ActionBarRight>
          <Tooltip title={t('common.cancel')}>
            <ToolbarButton type="text" onClick={onCancel}>
              <X size={16} />
            </ToolbarButton>
          </Tooltip>
          <Tooltip title={t('common.save')}>
            <ToolbarButton type="text" onClick={handleSave}>
              <Save size={16} />
            </ToolbarButton>
          </Tooltip>
          {message.role === 'user' && (
            <Tooltip title={t('chat.resend')}>
              <ToolbarButton type="text" onClick={handleResend}>
                <Send size={16} />
              </ToolbarButton>
            </Tooltip>
          )}
        </ActionBarRight>
      </ActionBar>
    </EditorContainer>
  )
}

const EditorContainer = styled.div`
  padding: 8px 0;
  border: 0.5px solid var(--color-border);
  transition: all 0.2s ease;
  border-radius: 15px;
  margin-top: 5px;
  margin-bottom: 10px;
  background-color: var(--color-background-opacity);
  width: 100%;

  &.file-dragging {
    border: 2px dashed #2ecc71;

    &::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(46, 204, 113, 0.03);
      border-radius: 14px;
      z-index: 5;
      pointer-events: none;
    }
  }
`

const FileBlocksContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 15px;
  margin: 8px 0;
  background: transparent;
  border-radius: 4px;
`

const Textarea = styled(TextArea)`
  padding: 0;
  border-radius: 0;
  display: flex;
  flex: 1;
  font-family: Ubuntu;
  resize: none !important;
  overflow: auto;
  width: 100%;
  box-sizing: border-box;
  &.ant-input {
    line-height: 1.4;
  }
`

const ActionBar = styled.div`
  display: flex;
  padding: 0 8px;
  justify-content: space-between;
  margin-top: 8px;
`

const ActionBarLeft = styled.div`
  display: flex;
  align-items: center;
`

const ActionBarMiddle = styled.div`
  flex: 1;
`

const ActionBarRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

export default memo(MessageBlockEditor)
