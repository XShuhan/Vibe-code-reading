# 调试指南

## 检查扩展是否正确加载

1. 在 Extension Development Host 窗口中:
   - 按 Cmd+Shift+P
   - 输入 "Developer: Show Running Extensions"
   - 查看是否有 "Code Vibe Reading" 在列表中

2. 如果没有,检查输出面板:
   - 按 Cmd+Shift+P
   - 输入 "Developer: Toggle Developer Tools"
   - 查看 Console 中的错误信息

3. 或者查看扩展主机日志:
   - Cmd+Shift+P → "Developer: Open Extension Logs Folder"

## 手动测试命令

在 Extension Development Host 中:
- Cmd+Shift+P → "Vibe: Refresh Index"
- 如果命令存在但图标不显示,可能是 views 注册问题

## 常见问题

1. **图标不显示**: 检查 media/icon.svg 是否存在
2. **命令不存在**: 扩展可能没有正确激活
3. **视图不显示**: 检查 package.json 中的 views 配置

## 重新加载扩展

- Cmd+Shift+P → "Developer: Reload Window"
