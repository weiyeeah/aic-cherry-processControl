import type { Assistant, MCPServer, MCPTool, MCPToolResponse } from '@renderer/types'
import { callMCPTool } from '@renderer/utils/mcp-tools'
import { uuid } from '@renderer/utils'

export interface ForcedMCPResult {
  success: boolean
  mcpData?: string
  error?: string
}

/**
 * 强制MCP工具预调用服务
 * 在LLM生成回答之前，强制调用MCP工具获取实时数据
 */
export class ForcedMCPService {
  /**
   * 强制调用MCP工具获取数据
   * @param assistant 助手配置
   * @param userQuery 用户查询
   * @param streamProcessor 流处理器，用于触发UI回调
   * @returns 包含MCP调用结果的对象
   */
  static async forceCallMCPTools(
    assistant: Assistant,
    userQuery: string,
    streamProcessor?: (chunk: any) => void
  ): Promise<ForcedMCPResult> {
    try {
      console.log('[ForcedMCPService] 开始强制MCP工具预调用，用户查询:', userQuery.substring(0, 100))

      // 1. 获取助手的活跃MCP服务器
      const activeServers = assistant.mcpServers?.filter(server => server.isActive) || []
      if (activeServers.length === 0) {
        console.warn('[ForcedMCPService] 没有找到活跃的MCP服务器')
        return { success: false, error: '没有活跃的MCP服务器' }
      }

      // 2. 获取可用的MCP工具列表
      const availableTools = await this.getAvailableMCPTools(activeServers)
      if (availableTools.length === 0) {
        console.warn('[ForcedMCPService] 没有找到可用的MCP工具')
        return { success: false, error: '没有可用的MCP工具' }
      }

      console.log('[ForcedMCPService] 可用工具:', availableTools.map(t => t.name))

      // 3. 基于用户查询智能选择和调用工具
      const mcpResults = await this.intelligentlyCallTools(
        userQuery,
        availableTools,
        streamProcessor
      )

      if (mcpResults.length === 0) {
        return { success: false, error: '未能成功调用任何MCP工具' }
      }

      // 4. 格式化MCP数据为上下文
      const mcpDataContext = this.formatMCPDataAsContext(mcpResults)
      console.log('[ForcedMCPService] MCP数据上下文长度:', mcpDataContext.length)

      return {
        success: true,
        mcpData: mcpDataContext
      }

    } catch (error) {
      console.error('[ForcedMCPService] MCP预调用失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * 获取可用的MCP工具列表
   */
  private static async getAvailableMCPTools(servers: MCPServer[]): Promise<MCPTool[]> {
    const allTools: MCPTool[] = []

    for (const server of servers) {
      try {
        console.log('[ForcedMCPService] 获取服务器工具:', server.name)
        const tools = await window.api.mcp.listTools(server)
        
        if (tools && tools.length > 0) {
          // 为工具添加服务器信息
          const serverTools = tools.map(tool => ({
            ...tool,
            serverId: server.id,
            serverName: server.name
          }))
          allTools.push(...serverTools)
          console.log('[ForcedMCPService] 服务器', server.name, '提供', serverTools.length, '个工具')
        }
      } catch (error) {
        console.warn('[ForcedMCPService] 获取服务器工具失败:', server.name, error)
      }
    }

    return allTools
  }

  /**
   * 智能选择并调用MCP工具
   */
  private static async intelligentlyCallTools(
    userQuery: string,
    availableTools: MCPTool[],
    streamProcessor?: (chunk: any) => void
  ): Promise<Array<{ tool: MCPTool; result: any; arguments: any }>> {
    const results: Array<{ tool: MCPTool; result: any; arguments: any }> = []

    // 基于用户查询内容智能选择工具
    const selectedTools = this.selectToolsBasedOnQuery(userQuery, availableTools)
    
    console.log('[ForcedMCPService] 基于查询选择的工具:', selectedTools.map(t => t.toolName))

    // 并行调用选择的工具
    const toolPromises = selectedTools.map(async ({ tool, arguments: toolArgs }) => {
      try {
        console.log('[ForcedMCPService] 调用工具:', tool.name, '参数:', toolArgs)

        // 创建工具响应对象
        const toolResponse: MCPToolResponse = {
          id: uuid(),
          tool,
          arguments: toolArgs,
          status: 'invoking'
        }

        // 触发UI回调 - 工具调用开始
        if (streamProcessor) {
          streamProcessor({
            type: 'mcp_tool_in_progress' as any,
            responses: [toolResponse]
          })
        }

        // 调用工具
        const result = await callMCPTool(toolResponse)
        
        // 更新工具响应状态
        const completedResponse: MCPToolResponse = {
          ...toolResponse,
          status: 'done',
          response: result
        }

        // 触发UI回调 - 工具调用完成
        if (streamProcessor) {
          streamProcessor({
            type: 'mcp_tool_complete' as any,
            responses: [completedResponse]
          })
        }

        console.log('[ForcedMCPService] 工具调用完成:', tool.name)
        return { tool, result, arguments: toolArgs }

      } catch (error) {
        console.error('[ForcedMCPService] 工具调用失败:', tool.name, error)
        
        // 触发UI回调 - 工具调用失败
        if (streamProcessor) {
          streamProcessor({
            type: 'mcp_tool_complete' as any,
            responses: [{
              id: uuid(),
              tool,
              arguments: toolArgs,
              status: 'error',
              response: { isError: true, content: [{ type: 'text', text: String(error) }] }
            }]
          })
        }
        
        return null
      }
    })

    // 等待所有工具调用完成 
    // 使用兼容性更好的方式处理Promise.all
    const toolResults: Array<{ tool: MCPTool; result: any; arguments: any } | null> = []
    for (const promise of toolPromises) {
      try {
        const result = await promise
        toolResults.push(result)
      } catch (error) {
        console.error('[ForcedMCPService] 工具调用Promise失败:', error)
        toolResults.push(null)
      }
    }
    
    // 过滤掉null结果
    for (const result of toolResults) {
      if (result !== null) {
        results.push(result)
      }
    }

    return results
  }

  /**
   * 基于用户查询选择合适的工具和参数
   */
  private static selectToolsBasedOnQuery(
    userQuery: string,
    availableTools: MCPTool[]
  ): Array<{ tool: MCPTool; toolName: string; arguments: any }> {
    const selectedTools: Array<{ tool: MCPTool; toolName: string; arguments: any }> = []
    const lowerQuery = userQuery.toLowerCase()

    // 智能工具选择逻辑
    for (const tool of availableTools) {
      const toolName = tool.name || tool.id
      let shouldCall = false
      let toolArguments: any = {}

      // 根据工具名称和查询内容判断是否应该调用
      switch (toolName) {
        case 'get_current_date':
          // 几乎所有查询都需要当前日期
          shouldCall = true
          toolArguments = {}
          break

        case 'get_week_number':
          // 涉及周数的查询
          if (lowerQuery.indexOf('周') !== -1 || lowerQuery.indexOf('week') !== -1 || 
              lowerQuery.indexOf('本周') !== -1 || lowerQuery.indexOf('上周') !== -1 || lowerQuery.indexOf('下周') !== -1) {
            shouldCall = true
            toolArguments = { date: new Date().toISOString().split('T')[0] }
          }
          break

        case 'list_teable_records':
          // 数据查询相关
          if (lowerQuery.indexOf('查询') !== -1 || lowerQuery.indexOf('工作') !== -1 || lowerQuery.indexOf('任务') !== -1 || 
              lowerQuery.indexOf('计划') !== -1 || lowerQuery.indexOf('情况') !== -1 || lowerQuery.indexOf('状态') !== -1) {
            shouldCall = true
            // 这里需要LLM来决定具体参数，暂时使用一个通用的查询
            toolArguments = this.generateTableQueryArguments(lowerQuery)
          }
          break

        case 'get_table_list':
        case 'Get Teable Table List':
          // 获取表格列表，用于其他查询的基础
          if (lowerQuery.indexOf('表') !== -1 || lowerQuery.indexOf('数据') !== -1 || 
              lowerQuery.indexOf('查询') !== -1 || lowerQuery.indexOf('工作') !== -1) {
            shouldCall = true
            toolArguments = {}
          }
          break

        default:
          // 对于其他工具，基于工具描述和名称进行智能判断
          if (tool.description) {
            const descLower = tool.description.toLowerCase()
            if (this.queryMatchesTool(lowerQuery, toolName.toLowerCase(), descLower)) {
              shouldCall = true
              toolArguments = this.generateGenericArguments(tool, lowerQuery)
            }
          }
          break
      }

      if (shouldCall) {
        selectedTools.push({ tool, toolName, arguments: toolArguments })
      }
    }

    // 如果没有选择任何工具，至少调用基础工具
    if (selectedTools.length === 0) {
      const basicTools = ['get_current_date', 'get_table_list', 'Get Teable Table List']
      for (const toolName of basicTools) {
        let foundTool: MCPTool | undefined = undefined
        for (const t of availableTools) {
          if ((t.name || t.id) === toolName) {
            foundTool = t
            break
          }
        }
        if (foundTool) {
          selectedTools.push({ tool: foundTool, toolName, arguments: {} })
          break // 只添加一个基础工具
        }
      }
    }

    return selectedTools
  }

  /**
   * 判断查询是否匹配工具
   */
  private static queryMatchesTool(query: string, toolName: string, toolDescription: string): boolean {
    // 简单的关键词匹配逻辑
    const queryWords = query.split(/\s+/)
    const toolWords = (toolName + ' ' + toolDescription).split(/\s+/)
    
    return queryWords.some(qWord => 
      toolWords.some(tWord => 
        tWord.includes(qWord) || qWord.includes(tWord)
      )
    )
  }

  /**
   * 生成表格查询参数
   */
  private static generateTableQueryArguments(query: string): any {
    // 基础查询参数
    const args: any = {}

    // 根据查询内容推断表格ID
    if (query.includes('工作计划') || query.includes('工作记录') || query.includes('完成情况')) {
      args.tableId = 'tblBq27RjBeLbElA7VM' // 周工作计划表
    } else if (query.includes('任务') || query.includes('布置') || query.includes('日程')) {
      args.tableId = 'tblgTQaA7O7cv7sfYnO' // 周会布置任务表
    }

    // 基础TQL查询（这里只是示例，实际应该由LLM决定）
    if (args.tableId) {
      args.tql = `{所属周数} = '当前周-1'` // 简化示例
    }

    return args
  }

  /**
   * 生成通用工具参数
   */
  private static generateGenericArguments(tool: MCPTool, query: string): any {
    // 基于工具的输入模式生成基本参数
    const args: any = {}
    
    // 如果工具有输入模式，尝试填充基本值
    if (tool.inputSchema && tool.inputSchema.properties) {
      Object.keys(tool.inputSchema.properties).forEach(key => {
        const property = tool.inputSchema.properties[key] as any
        if (property && typeof property === 'object' && 'type' in property) {
          if (property.type === 'string') {
            args[key] = query.substring(0, 100) // 使用查询的前100个字符
          } else if (property.type === 'object') {
            args[key] = {}
          }
        }
      })
    }

    return args
  }

  /**
   * 将MCP数据格式化为上下文
   */
  private static formatMCPDataAsContext(
    mcpResults: Array<{ tool: MCPTool; result: any; arguments: any }>
  ): string {
    let contextData = '\n[SYSTEM_MCP_DATA]\n'
    contextData += '## 实时MCP工具数据\n\n'

    mcpResults.forEach(({ tool, result, arguments: toolArgs }, index) => {
      contextData += `### 工具${index + 1}: ${tool.name}\n`
      contextData += `**调用参数**: ${JSON.stringify(toolArgs, null, 2)}\n`
      contextData += `**返回结果**:\n`
      
      if (result && result.content) {
              result.content.forEach((content: any) => {
        if (content && typeof content === 'object' && 'type' in content) {
          if (content.type === 'text') {
            contextData += content.text + '\n'
          } else if (content.type === 'json') {
            contextData += '```json\n' + JSON.stringify(content.data, null, 2) + '\n```\n'
          } else {
            contextData += `[${content.type} content]\n`
          }
        } else {
          contextData += `[unknown content format]\n`
        }
      })
      } else {
        contextData += JSON.stringify(result, null, 2) + '\n'
      }
      
      contextData += '\n---\n\n'
    })

    contextData += '[/SYSTEM_MCP_DATA]\n\n'
    return contextData
  }
}