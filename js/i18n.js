// js/i18n.js
// 中英文切换：在「中文(zh)」与「英文(en)」之间切换并持久化。
// 语言以 <html lang="..."> 表达；页面静态文案通过 data-i18n* 属性标注，由本脚本注入。
// 设计与 js/theme.js 对齐：IIFE、localStorage 持久化、向 window 暴露 toggle/get/set。

(function (global) {
    const KEY = 'ltLang';
    const LANGS = ['zh', 'en'];

    // 翻译字典：zh 与 en 都登记，使来回切换都能正确还原（不依赖读取原始 DOM）。
    // key 命名按区域分组：common / nav / history / settings / search / douban / results
    //                    / disclaimer / pwd / footer / player / about / title。
    const STRINGS = {
        zh: {
            // 文档标题（每页 <html data-i18n-doctitle="..."> 指定使用哪一个）
            'title.index': 'LibreTV - 免费在线视频搜索与观看平台',
            'title.player': 'LibreTV 播放器',
            'title.about': '关于我们 - LibreTV',

            // 通用
            'common.loading': '加载中...',

            // 顶栏按钮
            'nav.history': '观看历史',
            'nav.theme': '切换主题',
            'nav.settings': '打开设置',
            'nav.language': '切换语言 / Switch Language',

            // 历史面板
            'history.title': '观看历史',
            'history.panelAria': '观看历史',
            'history.empty': '暂无观看记录',
            'history.clear': '清空历史记录',
            'nav.favorites': '我的收藏',
            'fav.title': '我的收藏',
            'fav.empty': '暂无收藏',
            'fav.clear': '清空收藏',
            'fav.save': '收藏',
            'fav.saved': '已收藏',
            'fav.remove': '取消收藏',
            'fav.openFail': '无法打开该收藏',
            'fav.episodes1': '共 ',
            'fav.episodes2': ' 集',
            'account.title': '账号',
            'account.login': '登录',
            'account.logout': '退出登录',
            'account.register': '注册',
            'account.username': '用户名',
            'account.password': '密码',
            'account.invite': '管理员密码（邀请口令）',
            'account.toRegister': '没有账号？去注册',
            'account.toLogin': '已有账号？去登录',
            'account.welcome': '登录成功',
            'account.registered': '注册成功，已登录',
            'account.loggedOut': '已退出登录',
            'account.failed': '操作失败',
            'account.needUserPass': '请输入用户名和密码',

            // 设置面板
            'settings.title': '设置',
            'settings.panelAria': '设置面板',
            'settings.dataSource': '数据源设置',
            'settings.selectAll': '全选',
            'settings.deselectAll': '全不选',
            'settings.selectNormal': '全选普通资源',
            'settings.selectedCount': '已选API数量：',
            'settings.customApi': '自定义API',
            'settings.customApiNamePlaceholder': 'API名称',
            'settings.customApiDetailPlaceholder': 'detail地址（可选）',
            'settings.adultResource': '黄色资源站',
            'settings.add': '添加',
            'settings.cancel': '取消',
            'settings.featureSwitch': '功能开关',
            'settings.yellowFilter': '黄色内容过滤',
            'settings.yellowFilterDesc': '过滤"伦理片"等黄色内容',
            'settings.adFilter': '分片广告过滤',
            'settings.adFilterDesc': '关闭可减少旧版浏览器卡顿',
            'settings.douban': '豆瓣热门推荐',
            'settings.doubanDesc': '首页显示豆瓣热门影视内容',
            'settings.maxPerf': '高性能画质增强',
            'settings.maxPerfDesc': '不限制增强分辨率，榨干 GPU 超采样（强机/独显更清晰，弱机慎开）',
            'settings.tmdbTitle': '可观看平台 (Netflix / Disney+ 等)',
            'settings.tmdbDesc': '在影片详情中显示其可观看的正版平台并跳转。需填入免费的 TMDB API Key（<a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:underline">申请地址</a>）。留空则不启用。',
            'settings.tmdbRegionPlaceholder': '地区(如 US/HK/TW)',
            'settings.save': '保存',
            'settings.historySync': '历史云同步',
            'settings.historySyncDesc': '填写用户名后，观看历史将绑定该名字保存到云端（KV），多设备共享；留空则仅保存在本地。',
            'settings.usernamePlaceholder': '用户名（留空则仅本地）',
            'settings.usernameSave': '保存并同步',
            'settings.customProxy': '自定义代理地址',
            'settings.customProxyDesc': '填自建的 /proxy/ 地址可换区域/节点（仅影响搜索与详情请求，不重路由视频分片）。留空用默认。保存后刷新生效。',
            'settings.generalFunc': '一般功能',
            'settings.importConfig': '导入配置',
            'settings.exportConfig': '导出配置',
            'settings.clearCookie': '清除Cookie',

            // 首页标语与搜索
            'index.slogan': '自由观影，畅享精彩',
            'search.home': '首页',
            'search.homeAria': '返回首页',
            'search.placeholder': '搜索你喜欢的视频...',
            'search.inputAria': '视频搜索框',
            'search.clearAria': '清空搜索框',
            'search.button': '搜索',
            'search.buttonAria': '搜索按钮',
            'search.recentAria': '最近搜索记录',

            // 豆瓣
            'douban.title': '豆瓣热门',
            'douban.movie': '电影',
            'douban.tv': '电视剧',
            'douban.refresh': '换一批',

            // 搜索结果
            'results.countSuffix': ' 个结果',

            // 使用声明弹窗
            'disclaimer.title': '使用声明',
            'disclaimer.intro': '欢迎使用 LibreTV。在开始使用前，请您了解并同意以下条款：',
            'disclaimer.service': '<strong class="text-blue-400">服务性质：</strong> LibreTV 仅提供视频搜索服务，不直接提供、存储或上传任何视频内容。所有搜索结果均来自第三方公开接口。',
            'disclaimer.userResp': '<strong class="text-blue-400">用户责任：</strong> 用户在使用本站服务时，须遵守相关法律法规，不得利用搜索结果从事侵权行为，如下载、传播未经授权的作品等。',
            'disclaimer.adRisk': '<strong class="text-blue-400">广告风险提示：</strong> 本站所有视频均来自第三方采集站，视频中出现的广告与本站无关，请勿相信或点击视频中的任何广告内容，谨防上当受骗。',
            'disclaimer.accept': '我已了解并接受',

            // 密码弹窗（index + player 共用）
            'pwd.title': '访问验证',
            'pwd.prompt': '请输入密码继续访问',
            'pwd.placeholder': '密码...',
            'pwd.submit': '提交',
            'pwd.cancel': '取消',
            'pwd.error': '密码错误，请重试',

            // 页脚（三页共用）
            'footer.copyright': '© 2025 LibreTV - 自由观影，畅享精彩',
            'footer.disclaimer': '免责声明：本站仅为视频搜索工具，不存储、上传或分发任何视频内容。所有视频均来自第三方API接口。如有侵权，请联系相关内容提供方。',
            'footer.home': '首页',
            'footer.about': '关于我们',
            'footer.privacy': '隐私政策',
            'footer.donate': '捐赠',

            // 播放页
            'player.back': '上一页',
            'player.loadingVideo': '正在加载视频...',
            'player.loadFailed': '视频加载失败',
            'player.loadFailedSub': '请尝试其他视频源或稍后重试',
            'player.prevEp': '上一集',
            'player.nextEp': '下一集',
            'player.autoplay': '自动连播',
            'player.reverseOrder': '倒序排列',
            'player.copyLink': '复制播放链接',
            'player.lockControl': '锁定控制',
            'player.subtitle': '字幕',
            'player.subDetected1': '检测到 ',
            'player.subDetected2': ' 条内嵌字幕',
            'player.subOff': '字幕已关闭',
            'player.subSwitch': '字幕：',
            'player.subTrack': '字幕',
            'player.subLoad': '加载本地字幕…',
            'player.subDisable': '关闭字幕',
            'player.subLoaded': '已加载字幕：',
            'player.subFormatErr': '不支持的字幕格式（支持 srt/vtt/ass）',
            'player.subLoadErr': '字幕加载失败',
            'player.subNoPlayer': '播放器未就绪，请稍后再试',

            // 关于页
            'about.heading': '关于LibreTV',
            'about.backHome': '回到首页',
            'about.intro': 'LibreTV 是一个免费的在线视频搜索平台，提供视频搜索和播放服务，致力于为用户带来最佳体验。',
            'about.githubIntro': '本项目代码托管在 GitHub 上，欢迎访问我们的仓库：',
            'about.visitGithub': '访问 GitHub 仓库',
            'about.privacyTitle': '隐私政策',
            'about.dataProtection': '数据保护',
            'about.dataProtectionBody': '我们尊重并保护您的隐私。LibreTV 不收集任何个人数据，且不会限制访问或使用本网站。',
            'about.serviceDesc': '服务说明',
            'about.serviceDescBody': '本平台仅用于提供在线视频搜索与播放服务。所有数据均由第三方接口提供，我们不会存储或追踪用户信息。',
            'about.copyrightTitle': '版权声明与投诉机制',
            'about.disclaimerHeading': '免责声明',
            'about.disclaimerBody': 'LibreTV 仅提供视频搜索服务，不直接提供、存储或上传任何视频内容。所有搜索结果均来自第三方公开接口。用户在使用本站服务时，须遵守相关法律法规，不得利用搜索结果从事侵权行为，如下载、传播未经授权的作品等。',
            'about.complaintHeading': '投诉反馈',
            'about.complaintIntro': '若您是版权方或相关权利人，发现本站搜索结果中存在侵犯您合法权益的内容，请通过以下渠道向我们反馈：',
            'about.complaintEmail': '投诉邮箱：',
            'about.complaintFooter': '请在投诉邮件中提供：您的身份证明、权利证明、侵权内容的具体链接及相关说明。我们将在收到投诉后尽快处理，对于确认侵权的内容，将立即断开相关链接，停止展示侵权内容，并将处理结果反馈给您。',

            // 切换提示
            'toast.switched': '已切换到中文',
            'toast.userSaved': '已保存用户名，历史已与云端同步',
            'toast.userCleared': '已清除用户名，停止云同步（历史仅保存在本地）',
            'toast.syncFail': '云同步不可用（KV 未配置或网络问题），已仅保存在本地',
            'toast.proxySaved': '已保存代理地址，刷新后生效',
            'toast.proxyReset': '已恢复默认代理（同源 /proxy/），刷新后生效',
            'toast.proxyInvalid': '代理地址需以 http:// 或 https:// 开头',
            'toast.favAdded': '已收藏',
            'toast.favRemoved': '已取消收藏',
            'toast.favCleared': '收藏已清空',
        },
        en: {
            'title.index': 'LibreTV - Free Online Video Search & Streaming',
            'title.player': 'LibreTV Player',
            'title.about': 'About Us - LibreTV',

            'common.loading': 'Loading...',

            'nav.history': 'Watch History',
            'nav.theme': 'Switch Theme',
            'nav.settings': 'Open Settings',
            'nav.language': 'Switch Language / 切换语言',

            'history.title': 'Watch History',
            'history.panelAria': 'Watch History',
            'history.empty': 'No watch history yet',
            'history.clear': 'Clear History',
            'nav.favorites': 'Favorites',
            'fav.title': 'My Favorites',
            'fav.empty': 'No favorites yet',
            'fav.clear': 'Clear Favorites',
            'fav.save': 'Favorite',
            'fav.saved': 'Favorited',
            'fav.remove': 'Remove',
            'fav.openFail': "Can't open this favorite",
            'fav.episodes1': '',
            'fav.episodes2': ' eps',
            'account.title': 'Account',
            'account.login': 'Sign in',
            'account.logout': 'Sign out',
            'account.register': 'Register',
            'account.username': 'Username',
            'account.password': 'Password',
            'account.invite': 'Admin password (invite code)',
            'account.toRegister': "No account? Register",
            'account.toLogin': 'Have an account? Sign in',
            'account.welcome': 'Signed in',
            'account.registered': 'Registered and signed in',
            'account.loggedOut': 'Signed out',
            'account.failed': 'Operation failed',
            'account.needUserPass': 'Enter username and password',

            'settings.title': 'Settings',
            'settings.panelAria': 'Settings panel',
            'settings.dataSource': 'Data Sources',
            'settings.selectAll': 'Select All',
            'settings.deselectAll': 'Deselect All',
            'settings.selectNormal': 'Select Normal',
            'settings.selectedCount': 'Selected APIs: ',
            'settings.customApi': 'Custom APIs',
            'settings.customApiNamePlaceholder': 'API name',
            'settings.customApiDetailPlaceholder': 'Detail URL (optional)',
            'settings.adultResource': 'Adult resource site',
            'settings.add': 'Add',
            'settings.cancel': 'Cancel',
            'settings.featureSwitch': 'Feature Toggles',
            'settings.yellowFilter': 'Adult Content Filter',
            'settings.yellowFilterDesc': 'Filter adult content such as "ethical films"',
            'settings.adFilter': 'Segment Ad Filter',
            'settings.adFilterDesc': 'Disable to reduce lag on older browsers',
            'settings.douban': 'Douban Recommendations',
            'settings.doubanDesc': 'Show Douban trending titles on the homepage',
            'settings.maxPerf': 'High-Performance Enhancement',
            'settings.maxPerfDesc': 'Uncapped enhancement resolution, maxing out GPU supersampling (sharper on powerful/dedicated GPUs; use with caution on weaker machines)',
            'settings.tmdbTitle': 'Available Platforms (Netflix / Disney+, etc.)',
            'settings.tmdbDesc': 'Show legal streaming platforms for a title in its details and link out. Requires a free TMDB API Key (<a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:underline">get one here</a>). Leave empty to disable.',
            'settings.tmdbRegionPlaceholder': 'Region (e.g. US/HK/TW)',
            'settings.save': 'Save',
            'settings.historySync': 'Cloud History Sync',
            'settings.historySyncDesc': 'Set a username to bind your watch history and save it in the cloud (KV), shared across devices. Leave empty to keep it local only.',
            'settings.usernamePlaceholder': 'Username (empty = local only)',
            'settings.usernameSave': 'Save & Sync',
            'settings.customProxy': 'Custom Proxy URL',
            'settings.customProxyDesc': 'Point to your own /proxy/ endpoint to switch region/node (affects search & detail requests only, not video segments). Empty = default. Reload to take effect.',
            'settings.generalFunc': 'General',
            'settings.importConfig': 'Import Config',
            'settings.exportConfig': 'Export Config',
            'settings.clearCookie': 'Clear Cookies',

            'index.slogan': 'Free viewing, enjoy the show',
            'search.home': 'Home',
            'search.homeAria': 'Back to home',
            'search.placeholder': 'Search for videos you like...',
            'search.inputAria': 'Video search box',
            'search.clearAria': 'Clear search box',
            'search.button': 'Search',
            'search.buttonAria': 'Search button',
            'search.recentAria': 'Recent searches',

            'douban.title': 'Douban Trending',
            'douban.movie': 'Movies',
            'douban.tv': 'TV Shows',
            'douban.refresh': 'Refresh',

            'results.countSuffix': ' results',

            'disclaimer.title': 'Terms of Use',
            'disclaimer.intro': 'Welcome to LibreTV. Before you begin, please read and agree to the following terms:',
            'disclaimer.service': '<strong class="text-blue-400">Service nature:</strong> LibreTV only provides a video search service and does not directly provide, store or upload any video content. All search results come from third-party public interfaces.',
            'disclaimer.userResp': '<strong class="text-blue-400">User responsibility:</strong> When using this site, you must comply with applicable laws and regulations, and must not use search results for infringing activities such as downloading or distributing unauthorized works.',
            'disclaimer.adRisk': '<strong class="text-blue-400">Ad risk warning:</strong> All videos on this site come from third-party scraping sites. Ads appearing in videos are unrelated to this site — do not trust or click any ad inside a video, and beware of scams.',
            'disclaimer.accept': 'I understand and accept',

            'pwd.title': 'Access Verification',
            'pwd.prompt': 'Please enter the password to continue',
            'pwd.placeholder': 'Password...',
            'pwd.submit': 'Submit',
            'pwd.cancel': 'Cancel',
            'pwd.error': 'Incorrect password, please try again',

            'footer.copyright': '© 2025 LibreTV - Free viewing, enjoy the show',
            'footer.disclaimer': 'Disclaimer: This site is only a video search tool and does not store, upload or distribute any video content. All videos come from third-party API interfaces. For any infringement, please contact the relevant content provider.',
            'footer.home': 'Home',
            'footer.about': 'About Us',
            'footer.privacy': 'Privacy Policy',
            'footer.donate': 'Donate',

            'player.back': 'Back',
            'player.loadingVideo': 'Loading video...',
            'player.loadFailed': 'Video failed to load',
            'player.loadFailedSub': 'Please try another source or retry later',
            'player.prevEp': 'Previous',
            'player.nextEp': 'Next',
            'player.autoplay': 'Autoplay',
            'player.reverseOrder': 'Reverse Order',
            'player.copyLink': 'Copy play link',
            'player.lockControl': 'Lock controls',
            'player.subtitle': 'Subtitles',
            'player.subDetected1': 'Detected ',
            'player.subDetected2': ' embedded subtitle track(s)',
            'player.subOff': 'Subtitles off',
            'player.subSwitch': 'Subtitles: ',
            'player.subTrack': 'Track',
            'player.subLoad': 'Load subtitle file…',
            'player.subDisable': 'Turn off subtitles',
            'player.subLoaded': 'Subtitle loaded: ',
            'player.subFormatErr': 'Unsupported format (srt/vtt/ass)',
            'player.subLoadErr': 'Failed to load subtitle',
            'player.subNoPlayer': 'Player not ready, please try again',

            'about.heading': 'About LibreTV',
            'about.backHome': 'Back to Home',
            'about.intro': 'LibreTV is a free online video search platform offering video search and playback, dedicated to delivering the best experience for users.',
            'about.githubIntro': 'This project is hosted on GitHub. Feel free to visit our repository:',
            'about.visitGithub': 'Visit GitHub Repo',
            'about.privacyTitle': 'Privacy Policy',
            'about.dataProtection': 'Data Protection',
            'about.dataProtectionBody': 'We respect and protect your privacy. LibreTV does not collect any personal data and does not restrict access to or use of this website.',
            'about.serviceDesc': 'Service Description',
            'about.serviceDescBody': 'This platform is solely for providing online video search and playback. All data is provided by third-party interfaces; we do not store or track user information.',
            'about.copyrightTitle': 'Copyright Notice & Complaint Mechanism',
            'about.disclaimerHeading': 'Disclaimer',
            'about.disclaimerBody': 'LibreTV only provides a video search service and does not directly provide, store or upload any video content. All search results come from third-party public interfaces. When using this site, users must comply with applicable laws and regulations, and must not use search results for infringing activities such as downloading or distributing unauthorized works.',
            'about.complaintHeading': 'Complaints & Feedback',
            'about.complaintIntro': 'If you are a copyright holder or rights owner and find content in our search results that infringes your legal rights, please contact us through the following channel:',
            'about.complaintEmail': 'Complaint email: ',
            'about.complaintFooter': 'In your complaint email, please provide: proof of your identity, proof of rights, the specific links to the infringing content, and a relevant description. We will handle the complaint as soon as possible. For content confirmed to be infringing, we will immediately remove the relevant links, stop displaying the infringing content, and report the outcome back to you.',

            'toast.switched': 'Switched to English',
            'toast.userSaved': 'Username saved; history synced with the cloud',
            'toast.userCleared': 'Username cleared; cloud sync off (history kept locally)',
            'toast.syncFail': 'Cloud sync unavailable (KV not configured or network issue); saved locally only',
            'toast.proxySaved': 'Proxy URL saved; reload to take effect',
            'toast.proxyReset': 'Reverted to the default proxy (same-origin /proxy/); reload to take effect',
            'toast.proxyInvalid': 'Proxy URL must start with http:// or https://',
            'toast.favAdded': 'Added to favorites',
            'toast.favRemoved': 'Removed from favorites',
            'toast.favCleared': 'Favorites cleared',
        },
    };

    function getLang() {
        let l = 'zh';
        try { l = localStorage.getItem(KEY) || 'zh'; } catch (e) {}
        return LANGS.includes(l) ? l : 'zh';
    }

    // 取翻译；缺失时回退到 key 字面量，便于发现漏标
    function t(key, lang) {
        const L = lang || getLang();
        const table = STRINGS[L] || STRINGS.zh;
        return (key in table) ? table[key] : key;
    }

    function applyLang(lang) {
        if (!LANGS.includes(lang)) lang = 'zh';
        const doc = document;

        doc.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh');

        // 文本节点
        doc.querySelectorAll('[data-i18n]').forEach(function (el) {
            const v = t(el.getAttribute('data-i18n'), lang);
            if (v != null) el.textContent = v;
        });
        // 含内联标签的富文本
        doc.querySelectorAll('[data-i18n-html]').forEach(function (el) {
            const v = t(el.getAttribute('data-i18n-html'), lang);
            if (v != null) el.innerHTML = v;
        });
        // 属性型
        [['data-i18n-placeholder', 'placeholder'],
         ['data-i18n-title', 'title'],
         ['data-i18n-aria-label', 'aria-label']].forEach(function (pair) {
            doc.querySelectorAll('[' + pair[0] + ']').forEach(function (el) {
                const v = t(el.getAttribute(pair[0]), lang);
                if (v != null) el.setAttribute(pair[1], v);
            });
        });

        // 文档标题（页面通过 <html data-i18n-doctitle="title.xxx"> 指定）
        const titleKey = doc.documentElement.getAttribute('data-i18n-doctitle');
        if (titleKey) doc.title = t(titleKey, lang);

        // 语言按钮：显示点击后将切到的目标语言
        const btn = doc.getElementById('langToggleBtn');
        if (btn) {
            const label = btn.querySelector('.lang-label');
            if (label) label.textContent = (lang === 'zh') ? 'EN' : '中';
        }
    }

    function setLang(l) {
        if (!LANGS.includes(l)) l = 'zh';
        try { localStorage.setItem(KEY, l); } catch (e) {}
        applyLang(l);
        if (typeof global.showToast === 'function') {
            global.showToast(t('toast.switched', l), 'success');
        }
    }

    function toggleLang() {
        setLang(getLang() === 'zh' ? 'en' : 'zh');
    }

    // 立即应用（脚本可能在 body 末尾加载；早期内联脚本已先设过 lang 属性以防闪烁）
    applyLang(getLang());
    document.addEventListener('DOMContentLoaded', function () { applyLang(getLang()); });

    global.toggleLang = toggleLang;
    global.setLang = setLang;
    global.getLang = getLang;
    global.t = t;
})(window);
