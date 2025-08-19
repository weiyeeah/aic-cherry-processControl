import { APP_NAME, isLocalAi } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useMessageStyle, useSettings } from '@renderer/hooks/useSettings'
import type { Assistant, Model, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { removeLeadingEmoji } from '@renderer/utils'
import { Checkbox } from 'antd'
import dayjs from 'dayjs'
import { FC, memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MessageTokens from './MessageTokens'

interface Props {
  message: Message
  assistant: Assistant
  model?: Model
  index: number | undefined
  topic: Topic
}

const MessageHeader: FC<Props> = memo(({ model, message, index, topic }) => {
  const { theme } = useTheme()
  const { userName } = useSettings()
  const { t } = useTranslation()
  const { isBubbleStyle } = useMessageStyle()

  const { isMultiSelectMode, selectedMessageIds, handleSelectMessage } = useChatContext(topic)

  const isSelected = selectedMessageIds?.includes(message.id)

  const getUserName = useCallback(() => {
    if (isLocalAi && message.role !== 'user') {
      return APP_NAME
    }

    if (message.role === 'assistant') {
      // return getModelName(model) || getMessageModelId(message) || ''
      return '科学计算智能体'
    }

    return userName || t('common.you')
  }, [message, model, t, userName])

  const { showTokens } = useSettings()

  const username = useMemo(() => removeLeadingEmoji(getUserName()), [getUserName])
  const isLastMessage = index === 0

  return (
    <Container className="message-header">
      {/* {isAssistantMessage ? (
        <Avatar
          src={avatarSource}
          size={35}
          style={{
            borderRadius: '25%',
            cursor: showMinappIcon ? 'pointer' : 'default',
            border: isLocalAi ? '1px solid var(--color-border-soft)' : 'none',
            filter: theme === 'dark' ? 'invert(0.05)' : undefined
          }}
          onClick={showMiniApp}>
          {avatarName}
        </Avatar>
      ) : (
        <>
          {isEmoji(avatar) ? (
            <EmojiAvatar onClick={() => UserPopup.show()} size={35} fontSize={20}>
              {avatar}
            </EmojiAvatar>
          ) : (
            <Avatar
              src={avatar}
              size={35}
              style={{ borderRadius: '25%', cursor: 'pointer' }}
              onClick={() => UserPopup.show()}
            />
          )}
        </>
      )} */}
      <UserWrap>
        <UserName isBubbleStyle={isBubbleStyle} theme={theme}>
          {username}
        </UserName>
        <InfoWrap className="message-header-info-wrap">
          <MessageTime>{dayjs(message?.updatedAt ?? message.createdAt).format('MM/DD HH:mm')}</MessageTime>
          {showTokens && <DividerContainer style={{ color: 'var(--color-text-3)' }}> | </DividerContainer>}
          <MessageTokens message={message} isLastMessage={isLastMessage} />
        </InfoWrap>
      </UserWrap>
      {isMultiSelectMode && (
        <Checkbox
          checked={isSelected}
          onChange={(e) => handleSelectMessage(message.id, e.target.checked)}
          style={{ position: 'absolute', right: 0, top: 0 }}
        />
      )}
    </Container>
  )
})

MessageHeader.displayName = 'MessageHeader'

const Container = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  position: relative;
`

const UserWrap = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex: 1;
`

const InfoWrap = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
`

const DividerContainer = styled.div`
  font-size: 10px;
  color: var(--color-text-3);
  margin: 0 2px;
`

const UserName = styled.div<{ isBubbleStyle?: boolean; theme?: string }>`
  font-size: 14px;
  font-weight: 600;
  color: ${(props) => (props.isBubbleStyle && props.theme === 'dark' ? 'white' : 'var(--color-text)')};
`

const MessageTime = styled.div`
  font-size: 10px;
  color: var(--color-text-3);
`

export default MessageHeader
