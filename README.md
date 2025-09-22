# 历史上的今天 - 自动文章发布系统。

一个基于GitHub Actions和Vercel的自动化系统，每天自动生成"历史上的今天"相关事件文章并发布到网站。使用Gemini 2.5 Flash模型生成内容，支持双API密钥轮换，确保稳定运行。

## 功能特点

- **自动生成内容**：每天北京时间8点自动调用Gemini 2.5 Flash生成当日历史事件
- **双API密钥机制**：支持两个Gemini API密钥自动轮换，避免调用限制
- **智能缓存系统**：保留30天内数据，减少API调用，提高响应速度
- **自动部署**：内容更新后自动提交到GitHub并部署到Vercel
- **响应式网站**：适配各种设备的前端展示页面
- **手动触发**：支持手动触发内容生成，灵活控制更新

## 技术栈

- **后端/自动化**：Node.js、GitHub Actions
- **AI模型**：Gemini 2.0 Flash
- **部署平台**：Vercel
- **前端**：HTML、CSS、JavaScript（可根据实际情况替换为React/Vue等）
- **数据存储**：JSON文件（事件数据）、Git版本控制

## 安装与部署

### 前置条件

- GitHub账号
- Vercel账号
- Google Gemini API密钥（需要2个，用于轮换）
- Node.js环境（本地开发用，v16+）

### 步骤1：克隆仓库
git clone https://github.com/your-username/historical-events.git
cd historical-events
### 步骤2：安装依赖
npm install
### 步骤3：配置GitHub Secrets

在GitHub仓库页面，进入`Settings` → `Secrets and variables` → `Actions`，添加以下密钥：

| 密钥名称             | 说明                     |
|----------------------|--------------------------|
| `GEMINI_API_KEY_1`   | 第一个Gemini API密钥     |
| `GEMINI_API_KEY_2`   | 第二个Gemini API密钥     |

获取Gemini API密钥：[Google AI Studio](https://makersuite.google.com/)

### 步骤4：部署到Vercel

1. 登录Vercel账号，点击`New Project`
2. 导入你的GitHub仓库
3. 保持默认配置，点击`Deploy`
4. 部署完成后，Vercel会提供一个网址（如：https://your-project.vercel.app）

## 工作原理

1. **定时触发**：GitHub Actions每天UTC 0点（北京时间8点）自动运行
2. **内容生成**：
   - 检查缓存，30天内的数据直接使用
   - 超过30天或无缓存时，调用Gemini 2.5 Flash生成新内容
   - 若第一个API密钥调用失败，自动切换到第二个
3. **数据存储**：
   - 生成的内容保存到`events.json`
   - 按日期（MM-DD.json）保存到`cache`目录
   - 更新`last-updated.txt`记录最后更新时间
4. **自动部署**：
   - 自动提交变更到GitHub
   - 触发Vercel自动部署，更新网站内容

## 目录结构
historical-events/
├── .github/
│   └── workflows/
│       └── update-events.yml  # GitHub Actions工作流配置
├── cache/                     # 缓存目录，按日期存储
│   ├── 01-01.json
│   ├── 01-02.json
│   └── ...
├── public/                    # 前端文件（示例）
│   ├── index.html             # 主页面
│   ├── styles.css             # 样式表
│   └── script.js              # 前端交互逻辑
├── events.json                # 所有事件数据汇总
├── generate-events.js         # 内容生成脚本
├── last-updated.txt           # 最后更新时间
├── package.json               # 项目依赖
└── README.md                  # 项目说明
## 使用方法

### 查看网站

部署完成后，访问Vercel提供的网址即可查看"历史上的今天"内容。

### 手动触发更新

1. 进入GitHub仓库 → `Actions` → `Update Historical Events`
2. 点击`Run workflow` → `Run workflow`
3. 系统将立即执行内容生成和更新流程

### 本地开发
# 安装依赖
npm install

# 本地运行内容生成（需要先配置环境变量）
GEMINI_API_KEY_1=your_key_1 GEMINI_API_KEY_2=your_key_2 node generate-events.js

# 本地预览网站（可使用live-server等工具）
npx live-server public
## 自定义配置

### 修改更新时间

编辑`.github/workflows/update-events.yml`中的`cron`表达式：
schedule:
  - cron: '0 0 * * *'  # 每天UTC 0点（北京时间8点）
Cron表达式生成工具：[crontab.guru](https://crontab.guru/)

### 调整生成内容

修改`generate-events.js`中的提示词（`prompt`变量），可以调整生成内容的风格、数量和格式。

### 更改缓存时间

修改`generate-events.js`中的缓存有效期判断：
// 将30天改为其他天数
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);  // 改为需要的天数
## 故障排除

### API调用失败

1. 检查GitHub Secrets中的API密钥是否正确
2. 确认密钥是否有足够的配额
3. 检查网络连接是否正常

### 工作流未触发

1. 检查GitHub Actions是否启用
2. 确认工作流文件路径和格式是否正确
3. 查看工作流日志，排查错误信息

### 缓存不生效

1. 检查`cache`目录是否有写入权限
2. 确认缓存文件命名是否正确（MM-DD.json）
3. 检查缓存有效期判断逻辑

## 许可证

[MIT](LICENSE)

## 致谢

- [Google Gemini](https://ai.google.dev/) - 提供AI生成能力
- [GitHub Actions](https://github.com/features/actions) - 提供自动化运行环境
- [Vercel](https://vercel.com/) - 提供免费部署服务
