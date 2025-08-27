# teable_mcp_server.py
import os
import sys
import argparse
from datetime import datetime, timedelta, timezone

import aiohttp
import json
import re
from typing import Optional, List, Dict, Any, Union
from fastmcp import FastMCP, Context
from fastmcp.exceptions import ResourceError
from fastmcp.server.dependencies import get_http_request

# --- 1. 初始化 FastMCP 服务器 ---
# 服务器名称和描述，便于客户端识别
mcp = FastMCP(
    name="Teable MCP Server",
    instructions="Access and interact with Teable databases via MCP. Configure with a Teable API token.",
    include_tags={"teable", "database"}
)

# --- 2. 全局变量存储令牌 ---
# 这个变量将在服务器启动时根据参数或环境变量设置
TEABLE_API_TOKEN: Optional[str] = None
DEFAULT_TEABLE_API_TOKEN = "teable_accSzFc1ISHD83YDwQk_ZlGb1FCHf1BF0gaxW9y3b58LHDNsYVH6G8EpbisWMHo="
TEABLE_BASE_URL = "http://localhost:3000/api"  # Teable API 基础URL
TEABLE_MCP_SERVER_PORT = 8091


# --- 3. 认证检查辅助函数 ---
def _get_teable_token(ctx: Context | None = None) -> str:
    """
    获取 Teable API 令牌。
    优先级：Context Header > 全局变量 > 环境变量 > 抛出错误
    """
    # 注意！
    # global TEABLE_API_TOKEN
    # global TEABLE_BASE_URL

    token = None
    # 尝试从请求上下文的 Header 获取 (如果在请求中)

    print("global TEABLE_API_TOKEN:", TEABLE_API_TOKEN)

    if ctx:
        try:
            # 获取 HTTP 请求对象
            http_request = get_http_request()
            # 从请求头中获取 Authorization
            auth_header = http_request.headers.get("Authorization")
            # 注意
            # print(auth_header)
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header[7:]  # 去掉 "Bearer " 前缀
            else:
                token = auth_header
                print(token)
        except RuntimeError:
            # 当不在请求上下文中时，get_http_request() 会抛出 RuntimeError
            pass

    # 如果上下文里没有，则使用全局/环境变量
    if not token:
        token = TEABLE_API_TOKEN or os.getenv("TEABLE_API_TOKEN")
        # 注意
        print("未传递变量，已赋值：" + token)

    if not token:
        print("赋值失败：" + token)
        error_msg = "Teable API token is required but not provided. Please configure it via startup arguments or TEABLE_API_TOKEN environment variable."
        if ctx:
            ctx.error(error_msg)
        raise ResourceError(error_msg)

    return token


# --- 4. 获取Teable表列表 ---
@mcp.tool(
    name="Get Teable Table List",
    description="Retrieve all tables in Teable organized in a tree structure (space->base->table).",
    tags={"teable", "tables", "tree", "structure"}
)
async def get_table_list(ctx: Context | None = None) -> Dict[str, Any]:
    """
    获取 Teable 中所有表格的树状结构（空间->基础->表格）

    Returns:
        包含完整空间-基础-表格结构的字典
    """
    if ctx:
        ctx.info("Requesting Teable table tree structure")

    # --- 获取并验证令牌 ---
    try:
        token = _get_teable_token(ctx)
        if ctx:
            ctx.debug(f"Using Teable token (first 5 chars): {token[:5] if token else 'None'}...")
    except ResourceError:
        raise

    # --- 获取所有空间 ---
    spaces = []
    try:
        if ctx:
            ctx.info("Fetching spaces...")
        spaces_url = f"{TEABLE_BASE_URL}/space"
        headers = {"Authorization": f"Bearer {token}"}
        async with aiohttp.ClientSession() as session:
            async with session.get(spaces_url, headers=headers) as resp:
                if resp.status == 200:
                    spaces = await resp.json()
                    if ctx:
                        ctx.info(f"Retrieved {len(spaces)} spaces")
                else:
                    error_text = await resp.text()
                    error_msg = f"Error fetching spaces: {resp.status} - {error_text}"
                    if ctx:
                        ctx.error(error_msg)
                    raise ResourceError(error_msg)
    except Exception as e:
        if ctx:
            ctx.error(f"Error in space retrieval: {str(e)}")
        raise ResourceError(f"Space retrieval failed: {str(e)}")

    # --- 为每个空间获取基础 ---
    result = {"spaces": []}
    for space in spaces:
        spname = space.get("name")
        if spname != "NWAIC工作管理空间":
            continue
        space_id = space["id"]
        space_entry = {
            "id": space_id,
            "name": space.get("name"),
            "role": space.get("role"),
            "bases": []
        }

        try:
            if ctx:
                ctx.info(f"Fetching bases for space {space_id}...")
            bases_url = f"{TEABLE_BASE_URL}/space/{space_id}/base"
            async with aiohttp.ClientSession() as session:
                async with session.get(bases_url, headers=headers) as resp:
                    if resp.status == 200:
                        bases = await resp.json()
                        if ctx:
                            ctx.info(f"Retrieved {len(bases)} bases for space {space_id}")
                    else:
                        error_text = await resp.text()
                        error_msg = f"Error fetching bases for space {space_id}: {resp.status} - {error_text}"
                        if ctx:
                            ctx.error(error_msg)
                        # 即使某个空间失败也继续处理其他空间
                        bases = []
                        space_entry["bases_error"] = error_msg
        except Exception as e:
            if ctx:
                ctx.error(f"Error retrieving bases for space {space_id}: {str(e)}")
            bases = []
            space_entry["bases_error"] = str(e)

        # --- 为每个基础获取表格 ---
        for base in bases:
            base_id = base["id"]
            base_entry = {
                "id": base_id,
                "name": base.get("name"),
                "spaceId": base.get("spaceId"),
                "tables": []
            }

            try:
                if ctx:
                    ctx.info(f"Fetching tables for base {base_id}...")
                tables_url = f"{TEABLE_BASE_URL}/base/{base_id}/table"
                async with aiohttp.ClientSession() as session:
                    async with session.get(tables_url, headers=headers) as resp:
                        if resp.status == 200:
                            tables = await resp.json()
                            if ctx:
                                ctx.info(f"Retrieved {len(tables)} tables for base {base_id}")
                            base_entry["tables"] = tables
                        else:
                            error_text = await resp.text()
                            error_msg = f"Error fetching tables for base {base_id}: {resp.status} - {error_text}"
                            if ctx:
                                ctx.error(error_msg)
                            base_entry["tables_error"] = error_msg
            except Exception as e:
                if ctx:
                    ctx.error(f"Error retrieving tables for base {base_id}: {str(e)}")
                base_entry["tables_error"] = str(e)

            space_entry["bases"].append(base_entry)

        result["spaces"].append(space_entry)

    if ctx:
        ctx.info("Successfully generated table tree structure")
    return result


# --- 5. 新增工具：列出记录 ---

# --- 新增工具：TQL转Filter格式 ---




def convert_string_to_number(s):
    """
    将字符串转换为数字（整数或浮点数）
    可以处理带单引号的数字字符串，如"'8'"或"'3.14'"

    参数:
    s (str): 要转换的字符串

    返回:
    int 或 float: 转换后的数字

    抛出:
    ValueError: 如果字符串不是有效的数字格式
    """
    # 检查是否被单引号包围
    if len(s) >= 2 and s.startswith("'") and s.endswith("'"):
        inner = s[1:-1]
        # 验证内部内容是否为有效数字
        if not re.fullmatch(r'-?\d+(?:\.\d+)?', inner):
            raise ValueError(f"Invalid number string: {s}")

        # 根据是否有小数点决定转换类型
        return float(inner) if '.' in inner else int(inner)
    else:
        # 如果不是被单引号包围，直接转换
        if not re.fullmatch(r'-?\d+(?:\.\d+)?', s):
            raise ValueError(f"Invalid number string: {s}")

        # 根据是否有小数点决定转换类型
        return float(s) if '.' in s else int(s)


import re
from datetime import datetime, timedelta

def tql_to_teable_filter(sql_query):
    if sql_query is None or sql_query.strip() == "":
        return None

    # 预处理：移除多余空格
    sql_query = re.sub(r'\s+', ' ', sql_query.strip())

    # 主解析函数
    def parse_expression(tokens):
        return parse_logical_expression(tokens)

    def parse_logical_expression(tokens):
        left_expr = parse_primary_expression(tokens)

        while tokens and tokens[0].upper() in ['AND', 'OR']:
            op = tokens.pop(0).upper()
            right_expr = parse_primary_expression(tokens)

            # 如果左右都是逻辑表达式且操作符相同，可以合并
            if (isinstance(left_expr, dict) and isinstance(right_expr, dict) and
                    left_expr.get('conjunction') == op.lower() and right_expr.get('conjunction') == op.lower()):
                left_expr['filterSet'].extend(right_expr['filterSet'])
            else:
                left_expr = {
                    "conjunction": op.lower(),
                    "filterSet": [left_expr, right_expr]
                }

        return left_expr

    def parse_primary_expression(tokens):
        if not tokens:
            return None

        if tokens[0] == '(':
            tokens.pop(0)  # 移除 '('
            expr = parse_expression(tokens)
            if tokens and tokens[0] == ')':
                tokens.pop(0)  # 移除 ')'
            return expr
        else:
            return parse_condition(tokens)

    def parse_condition(tokens):
        if not tokens:
            return None

        # 提取字段名（在花括号中）
        field_match = re.match(r'^{([^}]*)}$', tokens[0])
        if not field_match:
            # 尝试处理可能没有花括号的字段名
            field_id = tokens.pop(0)
        else:
            field_id = field_match.group(1)
            tokens.pop(0)

        # 提取操作符
        if not tokens:
            raise ValueError("Unexpected end of input after field name")

        operator = tokens.pop(0).lower()

        # 处理特殊操作符
        if operator == 'not':
            if tokens and tokens[0].lower() == 'in':
                tokens.pop(0)
                operator = 'not in'
            elif tokens and tokens[0].lower() == 'like':
                tokens.pop(0)
                operator = 'not like'

        # 提取值
        if not tokens:
            raise ValueError("Unexpected end of input after operator")

        value_str = tokens.pop(0)

        # 处理IN操作符的特殊情况（支持方括号和圆括号）
        if operator in ['in', 'not in', 'isanyof'] and value_str in ['(', '[']:
            # 确定结束符号
            end_char = ')' if value_str == '(' else ']'
            # 收集所有值直到遇到结束符号
            values = []
            while tokens and tokens[0] != end_char:
                value = tokens.pop(0)
                if value != ',':
                    values.append(value)
            if tokens and tokens[0] == end_char:
                tokens.pop(0)  # 移除结束符号
            else:
                raise ValueError(f"Missing closing bracket {end_char} for IN expression")

            # 根据not与否控制连接符
            conjunc = "and" if operator == 'not in' else "or"
            # 创建OR/AND组
            or_group = {
                "conjunction": conjunc,
                "filterSet": []
            }

            for val in values:
                # 清理值：去除引号并处理可能的多余字符
                clean_val = val.strip("'\"")
                # 控制操作符
                op = 'isNot' if operator == 'not in' else 'is'
                or_group['filterSet'].append({
                    "fieldId": field_id,
                    "operator": op,
                    "value": clean_val
                })

            if operator == 'not in':
                or_group['filterSet'].append({
                    "fieldId": field_id,
                    "operator": "isNotEmpty",
                    "value": None
                })

            return or_group

        # 处理普通条件
        # 清理值
        if value_str.startswith("'") and value_str.endswith("'"):
            value = value_str[1:-1]
        elif value_str.startswith('"') and value_str.endswith('"'):
            value = value_str[1:-1]
        else:
            value = value_str

        # 处理NULL值
        if value.upper() == 'NULL':
            if operator == '=':
                return {
                    "fieldId": field_id,
                    "operator": "isEmpty",
                    "value": None
                }
            elif operator == '!=':
                return {
                    "fieldId": field_id,
                    "operator": "isNotEmpty",
                    "value": None
                }

        # 处理LIKE操作符
        if operator == 'like':
            return {
                "fieldId": field_id,
                "operator": "contains",
                "value": value.strip('%')
            }
        elif operator == 'not like':
            return {
                "fieldId": field_id,
                "operator": "doesNotContain",
                "value": value.strip('%')
            }

        # 处理比较操作符
        op_mapping = {
            '=': "is",
            '!=': "isNot",
            '>': "isGreater",
            '>=': "isGreaterEqual",
            '<': "isLess",
            '<=': "isLessEqual"
        }

        teable_operator = op_mapping.get(operator, "is")

        # 尝试解析日期
        date_formats = [
            '%Y-%m-%d %H:%M:%S',
            '%Y-%m-%d %H:%M',
            '%Y-%m-%dT%H:%M:%S',
            '%Y-%m-%dT%H:%M',
            '%Y-%m-%d'
        ]

        parsed_date = None
        for fmt in date_formats:
            try:
                parsed_date = datetime.strptime(value, fmt)
                break
            except ValueError:
                continue

        if parsed_date:
            utc_date = parsed_date - timedelta(hours=8)
            formatted_date = utc_date.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

            date_op_mapping = {
                '=': "is",
                '!=': "isNot",
                '>': "isAfter",
                '>=': "isOnOrAfter",
                '<': "isBefore",
                '<=': "isOnOrBefore"
            }

            teable_operator = date_op_mapping.get(operator, "is")

            return {
                "fieldId": field_id,
                "operator": teable_operator,
                "value": {
                    "mode": "exactDate",
                    "exactDate": formatted_date,
                    "timeZone": "Asia/Shanghai"
                }
            }

        # 处理布尔值
        if value.upper() in ['TRUE', 'FALSE']:
            return {
                "fieldId": field_id,
                "operator": "is" if operator == '=' else "isNot",
                "value": value.upper() == 'TRUE'
            }

        # 处理数字值
        try:
            num_value = float(value) if '.' in value else int(value)
            return {
                "fieldId": field_id,
                "operator": teable_operator,
                "value": str(num_value)
            }
        except ValueError:
            # 普通字符串值
            return {
                "fieldId": field_id,
                "operator": teable_operator,
                "value": value
            }

    # 分词器
    def tokenize(query):
        # 使用正则表达式分割字符串，保留引号内的内容
        tokens = []
        current_token = ""
        in_quotes = False
        quote_char = None

        for char in query:
            if char in ['"', "'"] and not in_quotes:
                in_quotes = True
                quote_char = char
                current_token += char
            elif char == quote_char and in_quotes:
                in_quotes = False
                current_token += char
                tokens.append(current_token)
                current_token = ""
            elif in_quotes:
                current_token += char
            elif char in ['(', ')', '[', ']', ',']:
                if current_token:
                    tokens.append(current_token)
                    current_token = ""
                tokens.append(char)
            elif char.isspace():
                if current_token:
                    tokens.append(current_token)
                    current_token = ""
            else:
                current_token += char

        if current_token:
            tokens.append(current_token)

        # 检查引号是否匹配
        if in_quotes:
            raise ValueError("Unclosed quotes in input")

        # 合并比较操作符 (如 '=', '!=', '>', '>=', '<', '<=')
        i = 0
        while i < len(tokens) - 1:
            if (tokens[i] in ['!', '>', '<'] and tokens[i + 1] == '=') or \
                    (tokens[i] == '!' and tokens[i + 1] == '='):
                tokens[i] = tokens[i] + tokens[i + 1]
                del tokens[i + 1]
            else:
                i += 1

        return tokens

    # 执行解析
    try:
        tokens = tokenize(sql_query)
        result = parse_expression(tokens)

        # 确保结果是正确的格式
        if not isinstance(result, dict) or 'conjunction' not in result:
            result = {
                "conjunction": "and",
                "filterSet": [result] if result else []
            }

        return result
    except Exception as e:
        raise ValueError(f"Failed to parse SQL query: {str(e)}")


@mcp.tool(
    name="List Teable Records",
    description="Retrieve a list of records from a Teable table with optional filtering (using TQL), sorting, and pagination. Essential tool for querying work records and task schedules.",
    tags={"teable", "records", "list", "query", "filter"}
)
async def list_records(
        tableId: str,
        projection: Optional[List[str]] = None,
        cellFormat: str = "json",
        fieldKeyType: str = "name",
        viewId: Optional[str] = None,
        filterByTql: Optional[str] = None,
        take: Optional[int] = None,
        skip: Optional[int] = None,
        ctx: Context | None = None
) -> Dict[str, Any]:
    """
    根据 tableId 列出记录，并支持过滤、排序、分组和分页等选项。
    
    【重要约束】：
    1、`filterByTql`中，
    * Tql不可使用`group_by`和`order_by`等函数，仅支持`is`、`>=`、`like`、`!=`、`in`等简单比较符
    * 在Tql中，`OR`和`and`仅能使用其中一种，不可同时使用
    * Tql中仅支持'='、`>=`、`like`、`!=`、`<=`、`>`、'<'等简单比较符，不可使用"()"
    2、查询所用的`{字段名}`可以使用用户显示配置的字段（在`fields`字段中）
    3、Teable为每段记录配置的标记字段（如id、autoNumber等）在`filterByTql`中不可用

    【常用场景示例】：
    
    1. 查询特定用户的周工作计划：
       tableId="tblBq27RjBeLbElA7VM"
       filterByTql="{姓名} like '%张三%' AND {所属周数} = '13'"
       
    2. 查询特定用户的任务安排：
       tableId="tblgTQaA7O7cv7sfYnO"
       filterByTql="{责任主体} like '%张三%' AND {时间节点} >= '2025-07-01'"
       
    3. 查询团队成员列表：
       tableId="团队人员名单表ID"
       filterByTql="{所属团队} like '%大模型团队%'"
       
    4. 查询进行中的任务：
       tableId="tblgTQaA7O7cv7sfYnO"
       filterByTql="{状态} = '进行中'"
       
    5. 查询特定日期范围的任务：
       tableId="tblgTQaA7O7cv7sfYnO"
       filterByTql="{时间节点} >= '2025-07-01' AND {时间节点} <= '2025-07-31'"

    【TQL语法示例】：
    - 模糊匹配：{姓名} like '%张三%'
    - 精确匹配：{状态} = '已完成'
    - 日期范围：{时间节点} >= '2025-07-01' AND {时间节点} <= '2025-07-31'
    - 数字比较：{所属周数} = '13'
    - 包含查询：{责任主体} in ['张三', '李四', '王五']

    Args:
        tableId: Teable 表格 ID，常用的有：
                - "tblBq27RjBeLbElA7VM" (周工作计划表)
                - "tblgTQaA7O7cv7sfYnO" (周会布置任务表)
        projection: 可选，指定要返回的字段名或ID列表
        cellFormat: 可选，返回值格式 ('json' 或 'text')，默认 'json'
        fieldKeyType: 可选，record.fields[key] 的键类型 ('id', 'name', 'dbFieldName')，默认 'name'
        viewId: 可选，指定视图ID，结果将根据视图选项进行过滤和排序
        filterByTql: 可选，用于过滤结果的TQL表达式，必须遵守上述语法约束
        take: 可选，要获取的记录数量，最大2000
        skip: 可选，要跳过的记录数量

    Returns:
        记录列表和可选的分组信息，包含查询到的数据记录
    """
    # 格式转换
    filter_input = tql_to_teable_filter(filterByTql)
    filter_input_json = json.dumps(filter_input, indent=2, ensure_ascii=False)
    if ctx:
        ctx.info(f"Requested list of records from table {tableId}")
    # --- 获取并验证令牌 ---
    try:
        token = _get_teable_token(ctx)
        if ctx:
            ctx.debug(f"Using Teable token (first 5 chars): {token[:5] if token else 'None'}...")
    except ResourceError:
        raise

    # --- 构建查询参数 ---
    params = {}
    if projection is not None:
        # 这将生成 projection[]=A&projection[]=B 格式的URL参数
        params["projection[]"] = projection
    if cellFormat:
        params["cellFormat"] = cellFormat
    if fieldKeyType:
        params["fieldKeyType"] = fieldKeyType
    if viewId:
        params["viewId"] = viewId
    if filter_input_json is not None:  # 使用 filter
        params["filter"] = filter_input_json
    if take is not None:
        params["take"] = take
    if skip is not None:
        params["skip"] = skip

    # --- 实际 Teable API 调用 ---
    url = f"{TEABLE_BASE_URL}/table/{tableId}/record"
    headers = {"Authorization": f"Bearer {token}"}

    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=headers, params=params) as resp:
            response_text = await resp.text()  # 先读取响应体
            if resp.status == 200:
                try:
                    # 尝试解析 JSON
                    data = json.loads(response_text)
                    if ctx:
                        ctx.info(f"Retrieved records list from table {tableId}")

                    # 如果存在 structuredContent 则只返回该部分，否则返回所有内容
                    if data and "response" in data and "structuredContent" in data["response"]:
                        return data["response"]["structuredContent"]
                    else:
                        # structuredContent 不存在，返回所有内容
                        return data

                except json.JSONDecodeError:
                    # 如果不是 JSON，返回原始文本或抛出错误
                    error_msg = f"Teable API returned non-JSON response for list_records: {response_text[:100]}..."
                    if ctx:
                        ctx.error(error_msg)
                    raise ResourceError(error_msg)
            else:
                error_msg = f"Teable API error when listing records from table {tableId}: {resp.status} - {response_text}"
                if ctx:
                    ctx.error(error_msg)
                raise ResourceError(error_msg)


# --- 9. 新增工具：创建记录 ---
@mcp.tool(
    name="Create Teable Records",
    description="Create/Insert one or more records in a Teable table with simplified input format. Essential for adding new work plans, tasks, or other data entries.",
    tags={"teable", "records", "create", "insert", "add"}
)
async def create_records(
        tableId: str,
        records: Union[Dict[str, Any], List[Dict[str, Any]]],  # 支持单个记录或记录列表
        fieldKeyType: str = "name",
        typecast: bool = True,
        order: Optional[Dict[str, Any]] = None,
        ctx: Context | None = None
) -> List[Dict[str, Any]]:
    """
    在指定的 Teable 表格中创建一个或多个记录，接受简化的输入格式。
    
    【重要约束】：
    - records中的字段名必须在表格中存在，否则无法正确地插入记录
    - 字段名必须与表格中的字段名完全匹配（区分大小写）
    - 必填字段必须提供值，否则创建失败

    【常用场景示例】：
    
    1. 添加周工作计划记录：
       tableId="tblBq27RjBeLbElA7VM"
       records={
           "姓名": "张三",
           "所属团队": "大模型团队", 
           "所属周数": "13",
           "本周工作完成情况": "完成了模型训练任务",
           "下周工作计划": "开始模型评估工作",
           "需协调问题": "需要更多计算资源"
       }
       
    2. 添加新任务：
       tableId="tblgTQaA7O7cv7sfYnO"
       records={
           "责任主体": "张三",
           "时间节点": "2025-12-20",
           "任务内容": "完成模型优化",
           "状态": "进行中"
       }
       
    3. 批量添加多个记录：
       tableId="tblBq27RjBeLbElA7VM"
       records=[
           {
               "姓名": "张三",
               "所属团队": "大模型团队",
               "所属周数": "13",
               "本周工作完成情况": "任务A完成"
           },
           {
               "姓名": "李四", 
               "所属团队": "科学计算团队",
               "所属周数": "13",
               "本周工作完成情况": "任务B完成"
           }
       ]
       
    4. 添加团队成员信息：
       tableId="人员名单表ID"
       records={
           "姓名": "王五",
           "所属团队": "具身智能团队",
           "职位": "算法工程师",
           "入职时间": "2025-01-15"
       }

    【字段格式说明】：
    - 文本字段：直接提供字符串值
    - 日期字段：使用 "YYYY-MM-DD" 格式，如 "2025-12-20"
    - 选择字段：使用选项的确切文本，如 "进行中"、"已完成"、"已延期"
    - 数字字段：可以是字符串格式的数字，如 "13"
    - 多选字段：使用数组格式，如 ["选项1", "选项2"]

    Args:
        tableId: Teable 表格 ID，常用的有：
                - "tblBq27RjBeLbElA7VM" (周工作计划表)
                - "tblgTQaA7O7cv7sfYnO" (周会布置任务表)
        records: 要创建的记录，可以是:
                 - 单个记录: {"字段名": "值", ...}
                 - 记录列表: [{"字段名": "值", ...}, ...]
        fieldKeyType: 可选，record.fields[key] 的键类型 ('id', 'name', 'dbFieldName')，默认 'name'
        typecast: 可选，是否自动转换字段值类型，默认 True
        order: 可选，指定记录在视图中的位置

    Returns:
        创建成功的记录列表，包含新创建记录的详细信息
    """
    if ctx:
        ctx.info(f"Requested to create records in table {tableId}")

    # --- 获取并验证令牌 ---
    try:
        token = _get_teable_token(ctx)
        if ctx:
            ctx.debug(f"Using Teable token (first 5 chars): {token[:5] if token else 'None'}...")
    except ResourceError:
        raise

    # --- 简化输入处理 ---
    # 如果 records 是单个记录(不是列表)，将其转换为列表
    if not isinstance(records, list):
        records = [records]

    # 检查是否已经是 Teable API 所需的格式
    # 如果 records 中的元素不包含 "fields" 键，则转换为所需格式
    if records and not all("fields" in record for record in records):
        # 转换为 Teable API 所需的格式
        records = [{"fields": record} for record in records]

    # --- 准备请求体 ---
    payload = {
        "records": records,
        "fieldKeyType": fieldKeyType,
        "typecast": typecast
    }

    # 如果提供了order参数，则添加到payload
    if order is not None:
        payload["order"] = order

    # --- 实际 Teable API 调用 ---
    url = f"{TEABLE_BASE_URL}/table/{tableId}/record"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(url, headers=headers, json=payload) as resp:
            response_text = await resp.text()
            if resp.status in (200, 201):
                try:
                    data = json.loads(response_text)
                    if ctx:
                        ctx.info(f"Created {len(data)} records in table {tableId}")
                    # return data
                    # 注意！
                    return records
                except json.JSONDecodeError:
                    error_msg = f"Teable API returned non-JSON response for create_records: {response_text[:100]}..."
                    if ctx:
                        ctx.error(error_msg)
                    raise ResourceError(error_msg)
            else:
                error_msg = f"Teable API error when creating records in table {tableId}: {resp.status} - {response_text}"
                if ctx:
                    ctx.error(error_msg)
                raise ResourceError(error_msg)


# --- 11. 修改工具：删除记录---
@mcp.tool(
    name="Delete Teable Records",
    description="Permanently delete one or multiple records by their IDs in a single request. Use with caution as this operation is irreversible.",
    tags={"teable", "records", "delete", "remove", "cleanup"}
)
async def delete_records(
        tableId: str,
        recordIds: List[str],  # 要删除的记录ID列表
        ctx: Context | None = None
) -> str:
    """
    在单个请求中，根据记录 ID 列表永久删除 Teable 表格中的一个或多个记录。
    
    【重要警告】：
    - 此操作不可逆，删除的记录无法恢复
    - 删除前请确认记录ID的准确性
    - 建议在删除前先使用 List Teable Records 确认要删除的记录
    
    【使用流程】：
    1. 首先使用 List Teable Records 查询并获取要删除记录的ID
    2. 从返回结果中提取记录的 "id" 字段值
    3. 使用这些ID调用本函数进行删除

    【常用场景示例】：
    
    1. 删除单个过期任务：
       - 先查询：List Teable Records(tableId="tblgTQaA7O7cv7sfYnO", filterByTql="{状态} = '已完成' AND {时间节点} < '2025-01-01'")
       - 获取记录ID，如 "recXXXXXXX"
       - 删除：Delete Teable Records(tableId="tblgTQaA7O7cv7sfYnO", recordIds=["recXXXXXXX"])
       
    2. 批量删除多个记录：
       - 先查询获取多个记录ID
       - 删除：Delete Teable Records(tableId="tableId", recordIds=["recXXX1", "recXXX2", "recXXX3"])
       
    3. 删除错误创建的工作计划：
       - 查询：List Teable Records(tableId="tblBq27RjBeLbElA7VM", filterByTql="{姓名} like '%错误数据%'")
       - 删除：Delete Teable Records(tableId="tblBq27RjBeLbElA7VM", recordIds=["获取到的记录ID"])

    【记录ID获取方法】：
    - 通过 List Teable Records 查询获取
    - 记录ID通常格式为 "rec" + 字母数字组合，如 "recXXXXXXXXXXX"
    - 记录ID在查询结果的每条记录的 "id" 字段中

    【注意事项】：
    - 每次请求最多删除100条记录
    - 确保提供的记录ID存在于指定的表格中
    - 如果某个记录ID不存在，整个删除操作可能失败
    - 删除关联记录时要谨慎，可能影响其他表格的数据完整性

    Args:
        tableId: Teable 表格 ID，常用的有：
                - "tblBq27RjBeLbElA7VM" (周工作计划表)
                - "tblgTQaA7O7cv7sfYnO" (周会布置任务表)
        recordIds: 要删除的记录 ID 列表，支持单个或多个记录
                  格式示例：["recXXXXXXX"] 或 ["recXXX1", "recXXX2", "recXXX3"]

    Returns:
        成功删除的确认消息
    """
    if ctx:
        ctx.info(f"Requested to delete records {recordIds} from table {tableId}")

    # --- 获取并验证令牌 ---
    try:
        token = _get_teable_token(ctx)
        if ctx:
            ctx.debug(f"Using Teable token (first 5 chars): {token[:5] if token else 'None'}...")
    except ResourceError:
        raise

    # --- 准备查询参数 ---
    params = {
        "recordIds[]": recordIds  # 支持单个或多个记录
    }

    # --- 实际 Teable API 调用 ---
    url = f"{TEABLE_BASE_URL}/table/{tableId}/record"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    async with aiohttp.ClientSession() as session:
        async with session.delete(url, headers=headers, params=params) as resp:
            response_text = await resp.text()
            content_type = resp.content_type or ""
            if resp.status == 200:
                if "application/json" in content_type:
                    try:
                        data = json.loads(response_text)
                        if ctx:
                            ctx.info(f"Deleted records {recordIds} from table {tableId}")
                        return data.get("message", "Records deleted successfully.")
                    except json.JSONDecodeError:
                        pass

                success_msg = response_text if response_text else "Records deleted successfully."
                if ctx:
                    ctx.info(f"Deleted records {recordIds} from table {tableId}")
                return success_msg
            else:
                error_msg = f"Teable API error when deleting records from table {tableId}: {resp.status} - {response_text}"
                if ctx:
                    ctx.error(error_msg)
                raise ResourceError(error_msg)


# --- 12. 新增工具：更新多个记录 ---
@mcp.tool(
    name="Update Teable Records",
    description="Update multiple records in a single request. Essential for modifying existing work plans, task status, or other data entries.",
    tags={"teable", "records", "update", "modify", "edit"}
)
async def update_records(
        tableId: str,
        records: List[Dict[str, Any]],  # 包含 'id' 和要更新的 'fields'
        fieldKeyType: str = "name",
        typecast: bool = False,
        ctx: Context | None = None
) -> List[Dict[str, Any]]:
    """
    在单个请求中更新 Teable 表格中的多个记录。
    
    【重要约束】：
    - 每个记录必须包含有效的记录ID ('id')
    - 只能更新存在的字段，字段名必须完全匹配
    - 更新前建议先查询确认记录存在
    
    【使用流程】：
    1. 使用 List Teable Records 查询获取要更新的记录ID
    2. 准备更新数据，包含记录ID和要更新的字段
    3. 调用本函数执行更新操作

    【常用场景示例】：
    
    1. 更新任务状态：
       tableId="tblgTQaA7O7cv7sfYnO"
       records=[{
           "id": "recXXXXXXX",
           "fields": {
               "状态": "已完成"
           }
       }]
       
    2. 更新工作计划内容：
       tableId="tblBq27RjBeLbElA7VM"
       records=[{
           "id": "recYYYYYYY",
           "fields": {
               "本周工作完成情况": "模型训练完成，准确率达到95%",
               "下周工作计划": "开始模型部署和测试工作",
               "需协调问题": "无"
           }
       }]
       
    3. 批量更新多个任务：
       tableId="tblgTQaA7O7cv7sfYnO"
       records=[
           {
               "id": "recAAA111",
               "fields": {"状态": "已完成"}
           },
           {
               "id": "recBBB222", 
               "fields": {"状态": "已延期", "时间节点": "2025-12-25"}
           },
           {
               "id": "recCCC333",
               "fields": {"任务内容": "更新后的任务描述"}
           }
       ]
       
    4. 更新人员信息：
       tableId="人员名单表ID"
       records=[{
           "id": "recPERSON1",
           "fields": {
               "职位": "高级算法工程师",
               "所属团队": "大模型团队"
           }
       }]

    【数据格式要求】：
    - records 必须是列表格式，即使只更新一条记录
    - 每个记录对象必须包含 "id" 和 "fields" 两个键
    - "id" 值必须是有效的记录ID（格式：recXXXXXXX）
    - "fields" 包含要更新的字段和对应的新值
    
    【字段更新规则】：
    - 只更新 "fields" 中指定的字段，其他字段保持不变
    - 日期字段：使用 "YYYY-MM-DD" 格式
    - 选择字段：使用选项的确切文本
    - 文本字段：直接提供字符串值
    - 数字字段：可以是字符串格式的数字

    【获取记录ID方法】：
    - 使用 List Teable Records 查询：
      List Teable Records(tableId="目标表ID", filterByTql="{字段} = '查询条件'")
    - 从返回结果中提取每条记录的 "id" 字段值

    Args:
        tableId: Teable 表格 ID，常用的有：
                - "tblBq27RjBeLbElA7VM" (周工作计划表)
                - "tblgTQaA7O7cv7sfYnO" (周会布置任务表)
        records: 要更新的记录列表，每个记录必须包含 'id' 键和 'fields' 键
                格式：[{"id": "recXXXXXXX", "fields": {"字段名": "新值"}}]
        fieldKeyType: 可选，record.fields[key] 的键类型 ('id', 'name', 'dbFieldName')，默认 'name'
        typecast: 可选，是否自动转换字段值类型，默认 False

    Returns:
        更新后的记录数据列表，包含更新成功的记录详细信息
    """
    if ctx:
        ctx.info(f"Requested to update records in table {tableId}")

    # --- 获取并验证令牌 ---
    try:
        token = _get_teable_token(ctx)
        if ctx:
            ctx.debug(f"Using Teable token (first 5 chars): {token[:5] if token else 'None'}...")
    except ResourceError:
        raise

    # --- 准备请求体 ---
    # 根据 API 文档 (Update multiple records)，请求体应该是包含 records 数组的对象
    payload = {
        "records": records,
        "fieldKeyType": fieldKeyType,
        "typecast": typecast
    }

    # --- 实际 Teable API 调用 ---
    # 注意：API 文档路径是 /table/{tableId}/record，方法是 PATCH
    url = f"{TEABLE_BASE_URL}/table/{tableId}/record"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"  # 发送 JSON 数据需要设置 Content-Type
    }

    async with aiohttp.ClientSession() as session:
        # 使用 PATCH 方法更新记录
        async with session.patch(url, headers=headers, json=payload) as resp:
            response_text = await resp.text()
            if resp.status == 200:
                try:
                    data = json.loads(response_text)
                    if ctx:
                        ctx.info(f"Updated records in table {tableId}")
                    return data
                except json.JSONDecodeError:
                    error_msg = f"Teable API returned non-JSON response for update_records: {response_text[:100]}..."
                    if ctx:
                        ctx.error(error_msg)
                    raise ResourceError(error_msg)
            else:
                error_msg = f"Teable API error when updating records in table {tableId}: {resp.status} - {response_text}"
                if ctx:
                    ctx.error(error_msg)
                raise ResourceError(error_msg)


# --- 13. 新增工具：获取空间邀请链接 ---
@mcp.tool(
    name="Get Teable Space Invitation Links",
    description="Retrieve a list of invitation links for a specific Teable space.",
    tags={"teable", "spaces", "invitations"}
)
async def get_space_invitation_links(
        spaceId: str,
        ctx: Context | None = None
) -> List[Dict[str, Any]]:
    """
    根据 spaceId 获取 Teable 空间中的所有邀请链接列表。

    Args:
        spaceId: Teable 空间 ID

    Returns:
        邀请链接信息列表
    """
    if ctx:
        ctx.info(f"Requested invitation links for space {spaceId}")

    # --- 获取并验证令牌 ---
    try:
        token = _get_teable_token(ctx)
        if ctx:
            ctx.debug(f"Using Teable token (first 5 chars): {token[:5] if token else 'None'}...")
    except ResourceError:
        raise

    # --- 实际 Teable API 调用 ---
    url = f"{TEABLE_BASE_URL}/space/{spaceId}/invitation/link"
    headers = {"Authorization": f"Bearer {token}"}
    print(url)

    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=headers) as resp:
            response_text = await resp.text()
            if resp.status == 200:
                try:
                    data = json.loads(response_text)
                    if ctx:
                        ctx.info(f"Retrieved {len(data)} invitation links for space {spaceId}")
                    return data
                except json.JSONDecodeError:
                    error_msg = f"Teable API returned non-JSON response for get_space_invitation_links: {response_text[:100]}..."
                    if ctx:
                        ctx.error(error_msg)
                    raise ResourceError(error_msg)
            else:
                error_msg = f"Teable API error when fetching invitation links for space {spaceId}: {resp.status} - {response_text}"
                if ctx:
                    ctx.error(error_msg)
                raise ResourceError(error_msg)


# --- 服务器启动逻辑 ---
def server_init():
    """主函数，处理命令行参数并启动服务器"""
    global TEABLE_API_TOKEN
    global TEABLE_MCP_SERVER_PORT

    parser = argparse.ArgumentParser(description="Teable MCP Server")
    parser.add_argument(
        "--token",
        type=str,
        help="Teable API Bearer Token. If not provided, TEABLE_API_TOKEN environment variable is used."
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",  # 默认仅本地访问
        help="Host to bind the server to (default: 127.0.0.1)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=TEABLE_MCP_SERVER_PORT,  # 默认端口
        help="Port to bind the server to (default: 8000)"
    )
    parser.add_argument(
        "--path",
        type=str,
        default="/mcp",  # 默认路径
        help="Base path for the MCP endpoint (default: /mcp)"
    )

    args = parser.parse_args()

    # 设置全局令牌
    TEABLE_API_TOKEN = args.token

    if not TEABLE_API_TOKEN:
        # 获取环境变量
        TEABLE_API_TOKEN = os.getenv("TEABLE_API_TOKEN")

    if not TEABLE_API_TOKEN:
        # 默认值
        TEABLE_API_TOKEN = DEFAULT_TEABLE_API_TOKEN

    if not TEABLE_API_TOKEN:
        print("Warning: No Teable API token provided via --token or TEABLE_API_TOKEN environment variable.",
              file=sys.stderr)
        print("The server will start, but operations requiring the token will fail.", file=sys.stderr)
    else:
        print(f"Teable API token configured (first 5 chars): {TEABLE_API_TOKEN[:5]}...")

    print(f"Starting Teable MCP server on http://{args.host}:{args.port}{args.path}")

    # 使用 HTTP 协议运行服务器
    mcp.run(
        transport="http",
        host=args.host,
        port=args.port,
        path=args.path
    )


if __name__ == "__main__":

    # print(json.dumps(filter_json, indent=2, ensure_ascii=False))
    server_init()
