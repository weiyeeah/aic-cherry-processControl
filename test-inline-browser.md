# 内联浏览器测试

## 修改说明

已经修改了默认的内联浏览器设置，现在链接默认不会自动开启内联预览。

## 测试链接

以下是一些测试链接，用于验证内联浏览器是否默认关闭：

1. [Google](https://www.google.com)
2. [GitHub](https://github.com)  
3. [百度](https://www.baidu.com)
4. [Stack Overflow](https://stackoverflow.com)

## 预期行为

- 点击这些链接时，应该不会自动显示内联预览
- 用户需要手动点击"内联预览"按钮才能启用预览
- 链接应该显示外部链接图标和相关操作按钮

## 修改内容

在 `src/renderer/src/pages/home/Markdown/Link.tsx` 文件中：

```typescript
// 修改前
const shouldAutoPreview = !isDownloadLink(props.href || '')

// 修改后  
const shouldAutoPreview = false // 默认关闭内联预览
```

这个修改确保所有链接默认都不会自动开启内联预览功能。