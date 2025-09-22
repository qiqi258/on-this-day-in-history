const fs = require('fs');
const path = require('path');
const { existsSync, mkdirSync } = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 确保缓存目录存在
const CACHE_DIR = './cache';
if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
}

// 事件数据文件路径
const EVENTS_FILE = './events.json';
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

// 初始化事件数据文件
function initEventsFile() {
    if (!existsSync(EVENTS_FILE)) {
        fs.writeFileSync(EVENTS_FILE, JSON.stringify({}), 'utf8');
    }
}

// 检查缓存是否存在且有效（30天内）
function isCacheValid(dateStr) {
    const cacheFile = path.join(CACHE_DIR, `${dateStr}.json`);
    if (!existsSync(cacheFile)) {
        return false;
    }
    
    const stats = fs.statSync(cacheFile);
    const now = new Date();
    const cacheTime = new Date(stats.mtime);
    const daysDiff = (now - cacheTime) / (1000 * 60 * 60 * 24);
    
    return daysDiff < 30; // 缓存30天有效
}

// 从缓存获取数据
function getFromCache(dateStr) {
    try {
        const cacheFile = path.join(CACHE_DIR, `${dateStr}.json`);
        return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch (error) {
        console.error(`读取缓存失败: ${error.message}`);
        return null;
    }
}

// 写入缓存
function writeToCache(dateStr, data) {
    try {
        const cacheFile = path.join(CACHE_DIR, `${dateStr}.json`);
        fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error(`写入缓存失败: ${error.message}`);
    }
}

// 调用Gemini API生成历史事件
async function generateEventsWithAI(dateStr, month, day) {
    // 生成多语言提示词
    const prompts = {};
    
    LANGUAGES.forEach(lang => {
        const isChinese = lang === 'zh';
        const categories = isChinese 
            ? CATEGORIES.zh.join('、')
            : CATEGORIES.en.join(', ');
            
        if (isChinese) {
            // 中文提示词
            prompts[lang] = `【强制格式要求，不遵守则无效】请列出过去50年中，${month}月${day}日发生的1-5个重要历史事件（每年1-2个即可，无需所有年份）。` +
                          `必须严格按以下格式返回，不允许任何额外文字、标题、解释：\n` +
                          `年份|事件简述（20字以内）|分类（从[${categories}]选一个）\n` +
                          `示例：\n` +
                          `2020|新冠疫苗首次临床试验|科技\n` +
                          `2015|巴黎气候协定签署|政治\n` +
                          `确保事件真实，分类准确，仅返回符合格式的内容。`;
        } else {
            // 英文提示词（修复了多余的冒号）
            prompts[lang] = `【Mandatory Format - Invalid if not followed】Please list 1-5 important historical events that occurred on ${month}/${day} over the past 50 years (one per year, not required for all years).\n` +
                          `Return strictly in the following format without any additional text, titles, or explanations:\n` +
                          `Year|Event description (within 15 words)|Category (choose from [${categories}])\n` +
                          `Examples:\n` +
                          `2020|First COVID-19 vaccine trial|Technology\n` +
                          `2015|Paris Climate Agreement signed|Politics\n` +
                          `Ensure events are true and accurate with appropriate categorization. Only return content that matches the format.`;
        }
    });

    const results = {};
    const maxRetries = apiKeys.length;
    
    // 为每种语言生成内容
    for (const lang of LANGUAGES) {
        let retries = 0;
        let success = false;
        
        while (retries < maxRetries && !success) {
            try {
                const genAI = getGeminiClient();
                const model = genAI.getGenerativeModel({ 
                    model: "gemini-2.5-flash",
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 1000
                    }
                });

                console.log(`使用API密钥 #${currentKeyIndex + 1} 生成${lang}内容...`);
                const result = await model.generateContent(prompts[lang]);
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

// 解析AI生成的内容
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

// 数据校验：检查事件有效性
function validateEvents(events, lang) {
    const currentYear = new Date().getFullYear();
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
        let mainEventsData = {};
        try {
            mainEventsData = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
        } catch (error) {
            console.error('读取主事件文件失败，重新初始化', error);
            mainEventsData = {};
        }
        
        mainEventsData[dateStr] = eventsData;
        fs.writeFileSync(EVENTS_FILE, JSON.stringify(mainEventsData, null, 2), 'utf8');
        
        // 更新最后更新时间
        fs.writeFileSync('last-updated.txt', new Date().toISOString(), 'utf8');
        
        console.log(`成功更新 ${dateStr} 的历史事件`);
    } catch (error) {
        console.error('生成事件失败:', error);
        process.exit(1);
    }
}

// 执行主函数
generateAndUpdateEvents();
