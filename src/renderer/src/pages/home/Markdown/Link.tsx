import { ExpandOutlined, EyeOutlined, LinkOutlined } from '@ant-design/icons'
import { AppLogo } from '@renderer/config/env'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { WebviewTag } from 'electron'
import { omit } from 'lodash'
import React, { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

import CitationTooltip from './CitationTooltip'

/**
 * 下载链接检测配置
 * 
 * 本配置涵盖了电力行业、科学计算、工程软件等专业领域的常见文件类型，
 * 能够智能识别各种专业软件生成的文件，避免不必要的预览加载。
 * 
 * 主要分类：
 * 1. 电力行业专业文件：PSS/E、ETAP、PSCAD、DigSILENT等电力系统分析软件文件
 * 2. 科学计算文件：MATLAB、Python、R、Julia、Fortran等编程语言和科学计算软件文件
 * 3. 电力系统仿真文件：各种电力系统建模和仿真软件的文件格式
 * 4. 数据分析和可视化：数据分析、统计软件、GIS等文件格式
 * 5. 通用文件类型：文档、压缩包、媒体、图片等常见文件格式
 */
// 可配置的下载文件类型
const DOWNLOAD_FILE_TYPES = {
  // 文档类型
  documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf'],
  // 压缩文件
  archives: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'],
  // 媒体文件
  media: ['.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm'],
  // 图片文件
  images: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico'],
  // 可执行文件
  executables: ['.exe', '.msi', '.dmg', '.deb', '.rpm', '.pkg'],
  // 移动应用
  mobile: ['.apk', '.ipa', '.aab'],
  // 其他常见下载文件
  others: ['.iso', '.dmg', '.pkg', '.deb', '.rpm', '.snap'],

  // 电力行业专业文件
  powerIndustry: [
    // 电力系统分析软件文件
    '.psse', '.pss/e', '.bpa', '.pcf', '.swi', '.seq', '.dcl', '.con', '.mon',
    // 电力系统建模文件
    '.pwb', '.pwd', '.pwr', '.pws', '.pwx', '.pwrflow', '.loadflow', '.pf',
    // 电力设备参数文件
    '.gen', '.exc', '.gov', '.stab', '.pss', '.ssc', '.ssr',
    // 电力系统数据文件
    '.dat', '.raw', '.dyr', '.seq', '.mon', '.con', '.dcl',
    // 电力系统配置文件
    '.cfg', '.ini', '.xml', '.json', '.yaml', '.yml',
    // 电力系统报告文件
    '.rpt', '.rep', '.log', '.out', '.lst', '.lis',
    // 电力系统图形文件
    '.dwg', '.dxf', '.dgn', '.skp', '.3ds', '.max',
    // 电力系统数据库文件
    '.mdb', '.accdb', '.db', '.sqlite', '.odb',
    // 电力系统备份文件
    '.bak', '.backup', '.arc', '.zip', '.tar.gz'
  ],

  // 科学计算和工程软件文件
  scientificComputing: [
    // MATLAB文件
    '.m', '.mat', '.fig', '.slx', '.mdl', '.p', '.mex', '.mexa64', '.mexmaci64', '.mexw64',
    // Python科学计算文件
    '.py', '.pyc', '.pyo', '.pyd', '.ipynb', '.pyx', '.pxd', '.pxi',
    // R语言文件
    '.r', '.rdata', '.rds', '.rda', '.rhistory', '.rprofile',
    // Julia文件
    '.jl', '.jld', '.jld2',
    // Fortran文件
    '.f', '.f90', '.f95', '.f03', '.f08', '.for', '.ftn',
    // C/C++科学计算文件
    '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.obj', '.o', '.so', '.dll', '.dylib',
    // 数值计算文件
    '.dat', '.txt', '.csv', '.tsv', '.xls', '.xlsx',
    // 科学数据文件
    '.nc', '.netcdf', '.hdf', '.h5', '.hdf5', '.fits', '.fits.gz',
    // 科学图形文件
    '.eps', '.ps', '.svg', '.emf', '.wmf', '.ai', '.cdr',
    // 科学计算模型文件
    '.mod', '.gms', '.gms.gz', '.gdx', '.lst', '.log', '.sol',
    // 统计分析文件
    '.spss', '.sav', '.por', '.sas', '.sas7bdat', '.sas7bcat',
    // 地理信息系统文件
    '.shp', '.shx', '.dbf', '.prj', '.sbn', '.sbx', '.fbn', '.fbx',
    // 有限元分析文件
    '.inp', '.odb', '.dat', '.msg', '.com', '.log', '.sta', '.res',
    // 计算流体力学文件
    '.cas', '.dat', '.trn', '.out', '.res', '.plt', '.szplt',
    // 结构分析文件
    '.fem', '.out', '.f06', '.op2', '.pch', '.h5', '.hdb',
    // 电磁场分析文件
    '.ans', '.cdb', '.rst', '.full', '.emat', '.esav', '.db', '.dbb'
  ],

  // 电力系统仿真和建模文件
  powerSimulation: [
    // PSCAD文件
    '.psc', '.pscx', '.psd', '.psl', '.psm', '.psr',
    // ETAP文件
    '.etp', '.etd', '.etr', '.etx', '.etb',
    // DigSILENT文件
    '.dpl', '.dplx', '.comtrade', '.cfg', '.dat',
    // PowerWorld文件
    '.pwb', '.pwd', '.pwr', '.pws', '.pwx',
    // CYME文件
    '.cyx', '.cyd', '.cyr', '.cyp', '.cyc',
    // SKM文件
    '.skm', '.skp', '.skr', '.skx',
    // EasyPower文件
    '.epx', '.epd', '.epr', '.epc',
    // 电力系统保护文件
    '.sel', '.cfg', '.set', '.dat', '.log',
    // 电力系统监控文件
    '.scada', '.hist', '.trend', '.alarm', '.event'
  ],

  // 数据分析和可视化文件
  dataAnalysis: [
    // 数据分析文件
    '.xlsx', '.xls', '.csv', '.tsv', '.json', '.xml', '.yaml', '.yml',
    // 数据库文件
    '.db', '.sqlite', '.mdb', '.accdb', '.odb', '.dbf',
    // 统计软件文件
    '.spss', '.sav', '.por', '.sas', '.sas7bdat', '.sas7bcat',
    // 可视化文件
    '.css', '.js', '.tsx',
    // 报告文件
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.rtf',
    // 日志文件
    '.log', '.txt', '.out', '.err', '.lst', '.lis'
  ]
}

// 下载关键词
const DOWNLOAD_KEYWORDS = [
  // 通用下载关键词
  'download', 'dl', 'attachment', 'blob', 'save', 'get',
]

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  node?: any
  citationData?: {
    url: string
    title?: string
    content?: string
  }
}

const Link: React.FC<LinkProps> = (props) => {
  // 检测是否为下载链接
  // 
  // 新的匹配逻辑使用正则表达式确保完整匹配文件扩展名：
  // - 正确匹配：example.pdf, file.doc, data.xlsx
  // - 避免误判：example.html 不会被 .htm 误判为下载文件
  // - 支持查询参数：file.pdf?version=1, data.xlsx#sheet1
  // 
  // 正则表达式模式：\.{extension}([?#]|$)
  // - \.{extension} 匹配扩展名前的点号
  // - ([?#]|$) 确保扩展名后面是查询参数(?)、锚点(#)或URL结尾($)
  const isDownloadLink = (url: string): boolean => {
    if (!url) return false

    // 将所有文件类型合并为一个数组
    const allExtensions = Object.values(DOWNLOAD_FILE_TYPES).flat()

    // 检查URL是否包含下载扩展名（使用正则表达式确保完整匹配）
    const hasDownloadExtension = allExtensions.some(ext => {
      // 移除扩展名开头的点号，用于构建正则表达式
      const extension = ext.replace(/^\./, '')
      // 构建正则表达式，确保扩展名在URL末尾或后面跟着查询参数/锚点
      const regex = new RegExp(`\\.${extension}([?#]|$)`, 'i')
      return regex.test(url)
    })

    // 检查URL是否包含下载相关的关键词
    const hasDownloadKeyword = DOWNLOAD_KEYWORDS.some(keyword =>
      url.toLowerCase().includes(keyword)
    )

    // 检查是否为blob URL或data URL
    const isBlobOrData = url.startsWith('blob:') || url.startsWith('data:')

    // 检查URL参数中是否包含下载标识
    const urlParams = new URLSearchParams(url.split('?')[1] || '')
    const hasDownloadParam = ['download', 'attachment', 'inline'].some(param =>
      urlParams.has(param)
    )

    return hasDownloadExtension || hasDownloadKeyword || isBlobOrData || hasDownloadParam
  }

  // 根据链接类型决定是否默认打开预览
  const shouldAutoPreview = !isDownloadLink(props.href || '')
  const [showInlinePreview, setShowInlinePreview] = useState(shouldAutoPreview) // 根据链接类型决定是否自动打开预览
  const [isLoading, setIsLoading] = useState(false)
  const webviewRef = useRef<WebviewTag | null>(null)

  // 处理内部链接
  if (props.href?.startsWith('#')) {
    return <span className="link">{props.children}</span>
  }

  // 包含<sup>标签表示是一个引用链接
  const isCitation = React.Children.toArray(props.children).some((child) => {
    if (typeof child === 'object' && 'type' in child) {
      return child.type === 'sup'
    }
    return false
  })

  // 如果是引用链接并且有引用数据，则使用CitationTooltip
  if (isCitation && props.citationData) {
    return (
      <CitationTooltip citation={props.citationData}>
        <a
          {...omit(props, ['node', 'citationData'])}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        />
      </CitationTooltip>
    )
  }

  // 普通外部链接，需要提供预览与外部打开按钮

  const { openMinapp } = useMinappPopup()
  const isDownload = isDownloadLink(props.href || '')

  const handleOpenInApp = () => {
    if (!props.href) return
    openMinapp({
      id: encodeURIComponent(props.href),
      name: '链接预览',
      logo: AppLogo,
      url: props.href
    })
  }

  const handleOpenExternal = () => {
    if (!props.href) return
    if (window?.api?.shell?.openExternal) {
      window.api.shell.openExternal(props.href)
    } else {
      // fallback
      window.open(props.href, '_blank')
    }
  }

  const handleInlinePreview = () => {
    if (!props.href) return

    if (showInlinePreview) {
      setShowInlinePreview(false)
      setIsLoading(false)
      return
    }

    setShowInlinePreview(true)
    setIsLoading(true)
  }

  const handleDownload = () => {
    if (!props.href) return
    // 对于下载链接，直接触发下载
    const link = document.createElement('a')
    link.href = props.href
    link.download = ''
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // 设置 webview ref
  const setWebviewRef = (element: WebviewTag | null) => {
    webviewRef.current = element
  }

  // 处理 webview 事件和加载
  useEffect(() => {
    if (!webviewRef.current || !showInlinePreview || !props.href) return

    const handleLoaded = () => {
      setIsLoading(false)
    }

    webviewRef.current.addEventListener('did-finish-load', handleLoaded)
    webviewRef.current.src = props.href

    return () => {
      webviewRef.current?.removeEventListener('did-finish-load', handleLoaded)
    }
  }, [showInlinePreview, props.href])

  return (
    <>
      <LinkContainer>
        <a
          {...omit(props, ['node', 'citationData'])}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        />

        {isDownload ? (
          // 下载链接显示下载按钮和外部打开按钮
          <>
            <ActionButton onClick={handleDownload} title="下载文件">
              <span>⬇️</span>
              <span>下载</span>
            </ActionButton>
            <ActionButton onClick={handleOpenExternal} title="在外部浏览器打开">
              <LinkOutlined />
              <span>外部打开</span>
            </ActionButton>
          </>
        ) : (
          // 普通链接显示预览相关按钮
          <>
            <ActionButton onClick={handleInlinePreview} title="在当前窗口预览" active={showInlinePreview}>
              <EyeOutlined />
              <span>{showInlinePreview ? '关闭预览' : '内联预览'}</span>
            </ActionButton>
            <ActionButton onClick={handleOpenInApp} title="在应用内预览">
              <ExpandOutlined />
              <span>预览</span>
            </ActionButton>
            <ActionButton onClick={handleOpenExternal} title="在外部浏览器打开">
              <LinkOutlined />
              <span>外部打开</span>
            </ActionButton>
          </>
        )}
      </LinkContainer>

      {showInlinePreview && !isDownload && (
        <InlinePreviewContainer>
          <PreviewHeader>
            <span>链接预览: {props.href}</span>
            <CloseButton onClick={() => setShowInlinePreview(false)}>×</CloseButton>
          </PreviewHeader>
          <PreviewBody>
            {isLoading && (
              <LoadingContent>
                <div className="loading-spinner"></div>
                <span>正在加载预览内容...</span>
              </LoadingContent>
            )}
            <webview ref={setWebviewRef} style={WebviewStyle} allowpopups={'true' as any} partition="persist:webview" />
          </PreviewBody>
        </InlinePreviewContainer>
      )}
    </>
  )
}

const LinkContainer = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 4px;

  a {
    margin-right: 2px;
  }
`

const ActionButton = styled.button<{ active?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: ${(props) => (props.active ? '#e6f7ff' : 'transparent')};
  color: ${(props) => (props.active ? '#1890ff' : '#8c8c8c')};
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 11px;
  opacity: ${(props) => (props.active ? 1 : 0.6)};
  white-space: nowrap;

  &:hover {
    background: ${(props) => (props.active ? '#bae7ff' : '#f0f0f0')};
    color: #1890ff;
    opacity: 1;
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }

  svg {
    width: 11px;
    height: 11px;
  }

  span {
    font-size: 11px;
    line-height: 1;
  }
`

const InlinePreviewContainer = styled.div`
  margin-top: 8px;
  margin-bottom: 8px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fafafa;
  overflow: hidden;
  animation: slideDown 0.3s ease-out;

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`

const LoadingContent = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: #8c8c8c;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;

  .loading-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid #f0f0f0;
    border-top: 2px solid #1890ff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
`

const PreviewHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #f5f5f5;
  border-bottom: 1px solid #d9d9d9;
  font-size: 12px;
  font-weight: 500;
  color: #262626;
`

const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 16px;
  color: #8c8c8c;
  cursor: pointer;
  padding: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;

  &:hover {
    background: #f0f0f0;
    color: #262626;
  }
`

const PreviewBody = styled.div`
  position: relative;
  height: 400px;
  background: white;
`

const WebviewStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  backgroundColor: 'var(--color-background)',
  display: 'inline-flex'
}

export default Link
