import { FC } from 'react'

interface Props {
  disabled: boolean
  sendMessage: () => void
}

const SendMessageButton: FC<Props> = ({ disabled, sendMessage }) => {
  return (
    <button
      onClick={sendMessage}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--color-text-3)' : 'var(--color-primary)',
        fontSize: 16,
        transition: 'all 0.2s',
        marginRight: 2,
        background: 'none',
        border: 'none',
        padding: '0 8px',
        borderRadius: '20px',
        height: 32
      }}
      aria-label="发送消息"
      type="button">
      {/* <span
        className="iconfont icon-ic_send"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: disabled ? 'var(--color-text-3)' : 'var(--color-primary)',
          color: '#fff',
          fontSize: 18,
          marginRight: 6
        }}
      /> */}
      <span style={{ fontWeight: 500, fontSize: 16, color: 'inherit' }}>发送</span>
    </button>
  )
}

export default SendMessageButton
