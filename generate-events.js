const fs = require('fs');
const path = require('path');
const { existsSync, mkdirSync } = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 获取项目根目录的绝对路径
const ROOT_DIR = path.resolve(__dirname);

// 使用绝对路径定义文件和目录
const CACHE_DIR = path.join(ROOT_DIR, 'cache');
const EVENTS_FILE = path.join(ROOT_DIR, 'events.json');
const LAST_UPDATED_FILE = path.join(ROOT_DIR, 'last-updated.txt');

// 确保缓存目录存在
if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
}

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

// 获取Gemini客户端
function getGeminiClient() {
    const genAI = new GoogleGenerativeAI(apiKeys[currentKeyIndex]);
    return genAI;
}

// 切换到下一个API密钥
function switchToNextApiKey() {
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    console.log(`已切换到API密钥 #${currentKeyIndex + 1}`);
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

// 生成提示词
function generatePrompt(lang, month, day) {
    const isChinese = lang === 'zh';
    const categories = isChinese ? CATEGORIES.zh.join('、') : CATEGORIES.en.join(', ');
    
    if (isChinese) {
        return `【强制格式要求，不遵守则无效】请列出过去50年中，${month}月${day}日发生的3-5个重要历史事件（每年1个）。` +
               `必须严格按以下格式返回，不允许任何额外文字、标题、解释：\n` +
               `年份|事件简述（20字以内）|分类（从[${categories}]选一个）\n` +
               `示例：\n` +
               `2020|新冠疫苗首次临床试验|科技\n` +
               `2015|巴黎气候协定签署|政治\n` +
               `确保事件真实，分类准确，仅返回符合格式的内容。`;
    } else {
        return `【Mandatory Format - Invalid if not followed】Please list 3-5 important historical events that occurred on ${month}/${day} over the past 50 years (one per year).\n` +
               `Must strictly follow this format, no additional text/titles/explanations:\n` +
               `year|event description (within 20 words)|category (choose from [${categories}])\n` +
               `Examples:\n` +
               `2020|First COVID-19 vaccine clinical trial begins|Technology\n` +
               `2015|Paris Climate Agreement signed|Politics\n` +
               `Ensure events are factual, categories are accurate, and only return content in the specified format.`;
    }
}

// 调用Gemini API生成历史事件
async function generateEventsWithAI(dateStr, month, day) {
    const results = {};
    const maxRetries = apiKeys.length * 2; // 每个密钥最多重试2次
    
    // 为每种语言生成内容
    for (const lang of LANGUAGES) {
        let retries = 0;
        let success = false;
        
        while (retries < maxRetries && !success) {
            try {
                const genAI = getGeminiClient();
                // 使用 gemini-2.0-flash 模型
                const model = genAI.getGenerativeModel({ 
                    model: "gemini-2.0-flash",
                    generationConfig: {
                        temperature: 0.6,  // 降低随机性，提高格式稳定性
                        maxOutputTokens: 800,
                        responseMimeType: "text/plain" // 明确要求纯文本输出
                    }
                });

                console.log(`使用API密钥 #${currentKeyIndex + 1} 生成${lang}内容...`);
                
                // 生成提示词
                const prompt = generatePrompt(lang, month, day);
                
                // 带超时的API调用（30秒）
                const result = await withTimeout(
                    model.generateContent(prompt),
                    30000
                );
                const response = await result.response;
                const aiText = response.text().trim();
                
                // 打印AI返回的原始内容，方便排查格式问题
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

// 解析事件数据
function parseEvents(text, lang) {
    const events = [];
    const lines = text.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
        const [year, description, category] = line.split('|').map(item => item.trim());
        if (year && description && category) {
            events.push({
                year: parseInt(year),
                description,
                category
            });
        }
    }
    
    return events;
}

// 验证事件数据
function validateEvents(events, lang) {
    const validCategories = CATEGORIES[lang];
    return events.filter(event => {
        const isValidYear = event.year >= 1970 && event.year <= new Date().getFullYear();
        const isValidCategory = validCategories.includes(event.category);
        return isValidYear && isValidCategory;
    });
}

// 获取缓存路径
function getCachePath(dateStr) {
    return path.join(CACHE_DIR, `${dateStr}.json`);
}

// 检查缓存是否有效
function isCacheValid(dateStr) {
    const cachePath = getCachePath(dateStr);
    if (!existsSync(cachePath)) {
        return false;
    }
    
    try {
        const stats = fs.statSync(cachePath);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return stats.mtime > thirtyDaysAgo;
    } catch (error) {
        console.error(`检查缓存状态失败: ${error.message}`);
        return false;
    }
}

// 从缓存获取数据
function getFromCache(dateStr) {
    const cachePath = getCachePath(dateStr);
    try {
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (error) {
        console.error(`读取缓存失败: ${error.message}`);
        return null;
    }
}

// 写入缓存
function writeToCache(dateStr, data) {
    const cachePath = getCachePath(dateStr);
    try {
        fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error(`写入缓存失败: ${error.message}`);
    }
}

// 初始化事件文件
function initEventsFile() {
    if (!existsSync(EVENTS_FILE)) {
        fs.writeFileSync(EVENTS_FILE, '{}', 'utf8');
    }
}

// 主函数：生成并更新事件
async function generateAndUpdateEvents() {
    try {
        initEventsFile();
        
        const today = new Date();
        const month = today.getMonth() + 1;
        const day = today.getDate();
        const dateStr = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        // 检查缓存
        if (isCacheValid(dateStr)) {
            console.log(`使用缓存数据: ${dateStr}`);
            const cachedData = getFromCache(dateStr);
            
            if (cachedData) {
                // 更新主事件文件
                let eventsData = {};
                try {
                    eventsData = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
                } catch (error) {
                    console.error('读取事件文件失败，重新初始化', error);
                    eventsData = {};
                }
                
                eventsData[dateStr] = cachedData;
                fs.writeFileSync(EVENTS_FILE, JSON.stringify(eventsData, null, 2), 'utf8');
                return;
            }
        }
        
        console.log(`生成新数据: ${dateStr}`);
        // 调用AI生成事件
        const aiResults = await generateEventsWithAI(dateStr, month, day);
        
        // 解析和校验每种语言的事件
        const eventsData = {};
        LANGUAGES.forEach(lang => {
            const parsedEvents = parseEvents(aiResults[lang], lang);
            eventsData[lang] = validateEvents(parsedEvents, lang);
        });
        
        // 写入缓存
        writeToCache(dateStr, eventsData);
        
        // 更新主事件文件
        let allEvents = {};
        try {
            allEvents = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
        } catch (error) {
            console.error('读取事件文件失败，重新初始化', error);
        }
        
        allEvents[dateStr] = eventsData;
        fs.writeFileSync(EVENTS_FILE, JSON.stringify(allEvents, null, 2), 'utf8');
        
        // 更新最后更新时间
        const now = new Date();
        const lastUpdated = now.toLocaleString('zh-CN', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        fs.writeFileSync(LAST_UPDATED_FILE, lastUpdated, 'utf8');
        
        console.log(`事件生成成功: ${dateStr}`);
    } catch (error) {
        console.error(`生成事件失败: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

// 执行主函数
generateAndUpdateEvents();