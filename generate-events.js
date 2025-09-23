const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { exec } = require('child_process');
const schedule = require('node-schedule');

// 配置
const CONFIG = {
    dataDir: path.join(__dirname, 'data'),      // 数据存储目录
    cacheDir: path.join(__dirname, 'cache'),    // 缓存目录
    lastUpdatedFile: path.join(__dirname, 'last-updated.txt'), // 最后更新时间文件
    githubRepo: 'https://github.com/yourusername/on-this-day-in-history.git', // GitHub仓库
    scheduledTime: '0 8 * * *',                 // 每天早上8点执行 (cron格式)
    syncCommand: 'git add . && git commit -m "Update events data: %s" && git push', // 同步命令
    maxRetries: 3,                              // 最大重试次数
    apiTimeout: 30000                           // API超时时间(ms)
};

// 支持的语言和分类
const LANGUAGES = ['zh', 'en'];
const CATEGORIES = {
    zh: ['政治', '经济', '科技', '文化', '体育', '灾害', '其他'],
    en: ['Politics', 'Economy', 'Technology', 'Culture', 'Sports', 'Disaster', 'Other']
};

// 初始化目录
[CONFIG.dataDir, CONFIG.cacheDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// 获取API密钥列表
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

/**
 * 获取指定日期的标准化字符串 (YYYY-MM-DD)
 * @param {Date} date 日期对象，默认当前日期
 * @returns {string} 标准化日期字符串
 */
function getDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 获取事件数据文件路径
 * @param {string} dateStr 标准化日期字符串
 * @returns {string} 文件路径
 */
function getEventsFilePath(dateStr) {
    return path.join(CONFIG.dataDir, `events-${dateStr}.json`);
}

/**
 * 获取缓存文件路径
 * @param {string} dateStr 标准化日期字符串
 * @returns {string} 缓存文件路径
 */
function getCacheFilePath(dateStr) {
    return path.join(CONFIG.cacheDir, `${dateStr}.json`);
}

/**
 * 初始化事件数据文件
 * @param {string} filePath 文件路径
 */
function initEventsFile(filePath) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify({}, null, 2), 'utf8');
    }
}

/**
 * 检查缓存是否有效（30天内）
 * @param {string} dateStr 标准化日期字符串
 * @returns {boolean} 缓存是否有效
 */
function isCacheValid(dateStr) {
    const cacheFile = getCacheFilePath(dateStr);
    if (!fs.existsSync(cacheFile)) {
        return false;
    }
    
    const stats = fs.statSync(cacheFile);
    const now = new Date();
    const cacheTime = new Date(stats.mtime);
    const daysDiff = (now - cacheTime) / (1000 * 60 * 60 * 24);
    
    return daysDiff < 30;
}

/**
 * 从缓存获取数据
 * @param {string} dateStr 标准化日期字符串
 * @returns {object|null} 缓存数据
 */
function getFromCache(dateStr) {
    try {
        const cacheFile = getCacheFilePath(dateStr);
        return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch (error) {
        console.error(`读取缓存失败: ${error.message}`);
        return null;
    }
}

/**
 * 写入缓存
 * @param {string} dateStr 标准化日期字符串
 * @param {object} data 要缓存的数据
 */
function writeToCache(dateStr, data) {
    try {
        const cacheFile = getCacheFilePath(dateStr);
        fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error(`写入缓存失败: ${error.message}`);
    }
}

/**
 * 实现API调用超时控制
 * @param {Promise} promise API调用Promise
 * @param {number} timeoutMs 超时时间(ms)
 * @returns {Promise} 带超时的Promise
 */
function withTimeout(promise, timeoutMs) {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`API调用超时（${timeoutMs}ms）`)), timeoutMs)
        )
    ]);
}

/**
 * 调用Gemini API生成历史事件
 * @param {string} dateStr 标准化日期字符串
 * @returns {object} 多语言事件数据
 */
async function generateEventsWithAI(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const currentYear = new Date().getFullYear();
    
    // 生成多语言提示词
    const prompts = {};
    
    LANGUAGES.forEach(lang => {
        const isChinese = lang === 'zh';
        const categories = isChinese 
            ? CATEGORIES.zh.join('、')
            : CATEGORIES.en.join(', ');
            
        if (isChinese) {
            prompts[lang] = `【强制格式要求，不遵守则无效】请列出过去50年中，${month}月${day}日发生的5-10个重要历史事件（每年1个，年份范围：${currentYear - 50} - ${currentYear}）。` +
                          `必须严格按以下格式返回，不允许任何额外文字、标题、解释：\n` +
                          `年份|事件简述（20字以内）|分类（从[${categories}]选一个）\n` +
                          `示例：\n` +
                          `2020|新冠疫苗首次临床试验|科技\n` +
                          `2015|巴黎气候协定签署|政治\n` +
                          `确保事件真实，分类准确，仅返回符合格式的内容。`;
        } else {
            prompts[lang] = `【Mandatory Format - Invalid if not followed】Please list 5-10 important historical events that occurred on ${month}/${day} over the past 50 years (one per year, year range: ${currentYear - 50} - ${currentYear}).\n` +
                          `Return strictly in the following format without any additional text, titles, or explanations:\n` +
                          `Year|Event description (within 15 words)|Category (choose from [${categories}])\n` +
                          `Examples:\n` +
                          `2020|First COVID-19 vaccine trial|Technology\n` +
                          `2015|Paris Climate Agreement signed|Politics\n` +
                          `Ensure events are true and accurate with appropriate categorization. Only return content that matches the format.`;
        }
    });

    const results = {};
    const maxRetries = apiKeys.length * CONFIG.maxRetries;
    
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
                    CONFIG.apiTimeout
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

/**
 * 解析AI生成的内容
 * @param {string} aiResponse AI响应文本
 * @param {string} lang 语言代码
 * @returns {array} 解析后的事件数组
 */
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

/**
 * 数据校验：检查事件有效性
 * @param {array} events 事件数组
 * @param {string} lang 语言代码
 * @returns {array} 验证后的事件数组
 */
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

/**
 * 同步数据到GitHub仓库
 * @param {string} dateStr 标准化日期字符串
 * @returns {Promise} 同步结果
 */
function syncToGitHub(dateStr) {
    return new Promise((resolve, reject) => {
        const formattedDate = new Date(dateStr).toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        const command = CONFIG.syncCommand.replace('%s', formattedDate);
        
        exec(command, { cwd: __dirname }, (error, stdout, stderr) => {
            if (error) {
                console.error(`同步失败: ${error.message}`);
                return reject(error);
            }
            if (stderr) {
                console.warn(`同步警告: ${stderr}`);
            }
            console.log(`同步成功: ${stdout}`);
            resolve(stdout);
        });
    });
}

/**
 * 生成并更新事件
 * @param {string} dateStr 标准化日期字符串，默认当前日期
 */
async function generateAndUpdateEvents(dateStr = getDateString()) {
    try {
        const eventsFile = getEventsFilePath(dateStr);
        initEventsFile(eventsFile);
        
        // 检查缓存
        if (isCacheValid(dateStr)) {
            console.log(`使用缓存数据: ${dateStr}`);
            const cachedData = getFromCache(dateStr);
            
            if (cachedData) {
                fs.writeFileSync(eventsFile, JSON.stringify(cachedData, null, 2), 'utf8');
                return cachedData;
            }
        }
        
        console.log(`生成新数据: ${dateStr}`);
        // 调用AI生成事件
        const aiResults = await generateEventsWithAI(dateStr);
        
        // 解析和校验每种语言的事件
        const eventsData = {};
        LANGUAGES.forEach(lang => {
            const parsedEvents = parseEvents(aiResults[lang], lang);
            eventsData[lang] = validateEvents(parsedEvents, lang);
        });
        
        // 写入缓存和数据文件
        writeToCache(dateStr, eventsData);
        fs.writeFileSync(eventsFile, JSON.stringify(eventsData, null, 2), 'utf8');
        
        // 更新最后更新时间
        const now = new Date();
        const lastUpdated = now.toLocaleString('zh-CN', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        fs.writeFileSync(CONFIG.lastUpdatedFile, lastUpdated, 'utf8');
        
        console.log(`事件生成成功: ${eventsFile}`);
        return eventsData;
    } catch (error) {
        console.error(`生成事件失败: ${error.message}`);
        console.error(error.stack);
        throw error; // 抛出错误以便上层处理
    }
}

/**
 * 生成指定日期的事件并同步
 * @param {string} dateStr 标准化日期字符串，默认当前日期
 */
async function generateAndSync(dateStr = getDateString()) {
    try {
        console.log(`开始处理${dateStr}的历史事件...`);
        
        // 生成事件
        await generateAndUpdateEvents(dateStr);
        
        // 同步到GitHub
        await syncToGitHub(dateStr);
        
        console.log(`${dateStr}的事件生成和同步已完成`);
        return true;
    } catch (error) {
        console.error(`处理${dateStr}的事件时出错:`, error.message);
        return false;
    }
}

/**
 * 设置定时任务
 */
function setupSchedule() {
    console.log(`设置定时任务，将在每天${CONFIG.scheduledTime}执行`);
    
    // 安排定时任务
    const job = schedule.scheduleJob(CONFIG.scheduledTime, async () => {
        console.log('定时任务触发，开始生成今日事件...');
        const today = getDateString();
        await generateAndSync(today);
    });
    
    // 验证任务是否已安排
    if (job) {
        console.log('定时任务已成功设置');
    } else {
        console.error('定时任务设置失败');
    }
}

// 命令行参数处理
const args = process.argv.slice(2);

if (args.includes('--today')) {
    // 立即生成今天的事件并同步
    generateAndSync();
} else if (args.includes('--schedule')) {
    // 设置定时任务
    setupSchedule();
} else if (args.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(args[0])) {
    // 生成指定日期的事件
    generateAndSync(args[0]);
} else {
    console.log('使用方法:');
    console.log('  立即生成今天的事件并同步: node generate-events.js --today');
    console.log('  设置定时任务(每天8点执行): node generate-events.js --schedule');
    console.log('  生成指定日期的事件: node generate-events.js YYYY-MM-DD');
}
