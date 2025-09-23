// 导入必要模块
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // 保留（仍用Gemini API）

// 1. 修正数据存储目录（确保与前端加载路径一致）
const dataDir = path.join(__dirname, 'data'); // 项目根目录的data文件夹
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true }); // 自动创建data目录
}

// 2. 缓存目录设置（使用path模块，避免跨系统问题）
const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// 3. 统一日期格式：全局使用 YYYY-MM-DD（与前端完全匹配）
const today = new Date();
const year = today.getFullYear();
const month = String(today.getMonth() + 1).padStart(2, '0');
const day = String(today.getDate()).padStart(2, '0');
const dateStr = `${year}-${month}-${day}`; // 关键：统一为 YYYY-MM-DD（如 2024-10-05）

// 4. 事件数据文件路径（单个日期对应单个文件）
const EVENTS_FILE = path.join(dataDir, `events-${dateStr}.json`); // 最终路径：data/events-2024-10-05.json

// 支持的语言
const LANGUAGES = ['zh', 'en'];
// 事件分类（中英文对应）
const CATEGORIES = {
    zh: ['政治', '经济', '科技', '文化', '体育', '灾害', '其他'],
    en: ['Politics', 'Economy', 'Technology', 'Culture', 'Sports', 'Disaster', 'Other']
};

// 获取可用的API密钥列表
const apiKeys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2
].filter(Boolean);

if (apiKeys.length === 0) {
    console.error('错误: 未配置有效的Gemini API密钥');
    process.exit(1);
}

// 当前使用的密钥索引
let currentKeyIndex = 0;

/**
 * 获取当前要使用的Gemini客户端
 */
function getGeminiClient() {
    const apiKey = apiKeys[currentKeyIndex];
    return new GoogleGenerativeAI(apiKey);
}

/**
 * 切换到下一个API密钥
 */
function switchToNextApiKey() {
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    console.log(`已切换到API密钥 #${currentKeyIndex + 1}`);
}

// 初始化事件数据文件（修复：添加fs前缀）
function initEventsFile() {
    if (!fs.existsSync(EVENTS_FILE)) { // 关键：修复为 fs.existsSync
        fs.writeFileSync(EVENTS_FILE, JSON.stringify({}, 'utf8'));
    }
}

// 检查缓存是否存在且有效（30天内，缓存文件名添加年份）
function isCacheValid() {
    const cacheFile = path.join(CACHE_DIR, `${dateStr}.json`); // 缓存文件：cache/2024-10-05.json（避免年份覆盖）
    if (!fs.existsSync(cacheFile)) {
        return false;
    }
    
    const stats = fs.statSync(cacheFile);
    const now = new Date();
    const cacheTime = new Date(stats.mtime);
    const daysDiff = (now - cacheTime) / (1000 * 60 * 60 * 24);
    
    return daysDiff < 30;
}

// 从缓存获取数据（使用YYYY-MM-DD格式的缓存文件）
function getFromCache() {
    try {
        const cacheFile = path.join(CACHE_DIR, `${dateStr}.json`);
        return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch (error) {
        console.error(`读取缓存失败: ${error.message}`);
        return null;
    }
}

// 写入缓存（缓存文件用YYYY-MM-DD命名）
function writeToCache(data) {
    try {
        const cacheFile = path.join(CACHE_DIR, `${dateStr}.json`);
        fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error(`写入缓存失败: ${error.message}`);
    }
}

// 实现API调用超时控制
function withTimeout(promise, timeoutMs = 30000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`API调用超时（${timeoutMs}ms）`)), timeoutMs)
        )
    ]);
}

// 调用Gemini API生成历史事件（参数移除冗余的dateStr）
async function generateEventsWithAI() {
    // 生成多语言提示词（使用全局的year/month/day，确保事件年份正确）
    const prompts = {};
    
    LANGUAGES.forEach(lang => {
        const isChinese = lang === 'zh';
        const categories = isChinese 
            ? CATEGORIES.zh.join('、')
            : CATEGORIES.en.join(', ');
            
        if (isChinese) {
            prompts[lang] = `【强制格式要求，不遵守则无效】请列出过去50年中，${month}月${day}日发生的5-10个重要历史事件（每年1个，年份范围：${year - 50} - ${year}）。` +
                          `必须严格按以下格式返回，不允许任何额外文字、标题、解释：\n` +
                          `年份|事件简述（20字以内）|分类（从[${categories}]选一个）\n` +
                          `示例：\n` +
                          `2020|新冠疫苗首次临床试验|科技\n` +
                          `2015|巴黎气候协定签署|政治\n` +
                          `确保事件真实，分类准确，仅返回符合格式的内容。`;
        } else {
            prompts[lang] = `【Mandatory Format - Invalid if not followed】Please list 5-10 important historical events that occurred on ${month}/${day} over the past 50 years (one per year, year range: ${year - 50} - ${year}).\n` +
                          `Return strictly in the following format without any additional text, titles, or explanations:\n` +
                          `Year|Event description (within 15 words)|Category (choose from [${categories}])\n` +
                          `Examples:\n` +
                          `2020|First COVID-19 vaccine trial|Technology\n` +
                          `2015|Paris Climate Agreement signed|Politics\n` +
                          `Ensure events are true and accurate with appropriate categorization. Only return content that matches the format.`;
        }
    });

    const results = {};
    const maxRetries = apiKeys.length * 2; // 每个密钥最多重试2次
    
    // 为每种语言生成内容
    for (const lang of LANGUAGES) {
        let retries = 0;
        let success = false;
        
        while (retries < maxRetries && !success) {
            try {
                const genAI = getGeminiClient();
                const model = genAI.getGenerativeModel({ 
                    model: "gemini-2.0-flash",
                    generationConfig: {
                        temperature: 0.6,
                        maxOutputTokens: 800,
                        responseMimeType: "text/plain"
                    }
                });

                console.log(`使用API密钥 #${currentKeyIndex + 1} 生成${lang}内容...`);
                const result = await withTimeout(
                    model.generateContent(prompts[lang]),
                    30000
                );
                const response = await result.response;
                const aiText = response.text().trim();
                
                console.log(`Gemini返回${lang}原始内容:\n${aiText || '【空内容】'}`);
                
                if (!aiText) {
                    throw new Error(`Gemini返回${lang}内容为空`);
                }
                
                results[lang] = aiText;
                success = true;
            } catch (error) {
                console.error(`生成${lang}内容失败: ${error.message}`);
                retries++;
                
                if (retries < maxRetries) {
                    switchToNextApiKey();
                    console.log(`重试第${retries + 1}次...`);
                } else {
                    throw new Error(`所有API密钥均无法生成${lang}内容`);
                }
            }
        }
    }
    
    return results;
}

// 解析AI生成的内容（逻辑不变）
function parseEvents(aiResponse, lang) {
    const events = [];
    const lines = aiResponse.split('\n');
    
    lines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine === '') return;
        
        const parts = trimmedLine.split('|');
        if (parts.length !== 3) {
            console.warn(`跳过格式错误的行: ${trimmedLine}`);
            return;
        }
        
        events.push({
            year: parseInt(parts[0].trim(), 10),
            title: parts[1].trim(),
            category: parts[2].trim()
        });
    });
    
    return events;
}

// 数据校验：检查事件有效性（逻辑不变）
function validateEvents(events, lang) {
    const currentYear = year; // 使用全局的year，避免重复计算
    const validEvents = [];
    const validCategories = CATEGORIES[lang];
    
    events.forEach(event => {
        // 检查年份是否在合理范围内（过去50年）
        if (isNaN(event.year) || event.year < currentYear - 50 || event.year > currentYear) {
            console.log(`过滤无效年份事件: ${event.year}年 ${event.title}`);
            return;
        }
        
        // 检查分类是否有效
        if (!validCategories.includes(event.category)) {
            console.log(`修正无效分类事件: ${event.year}年 ${event.title} (${event.category})`);
            event.category = lang === 'zh' ? '其他' : 'Other';
        }
        
        // 检查标题是否为空
        if (!event.title || event.title.trim() === '') {
            console.log(`过滤空标题事件: ${event.year}年`);
            return;
        }
        
        validEvents.push(event);
    });
    
    return validEvents;
}

// 主函数：生成并更新事件（核心逻辑修改）
async function generateAndUpdateEvents() {
    try {
        initEventsFile();
        
        // 检查缓存（使用YYYY-MM-DD格式的缓存）
        if (isCacheValid()) {
            console.log(`使用缓存数据: ${dateStr}`);
            const cachedData = getFromCache();
            
            if (cachedData) {
                // 直接写入当前日期的独立文件（不再聚合多个日期）
                fs.writeFileSync(EVENTS_FILE, JSON.stringify(cachedData, null, 2), 'utf8');
                return;
            }
        }
        
        console.log(`生成新数据: ${dateStr}`);
        // 调用AI生成事件（无需传dateStr，使用全局变量）
        const aiResults = await generateEventsWithAI();
        
        // 解析和校验每种语言的事件（生成当天的独立数据）
        const eventsData = {};
        LANGUAGES.forEach(lang => {
            const parsedEvents = parseEvents(aiResults[lang], lang);
            eventsData[lang] = validateEvents(parsedEvents, lang);
        });
        
        // 写入缓存（缓存文件带年份）
        writeToCache(eventsData);
        
        // 写入当前日期的独立文件（结构：{zh: [...], en: [...]}，前端可直接解析）
        fs.writeFileSync(EVENTS_FILE, JSON.stringify(eventsData, null, 2), 'utf8');
        
        // 更新最后更新时间（逻辑不变）
        const now = new Date();
        const lastUpdated = now.toLocaleString('zh-CN', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        fs.writeFileSync('last-updated.txt', lastUpdated, 'utf8');
        
        console.log(`事件生成成功: ${EVENTS_FILE}`); // 打印最终文件路径，方便验证
    } catch (error) {
        console.error(`生成事件失败: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

// 执行主函数
generateAndUpdateEvents();