import 'emoji-picker-element'

import { CloseCircleFilled, QuestionCircleOutlined } from '@ant-design/icons'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { Box, HSpaceBetweenStack, HStack } from '@renderer/components/Layout'
import { estimateTextTokens } from '@renderer/services/TokenService'
import { Assistant, AssistantSettings } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import { Button, Input, Popover } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import styled from 'styled-components'

import { SettingDivider } from '..'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings?: (settings: AssistantSettings) => void
  onOk?: () => void
}

const AssistantPromptSettings: React.FC<Props> = ({ assistant, updateAssistant }) => {
  const [emoji, setEmoji] = useState(getLeadingEmoji(assistant.name) || assistant.emoji)
  const [name, setName] = useState(assistant.name.replace(getLeadingEmoji(assistant.name) || '', '').trim())
  const [prompt, setPrompt] = useState(assistant.prompt)
  const [tokenCount, setTokenCount] = useState(0)
  const { t } = useTranslation()
  const [showMarkdown, setShowMarkdown] = useState(prompt.length > 0)

  useEffect(() => {
    const updateTokenCount = async () => {
      const count = await estimateTextTokens(prompt)
      setTokenCount(count)
    }
    updateTokenCount()
  }, [prompt])

  const onUpdate = () => {
    // 如果是默认助手（智慧办公助手），不允许修改名称
    const _assistant = assistant.id === 'default' 
      ? { ...assistant, emoji, prompt }
      : { ...assistant, name: name.trim(), emoji, prompt }
    updateAssistant(_assistant)
  }

  const handleEmojiSelect = (selectedEmoji: string) => {
    setEmoji(selectedEmoji)
    // 如果是默认助手（智慧办公助手），不允许修改名称
    const _assistant = assistant.id === 'default'
      ? { ...assistant, emoji: selectedEmoji, prompt }
      : { ...assistant, name: name.trim(), emoji: selectedEmoji, prompt }
    updateAssistant(_assistant)
  }

  const handleEmojiDelete = () => {
    setEmoji('')
    // 如果是默认助手（智慧办公助手），不允许修改名称
    const _assistant = assistant.id === 'default'
      ? { ...assistant, prompt, emoji: '' }
      : { ...assistant, name: name.trim(), prompt, emoji: '' }
    updateAssistant(_assistant)
  }

  const promptVarsContent = <pre>{t('agents.add.prompt.variables.tip.content')}</pre>

  return (
    <Container>
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('common.name')}
      </Box>
      <HStack gap={8} alignItems="center">
        <Popover content={<EmojiPicker onEmojiClick={handleEmojiSelect} />} arrow trigger="click">
          <EmojiButtonWrapper>
            <Button style={{ fontSize: 18, padding: '4px', minWidth: '28px', height: '28px' }}>{emoji}</Button>
            {emoji && (
              <CloseCircleFilled
                className="delete-icon"
                onClick={(e) => {
                  e.stopPropagation()
                  handleEmojiDelete()
                }}
                style={{
                  display: 'none',
                  position: 'absolute',
                  top: '-8px',
                  right: '-8px',
                  fontSize: '16px',
                  color: '#ff4d4f',
                  cursor: 'pointer'
                }}
              />
            )}
          </EmojiButtonWrapper>
        </Popover>
        <Input
          placeholder={t('common.assistant') + t('common.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={onUpdate}
          disabled={assistant.id === 'default'}
          style={{ flex: 1 }}
        />
      </HStack>
      <SettingDivider />
      <HStack mb={8} alignItems="center" gap={4}>
        <Box style={{ fontWeight: 'bold' }}>{t('common.prompt')}</Box>
        <Popover title={t('agents.add.prompt.variables.tip.title')} content={promptVarsContent}>
          <QuestionCircleOutlined size={14} color="var(--color-text-2)" />
        </Popover>
      </HStack>
      <TextAreaContainer>
        {showMarkdown ? (
          <MarkdownContainer className="markdown" onClick={() => setShowMarkdown(false)}>
            <ReactMarkdown>{prompt}</ReactMarkdown>
            <div style={{ height: '30px' }} />
          </MarkdownContainer>
        ) : (
          <TextArea
            rows={10}
            placeholder={t('common.assistant') + t('common.prompt')}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() => {
              onUpdate()
            }}
            autoFocus={true}
            spellCheck={false}
            style={{ minHeight: 'calc(80vh - 200px)', maxHeight: 'calc(80vh - 200px)', paddingBottom: '30px' }}
          />
        )}
      </TextAreaContainer>
      <HSpaceBetweenStack width="100%" justifyContent="flex-end" mt="10px">
        <TokenCount>Tokens: {tokenCount}</TokenCount>

        {showMarkdown ? (
          <Button type="primary" onClick={() => setShowMarkdown(false)}>
            {t('common.edit')}
          </Button>
        ) : (
          <Button type="primary" onClick={() => setShowMarkdown(true)}>
            {t('common.save')}
          </Button>
        )}
      </HSpaceBetweenStack>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
`

const EmojiButtonWrapper = styled.div`
  position: relative;
  display: inline-block;

  &:hover .delete-icon {
    display: block !important;
  }
`

const TextAreaContainer = styled.div`
  position: relative;
  width: 100%;
`

const TokenCount = styled.div`
  padding: 2px 2px;
  border-radius: 4px;
  font-size: 14px;
  color: var(--color-text-2);
  user-select: none;
`

const MarkdownContainer = styled.div`
  min-height: calc(80vh - 200px);
  max-height: calc(80vh - 200px);
  padding-right: 2px;
  overflow: auto;
  overflow-x: hidden;
`

export default AssistantPromptSettings
