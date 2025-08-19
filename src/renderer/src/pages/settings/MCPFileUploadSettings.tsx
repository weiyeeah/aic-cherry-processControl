import { BulbOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { MCPTool } from '@renderer/types'
import { Button, Card, Form, Input, message, Select, Space, Spin, Tooltip, Typography } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingTitle } from './index'

const { Text } = Typography
const { Option } = Select

const MCPFileUploadSettings: FC = () => {
  const dispatch = useAppDispatch()
  const { theme } = useTheme()
  const mcpServers = useAppSelector((state) => state.mcp.servers)
  const mcpFileConfig = useAppSelector((state) => state.mcpFile?.toolConfig) || {
    toolNames: {
      uploadFile: 'upload_file',
      listFiles: 'list_files',
      deleteFile: 'delete_file'
    },
    paramKeys: {
      filename: 'filename',
      contentBase64: 'content_base64'
    }
  }
  const [form] = Form.useForm()
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([])
  const [loading, setLoading] = useState(true)

  // 自动推荐结果
  const [recommendations, setRecommendations] = useState<{
    uploadFile?: string
    listFiles?: string
    deleteFile?: string
  }>({})
  // ==================== 智能工具推荐 ====================
  // 关键字映射
  const keywordMap = {
    uploadFile: ['upload', 'file', 'put'],
    listFiles: ['list', 'files', 'ls'],
    deleteFile: ['delete', 'remove', 'rm']
  } as const

  // 根据类型从工具列表中选出最匹配的工具名称
  const getBestTool = (type: keyof typeof keywordMap, tools: MCPTool[]): string | undefined => {
    if (!tools.length) return undefined
    const keywords = keywordMap[type]
    let bestName: string | undefined
    let bestScore = -1

    tools.forEach((tool) => {
      const text = `${tool.name} ${tool.description || ''}`.toLowerCase()
      const score = keywords.reduce((acc, kw) => acc + (text.includes(kw) ? 1 : 0), 0)

      if (score > bestScore) {
        bestScore = score
        bestName = tool.name
      }
    })

    // 如果最佳得分 <= 0，说明没有关键字匹配，退而求其次取列表首项
    if (bestScore <= 0) {
      return tools[0]?.name
    }
    return bestName
  }
  // =====================================================

  // 点击推荐按钮后写入表单
  const applyRecommendation = (type: 'uploadFile' | 'listFiles' | 'deleteFile') => {
    if (loading) return
    const bestTool = recommendations[type]
    if (!bestTool) {
      message.warning('未找到合适的工具')
      return
    }

    const current = form.getFieldValue(['toolNames', type])
    if (current === bestTool) {
      message.info('已是最佳选择')
      return
    }

    const toolNames = {
      ...(form.getFieldValue('toolNames') || {}),
      [type]: bestTool
    }
    form.setFieldsValue({ toolNames })
    message.success(`已为你填入 ${bestTool}`)
  }

  // 一键应用所有推荐
  const applyAllRecommendations = () => {
    if (loading) return

    const newToolNames = { ...form.getFieldValue('toolNames') }
    let changed = false

    if (recommendations.uploadFile && newToolNames.uploadFile !== recommendations.uploadFile) {
      newToolNames.uploadFile = recommendations.uploadFile
      changed = true
    }

    if (recommendations.listFiles && newToolNames.listFiles !== recommendations.listFiles) {
      newToolNames.listFiles = recommendations.listFiles
      changed = true
    }

    if (recommendations.deleteFile && newToolNames.deleteFile !== recommendations.deleteFile) {
      newToolNames.deleteFile = recommendations.deleteFile
      changed = true
    }

    if (changed) {
      form.setFieldsValue({ toolNames: newToolNames })
      message.success('已应用所有推荐工具')
    } else {
      message.info('已是最佳选择')
    }
  }

  // 获取工具列表
  const fetchTools = useCallback(async () => {
    const enabledMCPs = mcpServers.filter((s) => s.isActive)
    if (enabledMCPs.length > 0) {
      const toolPromises = enabledMCPs.map<Promise<MCPTool[]>>(async (mcpServer) => {
        try {
          const tools = await window.api.mcp.listTools(mcpServer)
          return tools.filter((tool: any) => !mcpServer.disabledTools?.includes(tool.name))
        } catch (error) {
          return []
        }
      })
      const results = await Promise.allSettled(toolPromises)
      const allTools = results
        .filter((result): result is PromiseFulfilledResult<MCPTool[]> => result.status === 'fulfilled')
        .map((result) => result.value)
        .flat()
      setMcpTools(allTools)
      return allTools
    } else {
      setMcpTools([])
      return []
    }
  }, [mcpServers])

  // 加载工具列表
  useEffect(() => {
    setLoading(true)
    fetchTools().finally(() => setLoading(false))
  }, [fetchTools])

  // 当工具列表更新时，计算推荐
  useEffect(() => {
    if (mcpTools.length) {
      setRecommendations({
        uploadFile: getBestTool('uploadFile', mcpTools),
        listFiles: getBestTool('listFiles', mcpTools),
        deleteFile: getBestTool('deleteFile', mcpTools)
      })
    } else {
      setRecommendations({})
    }
  }, [mcpTools])

  useEffect(() => {
    form.setFieldsValue(mcpFileConfig)
  }, [form, mcpFileConfig])

  const handleSave = (values: any) => {
    dispatch({
      type: 'mcpFile/setMCPFileToolConfig',
      payload: values
    })
    message.success('设置已保存')
  }

  // 自定义渲染选项
  const renderToolOption = (tool: MCPTool) => (
    <Space direction="vertical" size={0} style={{ width: '100%' }}>
      <Text strong>{tool.name}</Text>
      {tool.description && (
        <Text type="secondary" style={{ fontSize: '12px', whiteSpace: 'normal' }}>
          {tool.description}
        </Text>
      )}
    </Space>
  )

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>文件上传工具配置</SettingTitle>
        <SettingDivider />
        <Description>配置MCP文件上传工具使用的工具名称和参数键名</Description>

        {loading ? (
          <LoadingContainer>
            <Spin tip="正在加载工具列表..." />
          </LoadingContainer>
        ) : (
          <Form form={form} layout="vertical" onFinish={handleSave} initialValues={mcpFileConfig}>
            <Card
              title={
                <HeaderContainer>
                  <span>工具名称</span>
                  {Object.keys(recommendations).length > 0 && (
                    <Tooltip title="一键应用所有推荐工具">
                      <SmartButton
                        type="primary"
                        icon={<ThunderboltOutlined />}
                        size="small"
                        onClick={applyAllRecommendations}>
                        智能推荐
                      </SmartButton>
                    </Tooltip>
                  )}
                </HeaderContainer>
              }
              bordered={false}
              style={{ marginBottom: 16 }}>
              <Form.Item label="上传文件工具" required>
                <SelectWrapper>
                  <Form.Item name={['toolNames', 'uploadFile']} noStyle rules={[{ required: true, message: '必填项' }]}>
                    <Select
                      placeholder="选择上传文件工具"
                      showSearch
                      optionFilterProp="label"
                      optionLabelProp="label"
                      style={{ flex: 1 }}>
                      {mcpTools.map((tool) => (
                        <Option key={`upload-${tool.name}`} value={tool.name} label={tool.name}>
                          {renderToolOption(tool)}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                  {recommendations.uploadFile && (
                    <Tooltip title={`推荐使用 ${recommendations.uploadFile}`}>
                      <IconButton
                        type="text"
                        icon={<BulbOutlined />}
                        onClick={() => applyRecommendation('uploadFile')}
                        disabled={loading}
                      />
                    </Tooltip>
                  )}
                </SelectWrapper>
              </Form.Item>

              <Form.Item label="列出文件工具" required>
                <SelectWrapper>
                  <Form.Item name={['toolNames', 'listFiles']} noStyle rules={[{ required: true, message: '必填项' }]}>
                    <Select
                      placeholder="选择列出文件工具"
                      showSearch
                      optionFilterProp="label"
                      optionLabelProp="label"
                      style={{ flex: 1 }}>
                      {mcpTools.map((tool) => (
                        <Option key={`list-${tool.name}`} value={tool.name} label={tool.name}>
                          {renderToolOption(tool)}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                  {recommendations.listFiles && (
                    <Tooltip title={`推荐使用 ${recommendations.listFiles}`}>
                      <IconButton
                        type="text"
                        icon={<BulbOutlined />}
                        onClick={() => applyRecommendation('listFiles')}
                        disabled={loading}
                      />
                    </Tooltip>
                  )}
                </SelectWrapper>
              </Form.Item>

              <Form.Item label="删除文件工具" required>
                <SelectWrapper>
                  <Form.Item name={['toolNames', 'deleteFile']} noStyle rules={[{ required: true, message: '必填项' }]}>
                    <Select
                      placeholder="选择删除文件工具"
                      showSearch
                      optionFilterProp="label"
                      optionLabelProp="label"
                      style={{ flex: 1 }}>
                      {mcpTools.map((tool) => (
                        <Option key={`delete-${tool.name}`} value={tool.name} label={tool.name}>
                          {renderToolOption(tool)}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                  {recommendations.deleteFile && (
                    <Tooltip title={`推荐使用 ${recommendations.deleteFile}`}>
                      <IconButton
                        type="text"
                        icon={<BulbOutlined />}
                        onClick={() => applyRecommendation('deleteFile')}
                        disabled={loading}
                      />
                    </Tooltip>
                  )}
                </SelectWrapper>
              </Form.Item>
            </Card>

            <Card title="参数键名" bordered={false} style={{ marginBottom: 16 }}>
              <Form.Item
                label="文件名参数"
                name={['paramKeys', 'filename']}
                rules={[{ required: true, message: '必填项' }]}>
                <Input placeholder="filename" />
              </Form.Item>

              <Form.Item
                label="文件内容参数"
                name={['paramKeys', 'contentBase64']}
                rules={[{ required: true, message: '必填项' }]}>
                <Input placeholder="content_base64" />
              </Form.Item>
            </Card>

            <ButtonContainer>
              <Button type="primary" htmlType="submit">
                保存
              </Button>
            </ButtonContainer>
          </Form>
        )}
      </SettingGroup>
    </SettingContainer>
  )
}

const Description = styled.p`
  margin-bottom: 24px;
  opacity: 0.7;
`

const ButtonContainer = styled.div`
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
`

const LoadingContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
`

// 工具选择框 + 按钮的容器
const SelectWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
`

// 图标按钮样式
const IconButton = styled(Button)`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
  color: #1890ff;

  &:hover {
    color: #40a9ff;
    background-color: rgba(24, 144, 255, 0.1);
  }
`

// 卡片标题容器
const HeaderContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
`

// 智能推荐按钮
const SmartButton = styled(Button)`
  font-size: 12px;
`

export default MCPFileUploadSettings
