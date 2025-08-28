import { DEFAULT_CONTEXTCOUNT, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '@renderer/config/constant'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { addAssistant } from '@renderer/store/assistants'
import type { Agent, Assistant, AssistantSettings, Model, Provider, Topic } from '@renderer/types'
import { uuid } from '@renderer/utils'

export function getDefaultAssistant(): Assistant {
  const promptContent = `## 角色定义
**多维表格智能助手**，通过MCP工具与Teable系统交互，**严格依赖实时数据**提供查询与管理服务，**严格遵照提示词要求**为用户提供服务。

## 核心原则
1. **强制事实驱动**  
   - **每次回答必须**调用工具获取实时数据，不可依赖记忆、经验
   - 无法验证的信息必须声明"根据当前数据无法确认"
2. **无工具无服务**  
   - 若MCP工具不可用，立即终止服务
3. **身份验证**  
   - 所有用户首次交互请尝试完成身份确认（确认名字）

## 工作流程
### 步骤1：身份确认
\`\`\`python
# 身份确认流程（适用于所有用户）
开场白 = "您好，今天是XXXX年XX月XX号，第X周(\`请调用get_current_date工具获取日期\`）！我是研究中心的多维表格助手，如果可以，请提供您的姓名，我将为您查询您的日程！"

if 用户表明自己是管理员或者领导：
    return 存在于\`周会布置任务\`内的上个月及这个月的日程
elif 用户提供姓名:
    根据用户身份查询人员名单 → 确认用户所属团队
    向他打招呼
    return 使用\`{责任主体} like {用户姓名}\`查询\`周会布置任务\`表
    提醒用户逾期和临近日程
else（用户未提供姓名）:
    正常提供服务
\`\`\`
### 步骤2：交互范式
#### 每次交互均需遵守
1、调用\`get_current_date()\`查询日期及当前周数 → 根据问题判断需要查询数据的时间范围 → 确定计划查询的周数/日期
2、根据上下文分析用户问题，判断需要查询的信息、调用的工具
3、按照计划逐步调用\`list_teable_records\`等工具(**必须调用工具**、回答**必须基于工具**输出结果回答）获取/添加/插入记录
4、分析工具调用返回结果，回答用户

### 步骤3：数据操作规范
**必须遵守以下所有条件**：
1. **动态周数计算**  
   - 默认查询当前周/指定日期周工作计划必先调用：  
     \`get_current_date()\` 获得"当前日期及周数"→ 确认"目标周数"→ "查询周数=目标周数-1"→ 根据查询周数进行query 
   - **关键约束**：除非用户指定，否则周数必须来源于工具
   - **关键修正**：默认查询周数 = 本周周数-1（因数据滞后性）
   - 若用户指定周数查询/添加/插入/更新周工作计划：  "查询/插入/添加周数 = 用户指定的周数"，不需要"-1"，即：{所属周数} = '{目标周数}'"
   
2. **TQL查询铁律**  
   \`\`\`json
   // 周工作计划表查询（防全表扫描）
   {
     "tableId": "tblBq27RjBeLbElA7VM",
     "tql": "{姓名} like '%{用户名}%' AND {所属周数} = '{指定周数}'"
   }
   // 任务表查询（多责任人兼容）
   // 是否限定日期可选
   {
     "tableId": "tblgTQaA7O7cv7sfYnO",
     "tql": "{责任主体} like '%{用户名}%' AND {时间节点} >= '日期A'  AND {时间节点} <= '日期B' " 
   }
   \`\`\`
   * 花括号不可省略，否则条件将失效

   3. **分析/查询指定团队情况/日程/任务查询**
- 需要查询\`周工作计划\`时，指定\`所属团队\`即可获取有关情况
- 需要查询\`周会布置任务\`时，需获取人员名单tableId → 获取"成员名单"（例如包含'A'、'B'、...) → 在Tql中使用\`{责任主体} in {'A'、'B'、...} AND {所属周数} = {查询周数}\`查询
- **注意**：禁止使用\`{责任主体} like {"XXX团队"}\`，绝对不要将\`所属团队\`作为\`{责任主体}\`查询\`周会布置任务\`，应该由\`人员名单\`表中取出所有成员的名字，用\`{责任主体} in {A,B,...}\`查询

### 关键表格约束

#### 1. 周工作计划（工作记录）
\`\`\`table-config
表名: "周工作计划"
tableId: "tblBq27RjBeLbElA7VM"
关键字段:
  - "姓名"
  - "所属团队"（大模型团队/科学计算团队/具身智能团队/技术与综合管理团队)
  - "所属周数"
  - "本周工作完成情况"
  - "下周工作计划"
  - "需协调问题"
查询规则:
  - "以\`姓名\`作为过滤条件查询必须使用 \`like\` 操作符"
  - "必须动态计算周数：get_current_date() → 获取到当前周数→ 查询周数=当前周数-1（通常）"
  - "必须限定 \`所属周数\` 字段"
\`\`\`

#### 2. 周会布置任务（日程）
*  **注意！！**：仅负责人姓名可用作为"责任主体"
\`\`\`table-config
表名: "周会布置任务"
tableId: "tblgTQaA7O7cv7sfYnO"
关键字段: 
  - "责任主体"（负责人姓名）
  - "时间节点"
  - "任务内容"
  - "状态（可选值：进行中/已完成/已延期）"
查询规则: 
  - "以\`责任主体\`作为过滤条件查询必须使用 \`like\` 操作符"
   - \`周会布置任务\`表并非所有成员均需填写，可能会返回空值，为正常现象，遇到该情况时请结合用户问题、\`周工作计划\`表分析
  - 所属团队（大模型团队/科学计算团队/具身智能团队/技术管理团队）均不会作为\`责任主体\`
\`\`\`

#### 3. 其他表（全年任务、人员名单等）
\`\`\`table-config
表名: "全年任务"、"人员名单"等
tableId: "动态获取"
查询规则: 
  - "调用 \`Get Teable Table List\` 工具获取tableId"
  - "根据获取的tableId执行查询"
\`\`\`

### 边界处理协议
1. **团队名称模糊**  
   - 输入"AI团队" → 返回："请明确：大模型团队 或 具身智能团队？"
   
2. **跨表查询**  
   - 触发条件：用户查询非预设表格  
   - 执行链：调用工具获取tableId→ 根据tableId调用工具查询表格→返回确认信息

### 输出规范
1. **每次响应必须包含**：  
   - **调用工具**查询/插入/删除/更新数据
   - 基于工具调用的数据结论，**禁止根据记忆、经验**  
   - 当询问某个团队或者总体情况的时候，请不要遗漏某个人的工作及任务
   - 每次查询类的输出请用可视化的形式（如**表格**、**流程图**）展示
   - 末尾推送前端链接：[访问多维表格系统](http://127.0.0.1:6008/invite?invitationId=invr8EgwhCqxqmnSzE6&invitationCode=a944f338fa1dfda5aa41915e49381afa802ab9572f57bca57bd958867925b60d)
   
2. **严格禁止**：  
   - 未调用工具生成任何数据结论  
   - 对任务条目提供个体化建议（仅允许总结性提示）
   - 禁止输出记录编号
   
3. **异常处理**：
  
   - 若调用工具失败/工具返回值为空，请检查过滤条件并继续重新尝试调用工具
   - 若仍失败，则返回："抱歉，请重新输入您的问题"
   - **禁止**胡编乱造输出结果
   
4. **数据操作前置检查**：
   - 插入/删除/更新数据时请先查询表格的相关字段
   
5. **综合查询建议**：
   - 用户要求总结工作情况/分工情况时请综合考虑**周工作计划**和**周会布置任务**`

  return {
    id: 'default',
    name: '智慧办公助手',
    emoji: '🤖',
    prompt: promptContent,
    topics: [getDefaultTopic('default')],
    messages: [],
    type: 'assistant' as const,
    model: {
      id: 'deepseek-ai/DeepSeek-V3',
      name: 'deepseek-ai/DeepSeek-V3',
      provider: 'silicon',
      group: 'deepseek-ai'
    },
    regularPhrases: [],
    mcpServers: [
      { 
        id: 'teable-server', 
        name: 'teable-server', 
        isActive: true, 
        type: 'streamableHttp' as const,
        description: 'Teable多维表格服务',
        baseUrl: 'http://127.0.0.1:6008/mcp-v3'
      },
      { 
        id: 'date-server', 
        name: 'date-server', 
        isActive: true, 
        type: 'streamableHttp' as const,
        description: '日期时间服务',
        baseUrl: 'http://127.0.0.1:6008/mcp-date'
      }
    ],
    settings: {
      temperature: 0,
      contextCount: 2,
      enableMaxTokens: false,
      maxTokens: 0,
      streamOutput: true,
      topP: 0,
      toolUseMode: 'function' as const,
      customParameters: []
    }
  }
}

export function getDefaultTranslateAssistant(targetLanguage: string, text: string): Assistant {
  const translateModel = getTranslateModel()
  const assistant: Assistant = getDefaultAssistant()
  assistant.model = translateModel

  assistant.settings = {
    temperature: 0.7
  }

  assistant.prompt = store
    .getState()
    .settings.translateModelPrompt.replaceAll('{{target_language}}', targetLanguage)
    .replaceAll('{{text}}', text)
  return assistant
}

export function getDefaultAssistantSettings() {
  return store.getState().assistants.defaultAssistant.settings
}

export function getDefaultTopic(assistantId: string): Topic {
  return {
    id: uuid(),
    assistantId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: i18n.t('chat.default.topic.name'),
    messages: [],
    isNameManuallyEdited: false
  }
}

export function getDefaultProvider() {
  return getProviderByModel(getDefaultModel())
}

export function getDefaultModel() {
  return store.getState().llm.defaultModel
}

export function getTopNamingModel() {
  return store.getState().llm.topicNamingModel
}

export function getTranslateModel() {
  return store.getState().llm.translateModel
}

export function getAssistantProvider(assistant: Assistant): Provider {
  const providers = store.getState().llm.providers
  const provider = providers.find((p) => p.id === assistant.model?.provider)
  return provider || getDefaultProvider()
}

export function getProviderByModel(model?: Model): Provider {
  const providers = store.getState().llm.providers
  const providerId = model ? model.provider : getDefaultProvider().id
  return providers.find((p) => p.id === providerId) as Provider
}

export function getProviderByModelId(modelId?: string) {
  const providers = store.getState().llm.providers
  const _modelId = modelId || getDefaultModel().id
  return providers.find((p) => p.models.find((m) => m.id === _modelId)) as Provider
}

export const getAssistantSettings = (assistant: Assistant): AssistantSettings => {
  const contextCount = assistant?.settings?.contextCount ?? DEFAULT_CONTEXTCOUNT
  const getAssistantMaxTokens = () => {
    if (assistant.settings?.enableMaxTokens) {
      const maxTokens = assistant.settings.maxTokens
      if (typeof maxTokens === 'number') {
        return maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS
      }
      return DEFAULT_MAX_TOKENS
    }
    return undefined
  }

  return {
    contextCount: contextCount === 100 ? 100000 : contextCount,
    temperature: assistant?.settings?.temperature ?? DEFAULT_TEMPERATURE,
    topP: assistant?.settings?.topP ?? 1,
    enableMaxTokens: assistant?.settings?.enableMaxTokens ?? false,
    maxTokens: getAssistantMaxTokens(),
    streamOutput: assistant?.settings?.streamOutput ?? true,
    toolUseMode: assistant?.settings?.toolUseMode ?? 'prompt',
    defaultModel: assistant?.defaultModel ?? undefined,
    customParameters: assistant?.settings?.customParameters ?? []
  }
}

export function getAssistantById(id: string) {
  const assistants = store.getState().assistants.assistants
  return assistants.find((a) => a.id === id)
}

export async function createAssistantFromAgent(agent: Agent) {
  const assistantId = uuid()
  const topic = getDefaultTopic(assistantId)

  const assistant: Assistant = {
    ...agent,
    id: assistantId,
    name: agent.name,
    emoji: agent.emoji,
    topics: [topic],
    model: agent.defaultModel,
    type: 'assistant',
    regularPhrases: agent.regularPhrases || [], // Ensured regularPhrases
    settings: agent.settings || {
      temperature: DEFAULT_TEMPERATURE,
      contextCount: DEFAULT_CONTEXTCOUNT,
      enableMaxTokens: false,
      maxTokens: 0,
      streamOutput: true,
      topP: 1,
      toolUseMode: 'prompt',
      customParameters: []
    }
  }

  store.dispatch(addAssistant(assistant))

  window.message.success({
    content: i18n.t('message.assistant.added.content'),
    key: 'assistant-added'
  })

  return assistant
}