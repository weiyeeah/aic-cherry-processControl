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
 * 按照prompt要求的正确顺序：日期 -> 周数 -> 数据查询
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

      // 3. 按照正确的顺序调用MCP工具获取数据
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
   * 智能选择并调用MCP工具 - 按照正确的顺序和依赖关系
   */
  private static async intelligentlyCallTools(
    userQuery: string,
    availableTools: MCPTool[],
    streamProcessor?: (chunk: any) => void
  ): Promise<Array<{ tool: MCPTool; result: any; arguments: any }>> {
    const results: Array<{ tool: MCPTool; result: any; arguments: any }> = []

    // 按照prompt要求的顺序调用工具：
    // 1. 先获取基础信息（日期、周数）
    // 2. 再基于基础信息进行数据查询

    console.log('[ForcedMCPService] 开始按顺序调用MCP工具获取实时数据')

    // 第一步：获取当前日期
    const currentDateResult = await this.callSingleTool(
      'get_current_date', availableTools, {}, streamProcessor
    )
    if (currentDateResult) {
      results.push(currentDateResult)
    }

    // 第二步：基于当前日期获取周数
    let currentWeekNumber: string | undefined = undefined
    if (currentDateResult && currentDateResult.result && currentDateResult.result.content) {
      const dateContent = currentDateResult.result.content.find((c: any) => c.type === 'text')
      if (dateContent && dateContent.text) {
        const currentDate = dateContent.text.trim()
        const weekResult = await this.callSingleTool(
          'get_week_number', availableTools, { date: currentDate }, streamProcessor
        )
        if (weekResult) {
          results.push(weekResult)
          // 提取周数
          const weekContent = weekResult.result.content.find((c: any) => c.type === 'text')
          if (weekContent && weekContent.text) {
            currentWeekNumber = weekContent.text.trim()
          }
        }
      }
    }

    // 第三步：基于查询内容和获取的基础信息，进行数据查询
    const dataQueryResults = await this.performDataQueries(
      userQuery, availableTools, currentWeekNumber, streamProcessor
    )
    results.push(...dataQueryResults)

    console.log('[ForcedMCPService] 完成所有工具调用，共获取', results.length, '个结果')
    return results
  }

  /**
   * 调用单个工具的辅助方法
   */
  private static async callSingleTool(
    toolName: string,
    availableTools: MCPTool[],
    toolArgs: any,
    streamProcessor?: (chunk: any) => void
  ): Promise<{ tool: MCPTool; result: any; arguments: any } | null> {
    const tool = this.findToolByName(toolName, availableTools)
    if (!tool) {
      console.warn('[ForcedMCPService] 未找到工具:', toolName)
      return null
    }

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
  }

  /**
   * 查找指定名称的工具
   */
  private static findToolByName(toolName: string, availableTools: MCPTool[]): MCPTool | undefined {
    for (const tool of availableTools) {
      if ((tool.name || tool.id) === toolName) {
        return tool
      }
    }
    return undefined
  }

  /**
   * 基于查询内容和基础信息进行数据查询
   */
  private static async performDataQueries(
    userQuery: string,
    availableTools: MCPTool[],
    currentWeekNumber: string | undefined,
    streamProcessor?: (chunk: any) => void
  ): Promise<Array<{ tool: MCPTool; result: any; arguments: any }>> {
    const results: Array<{ tool: MCPTool; result: any; arguments: any }> = []
    const lowerQuery = userQuery.toLowerCase()

    // 计算查询周数（按照prompt要求：查询周数 = 本周周数 - 1）
    let queryWeekNumber: string | undefined = undefined
    if (currentWeekNumber) {
      try {
        const currentWeek = parseInt(currentWeekNumber)
        queryWeekNumber = (currentWeek - 1).toString()
        console.log('[ForcedMCPService] 计算查询周数:', queryWeekNumber, '(当前周数-1)')
      } catch (error) {
        console.warn('[ForcedMCPService] 无法解析周数:', currentWeekNumber)
      }
    }

    // 判断是否需要查询工作计划数据
    if (lowerQuery.indexOf('工作') !== -1 || lowerQuery.indexOf('计划') !== -1 || 
        lowerQuery.indexOf('完成情况') !== -1 || lowerQuery.indexOf('进度') !== -1) {
      
      console.log('[ForcedMCPService] 检测到工作计划查询需求')
      
      // 构建工作计划表查询参数（按照prompt中的TQL格式）
      const workPlanArgs = {
        tableId: 'tblBq27RjBeLbElA7VM', // 周工作计划表
        tql: queryWeekNumber ? `{所属周数} = '${queryWeekNumber}'` : undefined
      }

      if (workPlanArgs.tql) {
        const workPlanResult = await this.callSingleTool(
          'list_teable_records', availableTools, workPlanArgs, streamProcessor
        )
        if (workPlanResult) {
          results.push(workPlanResult)
        }
      }
    }

    // 判断是否需要查询任务数据
    if (lowerQuery.indexOf('任务') !== -1 || lowerQuery.indexOf('布置') !== -1 || 
        lowerQuery.indexOf('日程') !== -1 || lowerQuery.indexOf('安排') !== -1) {
      
      console.log('[ForcedMCPService] 检测到任务查询需求')
      
      // 构建任务表查询参数
      const taskArgs = {
        tableId: 'tblgTQaA7O7cv7sfYnO', // 周会布置任务表
        tql: queryWeekNumber ? `{所属周数} = '${queryWeekNumber}'` : undefined
      }

      if (taskArgs.tql) {
        const taskResult = await this.callSingleTool(
          'list_teable_records', availableTools, taskArgs, streamProcessor
        )
        if (taskResult) {
          results.push(taskResult)
        }
      }
    }

    // 如果没有特定查询，获取表格列表作为基础信息
    if (results.length === 0) {
      console.log('[ForcedMCPService] 未检测到特定查询，获取表格列表')
      const tableListResult = await this.callSingleTool(
        'get_table_list', availableTools, {}, streamProcessor
      )
      if (!tableListResult) {
        // 尝试备用工具名
        const altTableListResult = await this.callSingleTool(
          'Get Teable Table List', availableTools, {}, streamProcessor
        )
        if (altTableListResult) {
          results.push(altTableListResult)
        }
      } else {
        results.push(tableListResult)
      }
    }

    return results
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