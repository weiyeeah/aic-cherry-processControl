import { useAppSelector } from '@renderer/store'
import { MCPTool } from '@renderer/types'
import { Button, List, message, Modal, Space, Spin, Tooltip, Typography } from 'antd'
import { Trash2, Upload } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface MCPFileUploadButtonProps {
  ToolbarButton: React.ComponentType<any>
}

const MCPFileUploadButton: FC<MCPFileUploadButtonProps> = ({ ToolbarButton }) => {
  const mcpServers = useAppSelector((state) => state.mcp.servers)
  const mcpFileConfig = useAppSelector((state) => state.mcpFile.toolConfig)
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([])
  const [loading, setLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [fileList, setFileList] = useState<string[]>([])
  const [fileListLoading, setFileListLoading] = useState(false)
  const [fileListError, setFileListError] = useState<string>('')
  const [deletingFile, setDeletingFile] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 获取配置的工具名称
  const uploadFileToolName = mcpFileConfig.toolNames.uploadFile
  const listFilesToolName = mcpFileConfig.toolNames.listFiles
  const deleteFileToolName = mcpFileConfig.toolNames.deleteFile

  // 获取配置的参数键名
  const filenameParamKey = mcpFileConfig.paramKeys.filename
  const contentBase64ParamKey = mcpFileConfig.paramKeys.contentBase64

  // 工具查找
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

  const uploadFileTool = useMemo(() => {
    return mcpTools.find((tool) => tool.name === uploadFileToolName)
  }, [mcpTools, uploadFileToolName])

  const listFilesTool = useMemo(() => {
    return mcpTools.find((tool) => tool.name === listFilesToolName)
  }, [mcpTools, listFilesToolName])

  const deleteFileTool = useMemo(() => {
    return mcpTools.find((tool) => tool.name === deleteFileToolName)
  }, [mcpTools, deleteFileToolName])

  // 首次加载工具
  useEffect(() => {
    setLoading(true)
    fetchTools().finally(() => setLoading(false))
  }, [fetchTools])

  // 轮询直到upload_file可用
  useEffect(() => {
    if (uploadFileTool || loading) return
    const interval = setInterval(async () => {
      const tools = await fetchTools()
      if (tools.some((t) => t.name === uploadFileToolName)) {
        clearInterval(interval)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [uploadFileTool, loading, fetchTools, uploadFileToolName])

  // 打开Modal时拉取文件列表
  const fetchFileList = useCallback(async () => {
    if (!listFilesTool) {
      setFileListError(`MCP "${listFilesToolName}" tool not available`)
      setFileList([])
      return
    }
    setFileListLoading(true)
    setFileListError('')
    try {
      const server = mcpServers.find((s) => s.id === listFilesTool.serverId)
      if (!server) throw new Error('MCP server not found for the tool')
      const resp = await window.api.mcp.callTool({
        server,
        name: listFilesToolName,
        args: {}
      })
      if (resp.isError) {
        setFileListError(resp.content?.[0]?.text || 'Unknown error')
        setFileList([])
      } else {
        const text = resp.content?.[0]?.text || ''
        setFileList(text ? text.split('\n').filter(Boolean) : [])
      }
    } catch (e: any) {
      setFileListError(e?.message || 'Unknown error')
      setFileList([])
    } finally {
      setFileListLoading(false)
    }
  }, [listFilesTool, mcpServers, listFilesToolName])

  // 打开Modal时自动拉取
  useEffect(() => {
    if (isModalOpen) fetchFileList()
  }, [isModalOpen, fetchFileList])

  // 上传
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !uploadFileTool) return
    setIsUploading(true)
    const uploadKey = 'mcp-file-upload'
    message.loading({ content: `Uploading "${file.name}"...`, key: uploadKey })
    try {
      const content_base64 = await toBase64(file)
      if (typeof content_base64 !== 'string') throw new Error('Failed to read file as base64')
      const server = mcpServers.find((s) => s.id === uploadFileTool.serverId)
      if (!server) throw new Error('MCP server not found for the tool')

      const args: Record<string, string> = {}
      args[filenameParamKey] = file.name
      args[contentBase64ParamKey] = content_base64

      await window.api.mcp.callTool({
        server,
        name: uploadFileToolName,
        args
      })
      message.success({ content: `File "${file.name}" uploaded successfully.`, key: uploadKey, duration: 2 })
      fetchFileList()
    } catch (error: any) {
      message.error({ content: `Failed to upload file: ${error.message}`, key: uploadKey, duration: 3 })
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // 删除
  const handleDeleteFile = async (filename: string) => {
    if (!deleteFileTool) {
      message.error(`MCP "${deleteFileToolName}" tool not available`)
      return
    }
    setDeletingFile(filename)
    try {
      const server = mcpServers.find((s) => s.id === deleteFileTool.serverId)
      if (!server) throw new Error('MCP server not found for the tool')

      const args: Record<string, string> = {}
      args[filenameParamKey] = filename

      await window.api.mcp.callTool({
        server,
        name: deleteFileToolName,
        args
      })
      message.success(`File "${filename}" deleted.`)
      fetchFileList()
    } catch (e: any) {
      message.error(`Failed to delete file: ${e?.message || 'Unknown error'}`)
    } finally {
      setDeletingFile(null)
    }
  }

  const toBase64 = (file: File): Promise<string | ArrayBuffer | null> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => {
        if (reader.result) {
          resolve((reader.result as string).split(',')[1])
        } else {
          reject(new Error('Failed to read file'))
        }
      }
      reader.onerror = (error) => reject(error)
    })

  const handleButtonClick = () => {
    setIsModalOpen(true)
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const hasUploadTool = !!uploadFileTool
  const modalTitle = (
    <Space>
      {/* <Upload /> */}
      {/* <span>点击下方按钮可以上传文件</span> */}
    </Space>
  )

  return (
    <>
      <Tooltip placement="top" title="上传/管理文件" arrow>
        <span>
          <ToolbarButton
            type="text"
            onClick={handleButtonClick}
            style={{ marginRight: -2, marginTop: 1 }}
            disabled={!hasUploadTool || isUploading}>
            {isUploading ? <Spin size="small" /> : <Upload size={18} />}
          </ToolbarButton>
        </span>
      </Tooltip>
      <Modal
        open={isModalOpen}
        title={modalTitle}
        onCancel={() => setIsModalOpen(false)}
        footer={null}
        width={420}
        destroyOnClose>
        <div style={{ marginBottom: 16 }}>
          <Button
            type="primary"
            icon={<Upload />}
            onClick={handleUploadClick}
            loading={isUploading}
            disabled={!hasUploadTool}>
            上传文件
          </Button>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} />
        </div>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          服务器文件列表
        </Typography.Title>
        {fileListLoading ? (
          <Spin />
        ) : fileListError ? (
          <Typography.Text type="danger">{fileListError}</Typography.Text>
        ) : fileList.length === 0 ? (
          <Typography.Text type="secondary">暂无文件</Typography.Text>
        ) : (
          <List
            size="small"
            bordered
            dataSource={fileList}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    type="text"
                    icon={<Trash2 />}
                    danger
                    size="small"
                    loading={deletingFile === item}
                    onClick={() => handleDeleteFile(item)}
                    key="delete">
                    删除
                  </Button>
                ]}>
                <Typography.Text style={{ wordBreak: 'break-all' }}>{item}</Typography.Text>
              </List.Item>
            )}
          />
        )}
      </Modal>
    </>
  )
}

export default MCPFileUploadButton
