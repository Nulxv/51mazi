import { app, shell, BrowserWindow, ipcMain, dialog, nativeImage, screen } from 'electron'
import { join, resolve } from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import Store from 'electron-store'
import dayjs from 'dayjs'
const MAIN_I18N_MESSAGES = {
  'zh-CN': {
    appTitle: '51码字',
    imageFiles: '图片文件',
    allFiles: '所有文件',
    saveFile: '保存文件',
    textFiles: '文本文件',
    save: '保存'
  },
  'en-US': {
    appTitle: '51Mazi',
    imageFiles: 'Image Files',
    allFiles: 'All Files',
    saveFile: 'Save File',
    textFiles: 'Text Files',
    save: 'Save'
  }
}

function mt(key) {
  const locale = String(store?.get('config.locale') || 'zh-CN')
  const l = locale.startsWith('en') ? 'en-US' : 'zh-CN'
  return MAIN_I18N_MESSAGES[l]?.[key] || MAIN_I18N_MESSAGES['zh-CN'][key] || key
}

// macOS 图标获取函数
// 注意：nativeImage 只支持 PNG 和 JPEG 格式，不支持 .icns
// .icns 文件仅用于打包后的应用图标，由 electron-builder 自动处理
// 开发环境使用 PNG 文件来设置 Dock 图标
function getMacIcon() {
  if (process.platform !== 'darwin') {
    return null
  }

  // 只在开发环境设置 Dock 图标
  // 生产环境的图标由 electron-builder 自动处理，不需要手动设置
  if (!is.dev) {
    return null
  }

  // 开发环境：使用 PNG 文件（nativeImage 支持 PNG 和 JPEG）
  const projectRoot = process.cwd()
  // 优先使用 build/icon.png，如果没有则使用 resources/icon.png
  let iconPath = join(projectRoot, 'build/icon.png')
  if (!fs.existsSync(iconPath)) {
    iconPath = join(projectRoot, 'resources/icon.png')
  }

  // 检查文件是否存在
  if (!fs.existsSync(iconPath)) {
    console.warn('未找到图标文件，跳过设置 Dock 图标')
    return null
  }

  // 注意：nativeImage 只支持 PNG 和 JPEG 格式，不支持 .icns
  try {
    const image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) {
      console.warn('图标文件为空或无法读取:', iconPath)
      return null
    }
    return image
  } catch (error) {
    console.warn('加载图标失败:', iconPath, error.message)
    return null
  }
}

// 创建 store 实例
const store = new Store({
  // 可以设置加密
  // encryptionKey: 'your-encryption-key',

  // 可以设置加密
  defaults: {
    config: {
      theme: 'light',
      booksDir: ''
      // 其他默认配置...
    }
  }
})

const PROTECTED_STORE_KEYS = new Set([
  'bookshelfPassword',
  'bookshelfPasswordHash',
  'bookshelfPasswordSalt'
])

const BOOK_PASSWORD_FIELD_KEYS = ['password', 'passwordHash', 'passwordSalt']
const DEFAULT_BOOKS_DIR = join('D:\\Word\\小说', '51')

function isProtectedStoreKey(key) {
  return PROTECTED_STORE_KEYS.has(String(key || ''))
}

function hashBookshelfPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const normalizedPassword = String(password || '')
  const hash = crypto.scryptSync(normalizedPassword, salt, 64).toString('hex')
  return { salt, hash }
}

function getBookshelfPasswordRecord() {
  const legacyPassword = store.get('bookshelfPassword')
  const passwordHash = store.get('bookshelfPasswordHash')
  const passwordSalt = store.get('bookshelfPasswordSalt')

  return {
    legacyPassword: typeof legacyPassword === 'string' ? legacyPassword : '',
    hash: typeof passwordHash === 'string' ? passwordHash : '',
    salt: typeof passwordSalt === 'string' ? passwordSalt : ''
  }
}

function hasBookshelfPasswordConfigured() {
  const record = getBookshelfPasswordRecord()
  return Boolean(record.legacyPassword || (record.hash && record.salt))
}

function persistBookshelfPassword(password) {
  const { hash, salt } = hashBookshelfPassword(password)
  store.set('bookshelfPasswordHash', hash)
  store.set('bookshelfPasswordSalt', salt)
  store.delete('bookshelfPassword')
}

function clearBookshelfPassword() {
  store.delete('bookshelfPassword')
  store.delete('bookshelfPasswordHash')
  store.delete('bookshelfPasswordSalt')
  bookshelfAuthenticated = false
}

function verifyBookshelfPassword(password) {
  const candidate = String(password || '')
  const record = getBookshelfPasswordRecord()

  if (record.hash && record.salt) {
    const candidateHash = crypto.scryptSync(candidate, record.salt, 64)
    const storedHash = Buffer.from(record.hash, 'hex')
    if (candidateHash.length !== storedHash.length) return false
    return crypto.timingSafeEqual(candidateHash, storedHash)
  }

  if (record.legacyPassword) {
    const matched = candidate === record.legacyPassword
    if (matched) {
      persistBookshelfPassword(candidate)
    }
    return matched
  }

  return false
}

function sanitizeBookFolderName(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '_')
}

function ensureDirectoryExists(dirPath) {
  const normalizedPath = String(dirPath || '').trim()
  if (!normalizedPath) {
    throw new Error('Directory path is required')
  }
  if (!fs.existsSync(normalizedPath)) {
    fs.mkdirSync(normalizedPath, { recursive: true })
  }
  return normalizedPath
}

function hashBookPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const normalizedPassword = String(password || '')
  const hash = crypto.scryptSync(normalizedPassword, salt, 64).toString('hex')
  return { salt, hash }
}

function getBookPasswordRecord(meta) {
  return {
    legacyPassword: typeof meta?.password === 'string' ? meta.password : '',
    hash: typeof meta?.passwordHash === 'string' ? meta.passwordHash : '',
    salt: typeof meta?.passwordSalt === 'string' ? meta.passwordSalt : ''
  }
}

function hasBookPassword(meta) {
  const record = getBookPasswordRecord(meta)
  return Boolean(record.legacyPassword || (record.hash && record.salt))
}

function clearBookPasswordFields(meta) {
  for (const key of BOOK_PASSWORD_FIELD_KEYS) {
    delete meta[key]
  }
}

function setBookPasswordFields(meta, password) {
  clearBookPasswordFields(meta)
  const normalizedPassword = String(password || '').trim()
  if (!normalizedPassword) return
  const { hash, salt } = hashBookPassword(normalizedPassword)
  meta.passwordHash = hash
  meta.passwordSalt = salt
}

function verifyBookPassword(meta, password) {
  const candidate = String(password || '')
  const record = getBookPasswordRecord(meta)

  if (record.hash && record.salt) {
    const candidateHash = crypto.scryptSync(candidate, record.salt, 64)
    const storedHash = Buffer.from(record.hash, 'hex')
    if (candidateHash.length !== storedHash.length) return false
    return crypto.timingSafeEqual(candidateHash, storedHash)
  }

  return Boolean(record.legacyPassword) && candidate === record.legacyPassword
}

function normalizeBookMetaPrivacy(meta) {
  const normalizedMeta = meta && typeof meta === 'object' ? { ...meta } : {}
  const record = getBookPasswordRecord(normalizedMeta)
  if (record.legacyPassword) {
    setBookPasswordFields(normalizedMeta, record.legacyPassword)
  } else if (!(record.hash && record.salt)) {
    clearBookPasswordFields(normalizedMeta)
  }
  return normalizedMeta
}

function sanitizeBookMetaForRenderer(meta) {
  const normalizedMeta = normalizeBookMetaPrivacy(meta)
  const protectedBook = hasBookPassword(normalizedMeta)
  clearBookPasswordFields(normalizedMeta)
  return {
    ...normalizedMeta,
    password: protectedBook,
    hasPassword: protectedBook
  }
}

ipcMain.handle('store:get', async (_, key) => {
  if (isProtectedStoreKey(key)) return undefined
  return store.get(key)
})

ipcMain.handle('store:set', async (_, key, value) => {
  if (isProtectedStoreKey(key)) {
    throw new Error('Direct access to protected store key is denied')
  }
  store.set(key, value)
  return true
})

ipcMain.handle('store:delete', async (_, key) => {
  if (isProtectedStoreKey(key)) {
    throw new Error('Direct access to protected store key is denied')
  }
  store.delete(key)
  return true
})

// 书架密码认证状态：仅在当前进程运行期间有效，重启后自动重置
let bookshelfAuthenticated = false

// 设置书架已认证（由认证页面在密码验证通过后调用）
ipcMain.handle('auth:set-bookshelf-authenticated', () => {
  bookshelfAuthenticated = true
  return true
})

// 查询书架认证状态（由路由守卫在所有窗口中调用）
ipcMain.handle('auth:get-bookshelf-authenticated', () => {
  return bookshelfAuthenticated
})

ipcMain.handle('auth:has-bookshelf-password', () => {
  return hasBookshelfPasswordConfigured()
})

ipcMain.handle('auth:verify-bookshelf-password', async (_, password) => {
  const success = verifyBookshelfPassword(password)
  if (success) {
    bookshelfAuthenticated = true
  }
  return { success }
})

ipcMain.handle('auth:set-bookshelf-password', async (_, password) => {
  persistBookshelfPassword(password)
  return { success: true }
})

ipcMain.handle('auth:update-bookshelf-password', async (_, { oldPassword, newPassword }) => {
  if (!verifyBookshelfPassword(oldPassword)) {
    return { success: false, code: 'INVALID_OLD_PASSWORD' }
  }

  const normalizedNewPassword = String(newPassword || '').trim()
  if (!normalizedNewPassword) {
    clearBookshelfPassword()
    return { success: true, removed: true }
  }

  persistBookshelfPassword(normalizedNewPassword)
  return { success: true, removed: false }
})

ipcMain.handle('auth:verify-book-password', async (_, { bookName, password }) => {
  try {
    const booksDir = store.get('booksDir')
    const resolvedBookName = sanitizeBookFolderName(bookName)
    if (!booksDir || !resolvedBookName) {
      return { success: false }
    }

    const metaPath = join(booksDir, resolvedBookName, 'mazi.json')
    if (!fs.existsSync(metaPath)) {
      return { success: false }
    }

    const meta = normalizeBookMetaPrivacy(JSON.parse(fs.readFileSync(metaPath, 'utf-8')))
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    return { success: verifyBookPassword(meta, password) }
  } catch (error) {
    console.error('verify-book-password failed:', error)
    return { success: false }
  }
})

// 维护已打开书籍编辑窗口的映射
const bookEditorWindows = new Map()

// 维护主窗口引用（用于发送更新消息）
let mainWindow = null

// -------------------- Window state persistence --------------------
function getWindowStateKey(name) {
  return `windowState:${name}`
}

function isFiniteNumber(n) {
  return Number.isFinite(n)
}

function isValidBounds(bounds) {
  return (
    bounds &&
    isFiniteNumber(bounds.width) &&
    isFiniteNumber(bounds.height) &&
    bounds.width >= 200 &&
    bounds.height >= 200 &&
    // x/y 允许为 undefined（让 Electron 自己居中）
    (bounds.x === undefined || isFiniteNumber(bounds.x)) &&
    (bounds.y === undefined || isFiniteNumber(bounds.y))
  )
}

function isRectIntersect(a, b) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  )
}

function ensureVisibleOnSomeDisplay(bounds) {
  try {
    const displays = screen.getAllDisplays()
    const target = {
      x: bounds.x ?? 0,
      y: bounds.y ?? 0,
      width: bounds.width,
      height: bounds.height
    }

    // 如果没有 x/y（让 Electron 自动定位），直接认为可用
    if (bounds.x === undefined || bounds.y === undefined) return true

    return displays.some((d) => isRectIntersect(target, d.workArea))
  } catch {
    return true
  }
}

function loadWindowState(name, fallbackBounds) {
  const raw = store.get(getWindowStateKey(name)) || {}
  const bounds = isValidBounds(raw.bounds) ? raw.bounds : fallbackBounds

  // 如果保存的窗口位置已经不在任何显示器可视区域（比如拔掉显示器），则回退到默认 bounds
  const finalBounds = bounds && ensureVisibleOnSomeDisplay(bounds) ? bounds : fallbackBounds

  return {
    bounds: finalBounds,
    isMaximized: Boolean(raw.isMaximized)
  }
}

function saveWindowState(name, win) {
  if (!win || win.isDestroyed()) return
  // 最小化时不保存（避免保存成 0x0 或奇怪位置）
  if (win.isMinimized()) return

  const isMaximized = win.isMaximized()
  const bounds =
    isMaximized && typeof win.getNormalBounds === 'function'
      ? win.getNormalBounds()
      : win.getBounds()

  if (!isValidBounds(bounds)) return

  store.set(getWindowStateKey(name), { bounds, isMaximized })
}

function attachWindowStatePersistence(name, win) {
  let timer = null
  const scheduleSave = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => saveWindowState(name, win), 250)
  }

  win.on('move', scheduleSave)
  win.on('resize', scheduleSave)
  win.on('maximize', scheduleSave)
  win.on('unmaximize', scheduleSave)
  win.on('close', () => saveWindowState(name, win))
}
function createWindow() {
  // 获取 macOS 图标
  const macIcon = getMacIcon()

  // Create the browser window.
  const mainWindowState = loadWindowState('main', {
    width: 1100,
    height: 800
  })

  mainWindow = new BrowserWindow({
    title: mt('appTitle'),
    ...mainWindowState.bounds,
    minWidth: 1100,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    // 设置窗口图标：Linux 使用 PNG，macOS 使用 ICNS
    ...(process.platform === 'linux' ? { icon } : {}),
    ...(process.platform === 'darwin' && macIcon ? { icon: macIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  attachWindowStatePersistence('main', mainWindow)

  mainWindow.on('ready-to-show', () => {
    if (mainWindowState.isMaximized) mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const parsed = (() => { try { return new URL(details.url) } catch { return null } })()
    if (!parsed || !['https:', 'mailto:'].includes(parsed.protocol)) {
      return { action: 'deny' }
    }
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  // 建议与 electron-builder 的 appId 保持一致（影响任务栏归属/通知分组/安装识别等）
  // 注意：该值对已发布的 Windows 应用尽量保持不变，否则可能影响旧版本升级链路
  electronApp.setAppUserModelId('com.51mazi.desktop')

  // 在 macOS 上设置 Dock 图标（开发环境）
  // 注意：开发环境中系统不会自动应用 squircle，所以我们需要使用已经应用了 squircle 的图标
  // 图标文件应该已经通过 add-squircle.py 脚本处理过
  const macIcon = getMacIcon()
  if (process.platform === 'darwin' && macIcon) {
    try {
      app.dock.setIcon(macIcon)
    } catch (error) {
      console.warn('设置 Dock 图标失败:', error.message)
    }
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

// 获取默认书籍目录
ipcMain.handle('get-default-books-dir', async () => {
  return ensureDirectoryExists(DEFAULT_BOOKS_DIR)
})

// 选择书籍目录
ipcMain.handle('select-books-dir', async () => {
  const currentBooksDir = String(store.get('booksDir') || '').trim()
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: currentBooksDir || DEFAULT_BOOKS_DIR,
    properties: ['openDirectory']
  })
  return result
})

// 校验书籍目录：用于系统设置确认前给出可读错误
ipcMain.handle('validate-books-dir', async (event, dirPath, options = {}) => {
  try {
    if (!dirPath || typeof dirPath !== 'string') {
      return { valid: false, code: 'EMPTY' }
    }
    const normalizedPath = String(dirPath).trim()
    if (!fs.existsSync(normalizedPath) && options?.allowCreate) {
      ensureDirectoryExists(normalizedPath)
    }
    if (!fs.existsSync(normalizedPath)) {
      return { valid: false, code: 'NOT_EXISTS' }
    }
    const stat = fs.statSync(normalizedPath)
    if (!stat.isDirectory()) {
      return { valid: false, code: 'NOT_DIRECTORY' }
    }
    try {
      fs.accessSync(normalizedPath, fs.constants.R_OK)
    } catch {
      return { valid: false, code: 'NOT_READABLE' }
    }
    try {
      fs.accessSync(normalizedPath, fs.constants.W_OK)
    } catch {
      return { valid: false, code: 'NOT_WRITABLE' }
    }
    return { valid: true, path: normalizedPath }
  } catch (error) {
    console.error('validate-books-dir failed:', error)
    return { valid: false, code: 'UNKNOWN' }
  }
})

// 选择图片文件
ipcMain.handle('select-image', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: mt('imageFiles'), extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
      { name: mt('allFiles'), extensions: ['*'] }
    ]
  })

  if (!result.canceled && result.filePaths.length > 0) {
    return { filePath: result.filePaths[0] }
  }

  return null
})

// 选择保存文件路径
ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog({
    title: options.title || mt('saveFile'),
    defaultPath: options.defaultPath || '',
    filters: options.filters || [{ name: mt('textFiles'), extensions: ['txt'] }],
    buttonLabel: options.buttonLabel || mt('save')
  })

  if (!result.canceled && result.filePath) {
    return { filePath: result.filePath }
  }

  return null
})

// 写入导出文件
ipcMain.handle('write-export-file', async (event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('写入导出文件失败:', error)
    return { success: false, message: error.message || '閸愭瑥鍙嗛弬鍥︽婢惰精瑙?' }
  }
})


// 创建书籍
ipcMain.handle('create-book', async (event, bookInfo) => {
  // 1. 处理文件夹名合法性
  const safeName = sanitizeBookFolderName(bookInfo.name)
  const booksDir = ensureDirectoryExists(store.get('booksDir'))
  const bookPath = join(booksDir, safeName)
  if (!fs.existsSync(bookPath)) {
    fs.mkdirSync(bookPath)
  }

  // 2. 处理封面图片（如果有）
  let coverUrl = bookInfo.coverUrl || null
  if (bookInfo.coverImagePath && fs.existsSync(bookInfo.coverImagePath)) {
    try {
      // 获取文件扩展名
      const ext = bookInfo.coverImagePath.split('.').pop()?.toLowerCase() || 'jpg'
      const coverFileName = `cover.${ext}`
      const coverPath = join(bookPath, coverFileName)
      // 复制图片文件
      fs.copyFileSync(bookInfo.coverImagePath, coverPath)
      coverUrl = coverFileName
    } catch (error) {
      console.error('复制封面图片失败:', error)
    }
  }

  // 3. 写入 mazi.json（移除临时字段 coverImagePath）
  // eslint-disable-next-line no-unused-vars
  const { coverImagePath, ...bookData } = bookInfo
  const meta = {
    ...bookData,
    coverUrl,
    createdAt: dayjs().format('YYYY/MM/DD HH:mm:ss'),
    updatedAt: dayjs().format('YYYY/MM/DD HH:mm:ss')
  }
  setBookPasswordFields(meta, bookInfo.password)
  fs.writeFileSync(join(bookPath, 'mazi.json'), JSON.stringify(meta, null, 2), 'utf-8')

  // 3. 创建正文和笔记文件夹
  const textPath = join(bookPath, '濮濓絾鏋?')
  fs.mkdirSync(textPath, { recursive: true })
  const notesPath = join(bookPath, '缁楁棁顔?')
  fs.mkdirSync(notesPath, { recursive: true })

  // 4. 默认创建一个正文卷
  const volumePath = join(textPath, '濮濓絾鏋?')
  fs.mkdirSync(volumePath, { recursive: true })

  // 5. 在默认卷中创建第1章文件
  const chapterPath = join(volumePath, '缁?缁?txt')
  fs.writeFileSync(chapterPath, '')

  // 6. 在笔记文件夹中创建大纲、设定、人物三个默认笔记本文件夹
  fs.mkdirSync(join(notesPath, '婢堆呯堪'), { recursive: true })
  fs.mkdirSync(join(notesPath, '鐠佹儳鐣?'), { recursive: true })
  fs.mkdirSync(join(notesPath, '娴滆櫣澧?'), { recursive: true })

  return true
})

// 读取书籍目录
ipcMain.handle('read-books-dir', async () => {
  const books = []
  const booksDir = store.get('booksDir')
  if (!booksDir || typeof booksDir !== 'string') return books
  ensureDirectoryExists(booksDir)
  let files = []
  try {
    files = fs.readdirSync(booksDir, { withFileTypes: true })
  } catch (error) {
    console.error('read-books-dir failed to read directory:', error)
    return books
  }
  for (const file of files) {
    if (file.isDirectory()) {
      const metaPath = join(booksDir, file.name, 'mazi.json')
      if (fs.existsSync(metaPath)) {
        try {
          const meta = normalizeBookMetaPrivacy(JSON.parse(fs.readFileSync(metaPath, 'utf-8')))
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
          // 返回 meta 并带上实际目录名 folderName，供前端构建封面等路径使用（创建时目录名可能被 safeName 替换）
          books.push({ ...sanitizeBookMetaForRenderer(meta), folderName: file.name })
        } catch (e) {
          // ignore parse error
          console.error('read-books-dir', e)
        }
      }
    }
  }
  // 按updatedAt排序，最新的在前
  // updatedAt格式可能是 "2024/1/1 12:00:00" 或 ISO格式，需要统一处理
  books.sort((a, b) => {
    const dateA = a.updatedAt ? new Date(a.updatedAt) : new Date(0)
    const dateB = b.updatedAt ? new Date(b.updatedAt) : new Date(0)
    // 降序排序，最新的在前
    return dateB.getTime() - dateA.getTime()
  })
  return books
})

ipcMain.handle('get-book-word-count', async (event, bookName) => {
  if (!bookName) return 0
  try {
    const totalWords = await calculateBookWordCount(bookName)
    const booksDir = store.get('booksDir')
    if (booksDir) {
      const metaPath = join(booksDir, bookName, 'mazi.json')
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          meta.totalWords = totalWords
          meta.updatedAt = dayjs().format('YYYY/MM/DD HH:mm:ss')
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
        } catch (error) {
          console.error('更新书籍元数据失败:', error)
        }
      }
    }
    return totalWords
  } catch (error) {
    console.error('获取书籍总字数失败:', error)
    throw error
  }
})

// 删除书籍
ipcMain.handle('delete-book', async (event, { name }) => {
  try {
    const booksDir = store.get('booksDir')
    if (!booksDir) {
      return false
    }

    const bookPath = join(booksDir, sanitizeBookFolderName(name))

    if (!fs.existsSync(bookPath)) {
      return false
    }

    // 删除整个书籍文件夹
    fs.rmSync(bookPath, { recursive: true, force: true })
    return true
  } catch (error) {
    console.error('删除书籍失败:', error)
    return false
  }
})

// 编辑书籍
ipcMain.handle('edit-book', async (event, bookInfo) => {
  try {
    const booksDir = store.get('booksDir')

    // 如果传入了原始名称，使用原始名称定位文件夹
    const originalName = bookInfo.originalName || bookInfo.name
    let bookPath = join(booksDir, originalName)

    if (!fs.existsSync(bookPath)) {
      return { success: false, message: '娑旓妇鐫勬稉宥呯摠閸?' }
    }

    const metaPath = join(bookPath, 'mazi.json')

    // 读取现有元数据
    const existingMeta = normalizeBookMetaPrivacy(JSON.parse(fs.readFileSync(metaPath, 'utf-8')))

    // 处理封面图片（如果有新的封面图片）
    let coverUrl = bookInfo.coverUrl || existingMeta.coverUrl || null
    if (bookInfo.coverImagePath && fs.existsSync(bookInfo.coverImagePath)) {
      try {
        const ext = bookInfo.coverImagePath.split('.').pop()?.toLowerCase() || 'jpg'
        const coverFileName = `cover.${ext}`
        const coverPath = join(bookPath, coverFileName)
        const srcResolved = resolve(bookInfo.coverImagePath)
        const destResolved = resolve(coverPath)

        // 源已是书籍目录下的目标封面（如 AI 确认后表单仍带该绝对路径）：不能先删旧再拷自己，否则会 unlink 掉源文件导致 ENOENT
        if (srcResolved === destResolved) {
          if (existingMeta.coverUrl && existingMeta.coverUrl !== coverFileName) {
            const oldCoverPath = join(bookPath, existingMeta.coverUrl)
            const oldResolved = resolve(oldCoverPath)
            if (oldResolved !== srcResolved && fs.existsSync(oldCoverPath)) {
              fs.unlinkSync(oldCoverPath)
            }
          }
          coverUrl = coverFileName
        } else {
          if (existingMeta.coverUrl) {
            const oldCoverPath = join(bookPath, existingMeta.coverUrl)
            const oldResolved = resolve(oldCoverPath)
            if (oldResolved !== srcResolved && fs.existsSync(oldCoverPath)) {
              fs.unlinkSync(oldCoverPath)
            }
          }
          fs.copyFileSync(bookInfo.coverImagePath, coverPath)
          coverUrl = coverFileName
        }
      } catch (error) {
        console.error('复制封面图片失败:', error)
      }
    } else if (bookInfo.coverUrl === null || bookInfo.coverUrl === '') {
      // 如果明确设置为空，删除封面图片
      if (existingMeta.coverUrl) {
        const oldCoverPath = join(bookPath, existingMeta.coverUrl)
        if (fs.existsSync(oldCoverPath)) {
          fs.unlinkSync(oldCoverPath)
        }
      }
      coverUrl = null
    }

    // 仅更新元数据中的封面文件名、且未从 coverImagePath 复制新文件时，删除磁盘上的旧封面（如 cover.jpg → cover.png）
    if (
      !bookInfo.coverImagePath &&
      typeof bookInfo.coverUrl === 'string' &&
      bookInfo.coverUrl &&
      existingMeta.coverUrl &&
      bookInfo.coverUrl !== existingMeta.coverUrl
    ) {
      const oldCoverPath = join(bookPath, existingMeta.coverUrl)
      if (fs.existsSync(oldCoverPath)) {
        try {
          fs.unlinkSync(oldCoverPath)
        } catch (err) {
          console.error(`章节抓取失败: ${ch.title}`, err)
        }
      }
    }

    // 如果书名发生变化，需要重命名文件夹
    if (bookInfo.name !== originalName) {
      const newBookPath = join(booksDir, sanitizeBookFolderName(bookInfo.name))

      // 检查新名称是否已存在
      if (fs.existsSync(newBookPath)) {
        return { success: false, message: '瀹告彃鐡ㄩ崷銊ユ倱閸氬秳鍔熺猾?' }
      }

      // 重命名文件夹
      fs.renameSync(bookPath, newBookPath)
      bookPath = newBookPath

      // 更新元数据路径
      const newMetaPath = join(newBookPath, 'mazi.json')

      // 合并新旧数据，保留原有数据，移除临时字段
      // eslint-disable-next-line no-unused-vars
      const { coverImagePath, ...bookData } = bookInfo
      const mergedMeta = {
        ...existingMeta,
        ...bookData,
        coverUrl,
        updatedAt: dayjs().format('YYYY/MM/DD HH:mm:ss') // 閺囧瓨鏌婃穱顔芥暭閺冨爼妫?
      }
      if (String(bookData.password || '').trim()) {
        setBookPasswordFields(mergedMeta, bookData.password)
      } else {
        clearBookPasswordFields(mergedMeta)
        if (hasBookPassword(existingMeta)) {
          mergedMeta.passwordHash = existingMeta.passwordHash
          mergedMeta.passwordSalt = existingMeta.passwordSalt
        }
      }
      fs.writeFileSync(newMetaPath, JSON.stringify(mergedMeta, null, 2), 'utf-8')
    } else {
      // 书名未变化，直接更新元数据
      // eslint-disable-next-line no-unused-vars
      const { coverImagePath, ...bookData } = bookInfo
      const mergedMeta = {
        ...existingMeta,
        ...bookData,
        coverUrl,
        updatedAt: dayjs().format('YYYY/MM/DD HH:mm:ss') // 閺囧瓨鏌婃穱顔芥暭閺冨爼妫?
      }
      if (String(bookData.password || '').trim()) {
        setBookPasswordFields(mergedMeta, bookData.password)
      } else {
        clearBookPasswordFields(mergedMeta)
        if (hasBookPassword(existingMeta)) {
          mergedMeta.passwordHash = existingMeta.passwordHash
          mergedMeta.passwordSalt = existingMeta.passwordSalt
        }
      }
      fs.writeFileSync(metaPath, JSON.stringify(mergedMeta, null, 2), 'utf-8')
    }

    return { success: true }
  } catch (error) {
    console.error('编辑书籍失败:', error)
    return { success: false, message: error.message }
  }
})

// 打开书籍编辑窗口
ipcMain.handle('open-book-editor-window', async (event, { id, name }) => {
  if (bookEditorWindows.has(id)) {
    // 已有窗口，聚焦
    const win = bookEditorWindows.get(id)
    if (win && !win.isDestroyed()) {
      win.focus()
      return true
    }
  }
  // 获取 macOS 图标
  const macIcon = getMacIcon()

  const editorWindowState = loadWindowState('editor', {
    width: 1400,
    height: 800
  })

  // 新建窗口
  const editorWindow = new BrowserWindow({
    title: `${name} - ${mt('appTitle')}`,
    ...editorWindowState.bounds,
    minWidth: 1400,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    // 设置窗口图标：Linux 使用 PNG，macOS 使用 ICNS
    ...(process.platform === 'linux' ? { icon } : {}),
    ...(process.platform === 'darwin' && macIcon ? { icon: macIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      additionalArguments: [`bookId=${id}`, `bookName=${encodeURIComponent(name)}`]
    }
  })
  bookEditorWindows.set(id, editorWindow)
  attachWindowStatePersistence('editor', editorWindow)
  editorWindow.on('ready-to-show', () => {
    if (editorWindowState.isMaximized) editorWindow.maximize()
    editorWindow.show()
  })
  editorWindow.on('closed', () => {
    bookEditorWindows.delete(id)
  })
  // 页面加载完成后，确保窗口标题正确显示书籍名称
  editorWindow.webContents.on('did-finish-load', () => {
    editorWindow.setTitle(`${name} - ${mt('appTitle')}`)
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    // 直接跳转到编辑页
    editorWindow.loadURL(
      `${process.env['ELECTRON_RENDERER_URL']}#/editor?name=${encodeURIComponent(name)}`
    )
  } else {
    editorWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: `/editor?name=${encodeURIComponent(name)}`
    })
  }
  return true
})

function getVolumeOrderKey(bookName) {
  return `volumeOrder:${bookName}`
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function getDirCreateTimeMs(dirPath) {
  try {
    const st = fs.statSync(dirPath)
    // birthtimeMs 在大多数平台/文件系统上是创建时间；取不到时退回 ctime/mtime
    if (Number.isFinite(st.birthtimeMs) && st.birthtimeMs > 0) return st.birthtimeMs
    if (Number.isFinite(st.ctimeMs) && st.ctimeMs > 0) return st.ctimeMs
    if (Number.isFinite(st.mtimeMs) && st.mtimeMs > 0) return st.mtimeMs
    return 0
  } catch {
    return 0
  }
}

/**
 * 绾喕绻氶崡椋庢畱閳ユ粌鍨卞娲€庢惔蹇娾偓婵嗗帗閺佺増宓佺€涙ê婀稉鏂剧瑢绾句胶娲忛崥灞绢劄
 *
 * 缁撅箑鐣鹃敍姝穙lumeOrder 娣囨繂鐡ㄦ稉鐑樻＋ -> 閺傚府绱欓崚娑樼紦妞ゅ搫绨敍?
 * - 閺傛澘鍨卞铏规畱閸楄渹绱?push 閸掔増婀亸?
 * - 閼汇儳鏁ら幋宄版躬閺傚洣娆㈢化鑽ょ埠闁插本澧滈崝銊︽煀婢х偛宓庨惄顔肩秿閿涙碍瀵滈惄顔肩秿閸掓稑缂撻弮鍫曟？鐞涖儱鍩岄張顐㈢啲閿涘牊妫?>閺傚府绱?
 */
function ensureVolumeOrder(bookName, bookPath, volumeNames) {
  const key = getVolumeOrderKey(bookName)
  let order = asArray(store.get(key))

  // 清理：移除已不存在的卷
  order = order.filter((name) => volumeNames.includes(name))

  // 补全：把磁盘上存在但 order 中没有的卷补进来（按创建时间排序后追加）
  const missing = volumeNames.filter((name) => !order.includes(name))
  if (missing.length > 0) {
    const withTime = missing.map((name) => ({
      name,
      t: getDirCreateTimeMs(join(bookPath, '濮濓絾鏋?', name))
    }))
    withTime.sort((a, b) => a.t - b.t)
    order.push(...withTime.map((x) => x.name))
  }

  // 初始化：如果没有任何历史记录，则从磁盘创建时间推导一次（旧 -> 新）
  if (order.length === 0 && volumeNames.length > 0) {
    const withTime = volumeNames.map((name) => ({
      name,
      t: getDirCreateTimeMs(join(bookPath, '濮濓絾鏋?', name))
    }))
    withTime.sort((a, b) => a.t - b.t)
    order = withTime.map((x) => x.name)
  }

  store.set(key, order)
  return order
}

// 创建卷
ipcMain.handle('create-volume', async (event, bookName) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const volumePath = join(bookPath, '濮濓絾鏋?')
  if (!fs.existsSync(volumePath)) {
    fs.mkdirSync(volumePath, { recursive: true })
  }
  let volumeName = '閺傛澘濮為崡?'
  let index = 1
  while (fs.existsSync(join(volumePath, volumeName))) {
    volumeName = `閺傛澘濮為崡?{index}`
    index++
  }
  fs.mkdirSync(join(volumePath, volumeName))

  // 记录卷的创建顺序（旧 -> 新）
  const key = getVolumeOrderKey(bookName)
  const order = asArray(store.get(key))
  if (!order.includes(volumeName)) {
    order.push(volumeName)
    store.set(key, order)
  }

  return { success: true, volumeName }
})

// 创建章节
ipcMain.handle('create-chapter', async (event, { bookName, volumeId }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const volumePath = join(bookPath, '濮濓絾鏋?', volumeId)
  if (!fs.existsSync(volumePath)) {
    fs.mkdirSync(volumePath, { recursive: true })
  }

  // 获取当前卷下的所有章节文件
  const files = fs.readdirSync(volumePath, { withFileTypes: true })
  const chapters = files.filter((file) => file.isFile() && file.name.endsWith('.txt'))

  // 智能计算新的章节序号
  let nextChapterNumber = 1

  if (chapters.length > 0) {
    const chapterNumbers = chapters
      .map((file) => {
        if (file.isFile() && file.name.endsWith('.txt')) {
          const parsed = parseChapterName(file.name.replace('.txt', ''))
          return parsed?.number || 0
        }
        return 0
      })
      .filter((num) => num > 0)

    if (chapterNumbers.length > 0) {
      nextChapterNumber = Math.max(...chapterNumbers) + 1
    } else {
      nextChapterNumber = chapters.length + 1
    }
  }

  // 获取章节设置
  const chapterSettings = store.get(`chapterSettings:${bookName}`) || {
    chapterFormat: 'number',
    suffixType: '缁?',
    targetWords: 2000
  }

  // 根据设置生成章节名称
  const chapterName = `${generateChapterName(nextChapterNumber, chapterSettings)} `
  const filePath = join(volumePath, `${chapterName}.txt`)

  fs.writeFileSync(filePath, '')

  // 强制同步文件系统，确保文件立即可见（Windows兼容）
  try {
    const fd = fs.openSync(filePath, 'r')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
  } catch (error) {
    // 如果同步失败，记录错误但不影响主流程
    console.warn('文件同步失败:', iconPath, error.message)
  }

  return { success: true, chapterName, filePath }
})

// 加载章节数据
ipcMain.handle('load-chapters', async (event, bookName) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const volumePath = join(bookPath, '濮濓絾鏋?')

  if (!fs.existsSync(volumePath)) {
    return []
  }

  const volumes = fs.readdirSync(volumePath, { withFileTypes: true })
  const volumeNames = volumes.filter((v) => v.isDirectory()).map((v) => v.name)
  const volumeOrder = ensureVolumeOrder(bookName, bookPath, volumeNames)

  const chapters = []
  for (const volumeName of volumeOrder) {
    const currentVolumePath = join(bookPath, '濮濓絾鏋?', volumeName)
    if (fs.existsSync(currentVolumePath)) {
      const files = fs.readdirSync(currentVolumePath, { withFileTypes: true })

      const volumeChapters = files
        .filter((file) => file.isFile() && file.name.endsWith('.txt'))
        .map((file) => {
          const name = file.name.replace('.txt', '')
          const parsed = parseChapterName(name)
          return {
            id: file.name,
            name,
            type: 'chapter',
            path: join(bookPath, '濮濓絾鏋?', volumeName, file.name),
            orderValue: parsed?.number || 0,
            hasOrderValue: Boolean(parsed?.number)
          }
        })
        .sort((a, b) => {
          if (a.hasOrderValue && b.hasOrderValue) {
            return a.orderValue - b.orderValue
          }
          if (a.hasOrderValue) return -1
          if (b.hasOrderValue) return 1
          return a.name.localeCompare(b.name)
        })

      for (const chapter of volumeChapters) {
        delete chapter.orderValue
        delete chapter.hasOrderValue
      }

      chapters.push({
        id: volumeName,
        name: volumeName,
        type: 'volume',
        path: join(bookPath, '濮濓絾鏋?', volumeName),
        children: volumeChapters
      })
    }
  }

  return chapters
})

/**
 * 閹镐椒绠欓崠鏍у祹閻ㄥ嫬鐫嶇粈娲€庢惔蹇ョ礄娑?load-chapters 娑?ensureVolumeOrder 鐠囪褰囬惃?volumeOrder 娑撯偓閼疯揪绱?
 */
ipcMain.handle('reorder-volumes', async (event, { bookName, orderedVolumeNames }) => {
  try {
    const booksDir = store.get('booksDir')
    const bookPath = join(booksDir, bookName)
    const mainDir = join(bookPath, '濮濓絾鏋?')
    if (!fs.existsSync(mainDir)) {
      return { success: false, message: '濮濓絾鏋冮惄顔肩秿娑撳秴鐡ㄩ崷?' }
    }
    const onDisk = fs
      .readdirSync(mainDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
    if (!Array.isArray(orderedVolumeNames) || orderedVolumeNames.length !== onDisk.length) {
      return { success: false, message: '閸楅攱鏆熼柌蹇庣瑢绾句胶娲忔稉宥勭閼?' }
    }
    const setDisk = new Set(onDisk)
    const setArg = new Set(orderedVolumeNames)
    if (setDisk.size !== setArg.size || onDisk.some((n) => !setArg.has(n))) {
      return { success: false, message: '閸楀嘲鍨悰銊ょ瑢绾句胶娲忔稉宥勭閼?' }
    }
    store.set(getVolumeOrderKey(bookName), [...orderedVolumeNames])
    return { success: true }
  } catch (error) {
    console.error('reorder-volumes failed:', error)
    return { success: false, message: error.message || '鐠嬪啯鏆ｉ崡鐑姐€庢惔蹇撱亼鐠?' }
  }
})

/**
 * 閹稿瀚嬮幏钘夋倵閻ㄥ嫰銆庢惔蹇涘櫢閹烘帞鐝烽懞鍌涙瀮娴犺绱濋獮鑸靛瘻娑旓妇鐫勭粩鐘哄Ν鐠佸墽鐤嗛柌宥嗘煀缂傛牕褰块敍鍫滅箽閻ｆ瑧鐝烽懞鍌涚垼妫?閹诲繗鍫崥搴ｇ磻閿?
 */
ipcMain.handle(
  'reorder-chapters-in-volume',
  async (event, { bookName, volumeName, orderedChapterNames }) => {
    try {
      const booksDir = store.get('booksDir')
      const bookPath = join(booksDir, bookName)
      const volumePath = join(bookPath, '濮濓絾鏋?', volumeName)

      if (!fs.existsSync(volumePath)) {
        return { success: false, message: '閸楅娲拌ぐ鏇氱瑝鐎涙ê婀?' }
      }

      const onDisk = fs
        .readdirSync(volumePath, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith('.txt'))
        .map((f) => f.name.replace(/\.txt$/, ''))

      if (!Array.isArray(orderedChapterNames) || orderedChapterNames.length !== onDisk.length) {
        return { success: false, message: '缁旂姾濡弫浼村櫤娑撳海顥嗛惄妯圭瑝娑撯偓閼?' }
      }
      const setDisk = new Set(onDisk)
      const setArg = new Set(orderedChapterNames)
      if (setDisk.size !== setArg.size || onDisk.some((n) => !setArg.has(n))) {
        return { success: false, message: '缁旂姾濡崚妤勩€冩稉搴ｎ梿閻╂ü绗夋稉鈧懛?' }
      }

      const stored = store.get(`chapterSettings:${bookName}`) || {
        chapterFormat: 'number',
        suffixType: '缁?',
        targetWords: 2000
      }
      const settings = {
        chapterFormat: stored.chapterFormat === 'hanzi' ? 'hanzi' : 'number',
        suffixType: stored.suffixType || '缁?'
      }

      /** @type {{ oldName: string, newName: string }[]} */
      const renamed = orderedChapterNames.map((oldName, i) => {
        const parsed = parseChapterName(oldName)
        const description = parsed?.description || ''
        const newPrefix = generateChapterName(i + 1, settings)
        const newName = description ? `${newPrefix} ${description}` : newPrefix
        return { oldName, newName }
      })

      const noop = renamed.every((r) => r.oldName === r.newName)
      if (noop) {
        return { success: true, renamed }
      }

      const finalNames = renamed.map((r) => r.newName)
      if (new Set(finalNames).size !== finalNames.length) {
        return { success: false, message: '闁插秵鏌婄紓鏍у娇閸氬孩鏋冩禒璺烘倳闁插秴顦查敍宀冾嚞娣囶喗鏁肩粩鐘哄Ν閺嶅洭顣介崥搴″晙鐠?' }
      }

      const session = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
      for (let i = 0; i < orderedChapterNames.length; i++) {
        const oldName = orderedChapterNames[i]
        const oldPath = join(volumePath, `${oldName}.txt`)
        const tmpPath = join(volumePath, `.51mazi-order-${session}-${i}.txt`)
        fs.renameSync(oldPath, tmpPath)
      }

      for (let i = 0; i < renamed.length; i++) {
        const { newName } = renamed[i]
        const tmpPath = join(volumePath, `.51mazi-order-${session}-${i}.txt`)
        const newPath = join(volumePath, `${newName}.txt`)
        if (fs.existsSync(newPath)) {
          return { success: false, message: `閺冪姵纭堕崘娆忓弳閿涙碍鏋冩禒璺烘倳瀹告彃鐡ㄩ崷銊ｂ偓?${newName}閵嗗硺` }
        }
        fs.renameSync(tmpPath, newPath)
      }

      return { success: true, renamed }
    } catch (error) {
      console.error('reorder-chapters-in-volume failed:', error)
      return { success: false, message: error.message || '鐠嬪啯鏆ｇ粩鐘哄Ν妞ゅ搫绨径杈Е' }
    }
  }
)

// 重新格式化章节编号
ipcMain.handle('reformat-chapter-numbers', async (event, { bookName, volumeName, settings }) => {
  try {
    const booksDir = store.get('booksDir')
    const bookPath = join(booksDir, bookName)
    const volumePath = join(bookPath, '濮濓絾鏋?', volumeName)

    if (!fs.existsSync(volumePath)) {
      return { success: false, message: '閸楅娲拌ぐ鏇氱瑝鐎涙ê婀?' }
    }

    // 获取当前卷下的所有章节文件
    const files = fs.readdirSync(volumePath, { withFileTypes: true })
    const chapters = files.filter((file) => file.isFile() && file.name.endsWith('.txt'))

    if (chapters.length === 0) {
      return { success: false, message: '濞屸剝婀侀幍鎯у煂缁旂姾濡弬鍥︽' }
    }

    // 检查章节编号连续性
    const chapterInfos = chapters.map((file) => {
      const oldName = file.name.replace('.txt', '')
      const parsed = parseChapterName(oldName)
      return {
        oldName,
        oldPath: join(volumePath, file.name),
        file,
        parsed
      }
    })

    const numberingCheck = checkChapterNumbering(
      chapterInfos.map((info) => ({ name: info.oldName, parsed: info.parsed }))
    )

    if (numberingCheck.isSequential) {
      return { success: true, message: '缁旂姾濡紓鏍у娇瀹歌尙绮℃潻鐐电敾閿涘本妫ら棁鈧柌宥嗘煀閺嶇厧绱￠崠?' }
    }

    // 按章节编号排序
    chapterInfos.sort((a, b) => {
      const aNum = a.parsed?.number || 0
      const bNum = b.parsed?.number || 0
      if (aNum && bNum) return aNum - bNum
      return a.oldName.localeCompare(b.oldName)
    })

    // 重新格式化章节编号，保留主题名
    let totalRenamed = 0
    for (let i = 0; i < chapterInfos.length; i++) {
      const info = chapterInfos[i]
      const newNumber = i + 1

      // 提取原有的主题名/描述内容
      const description = info.parsed?.description || ''
      const newPrefix = generateChapterName(newNumber, settings)
      const newName = description ? `${newPrefix} ${description}` : newPrefix

      if (newName !== info.oldName) {
        const newPath = join(volumePath, `${newName}.txt`)

        try {
          fs.renameSync(info.oldPath, newPath)
          totalRenamed++
        } catch (error) {
          return { success: false, message: `闁插秴鎳￠崥宥呫亼鐠? ${error.message}` }
        }
      }
    }

    return {
      success: true,
      message: `閹存劕濮涢柌宥嗘煀閺嶇厧绱￠崠?${totalRenamed} 娑擃亞鐝烽懞淇?`,
      totalRenamed
    }
  } catch (error) {
    return { success: false, message: `閹垮秳缍旀径杈Е: ${error.message}` }
  }
})

// 编辑节点
ipcMain.handle('edit-node', async (event, { bookName, type, volume, chapter, newName }) => {
  try {
    const booksDir = store.get('booksDir')
    if (type === 'volume') {
      // 卷重命名
      const volumePath = join(booksDir, bookName, '濮濓絾鏋?', volume)
      const newVolumePath = join(booksDir, bookName, '濮濓絾鏋?', newName)

      // 检查原路径是否存在
      if (!fs.existsSync(volumePath)) {
        return { success: false, message: '閸樼喎宓庢稉宥呯摠閸?' }
      }

      // 检查新名称是否已存在
      if (fs.existsSync(newVolumePath)) {
        return { success: false, message: '閺傛澘宓庨崥宥呭嚒鐎涙ê婀?' }
      }

      // 检查名称是否相同
      if (volume === newName) {
        return { success: true, message: '閸氬秶袨閺堫亜褰夐崠?' }
      }

      // 在 Windows 上，如果文件夹被占用，renameSync 可能会失败
      // 使用异步重命名并添加重试机制
      try {
        // 尝试同步重命名
        fs.renameSync(volumePath, newVolumePath)

        // 同步更新卷创建顺序元数据
        const key = getVolumeOrderKey(bookName)
        const order = asArray(store.get(key))
        const idx = order.indexOf(volume)
        if (idx !== -1) {
          order[idx] = newName
        } else if (!order.includes(newName)) {
          order.push(newName)
        }
        store.set(key, order)

        return { success: true }
      } catch (renameError) {
        // 如果是 Windows 上的权限或锁定错误，提供更友好的错误信息
        if (process.platform === 'win32') {
          const errorMessage = renameError.message || String(renameError)
          if (
            errorMessage.includes('EACCES') ||
            errorMessage.includes('EPERM') ||
            errorMessage.includes('EBUSY')
          ) {
            return {
              success: false,
              message: '閺傚洣娆㈡径纭咁潶閸楃姷鏁ら敍宀冾嚞閸忔娊妫撮崣顖濆厴濮濓絽婀担璺ㄦ暏鐠囥儲鏋冩禒璺恒仚閻ㄥ嫮鈻兼惔蹇ョ礄婵″倽绁┃鎰吀閻炲棗娅掗敍澶婃倵闁插秷鐦?'
            }
          }
        }
        throw renameError
      }
    } else if (type === 'chapter') {
      // 章节重命名
      const chapterPath = join(booksDir, bookName, '濮濓絾鏋?', volume, `${chapter}.txt`)
      const newChapterPath = join(booksDir, bookName, '濮濓絾鏋?', volume, `${newName}.txt`)

      // 检查原路径是否存在
      if (!fs.existsSync(chapterPath)) {
        return { success: false, message: '閸樼喓鐝烽懞鍌欑瑝鐎涙ê婀?' }
      }

      // 检查新名称是否已存在
      if (fs.existsSync(newChapterPath)) {
        return { success: false, message: '閺傛壆鐝烽懞鍌氭倳瀹告彃鐡ㄩ崷?' }
      }

      // 检查名称是否相同
      if (chapter === newName) {
        return { success: true, message: '閸氬秶袨閺堫亜褰夐崠?' }
      }

      try {
        fs.renameSync(chapterPath, newChapterPath)
        return { success: true }
      } catch (renameError) {
        if (process.platform === 'win32') {
          const errorMessage = renameError.message || String(renameError)
          if (
            errorMessage.includes('EACCES') ||
            errorMessage.includes('EPERM') ||
            errorMessage.includes('EBUSY')
          ) {
            return {
              success: false,
              message: '閺傚洣娆㈢悮顐㈠窗閻㈩煉绱濈拠宄板彠闂傤厼褰查懗鑺ヮ劀閸︺劋濞囬悽銊嚉閺傚洣娆㈤惃鍕柤鎼村繐鎮楅柌宥堢槸'
            }
          }
        }
        throw renameError
      }
    }
    return { success: false, message: '缁鐎烽柨娆掝嚖' }
  } catch (error) {
    console.error('编辑节点失败:', error)
    return { success: false, message: error.message }
  }
})

// 删除节点
ipcMain.handle('delete-node', async (event, { bookName, type, volume, chapter }) => {
  const booksDir = store.get('booksDir')
  if (type === 'volume') {
    const volumePath = join(booksDir, bookName, '濮濓絾鏋?', volume)
    // 删除整个卷文件夹
    if (!fs.existsSync(volumePath)) return { success: false, message: '閸楄渹绗夌€涙ê婀?' }
    fs.rmSync(volumePath, { recursive: true, force: true })

    // 同步更新卷创建顺序元数据
    const key = getVolumeOrderKey(bookName)
    const order = asArray(store.get(key)).filter((name) => name !== volume)
    store.set(key, order)

    return { success: true }
  } else if (type === 'chapter') {
    const chapterPath = join(booksDir, bookName, '濮濓絾鏋?', volume, `${chapter}.txt`)
    if (!fs.existsSync(chapterPath)) return { success: false, message: '缁旂姾濡稉宥呯摠閸?' }
    fs.rmSync(chapterPath)
    return { success: true }
  }
  return { success: false, message: '缁鐎烽柨娆掝嚖' }
})

ipcMain.handle('get-sort-order', (event, bookName) => {
  // 默认：新创建的卷在前（按创建顺序倒序展示）
  return store.get(`sortOrder:${bookName}`) || 'desc'
})

// 获取章节设置
ipcMain.handle('get-chapter-settings', (event, bookName) => {
  const settings = store.get(`chapterSettings:${bookName}`) || {
    suffixType: '缁?',
    targetWords: 2000
  }

  return {
    suffixType: settings.suffixType || '缁?',
    targetWords: Number.isFinite(Number(settings.targetWords)) ? Number(settings.targetWords) : 2000
  }
})

// 设置章节目标字数
ipcMain.handle('set-chapter-target-words', (event, { bookName, targetWords }) => {
  if (!bookName) {
    return { success: false, message: '娑旓妇鐫勯崥宥囆炴稉宥堝厴娑撹櫣鈹?' }
  }
  const numeric = Number(targetWords)
  const sanitized = Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 2000
  const existing = store.get(`chapterSettings:${bookName}`) || {
    suffixType: '缁?',
    targetWords: 2000
  }
  const updated = {
    ...existing,
    targetWords: sanitized
  }
  try {
    store.set(`chapterSettings:${bookName}`, updated)
    return { success: true, settings: updated }
  } catch (error) {
    console.error('更新章节目标字数失败:', error)
    return { success: false, message: error.message || '閺囧瓨鏌婃径杈Е' }
  }
})

// 更新章节格式
ipcMain.handle('update-chapter-format', async (event, { bookName, settings: rawSettings }) => {
  try {
    const booksDir = store.get('booksDir')
    const bookPath = join(booksDir, bookName)
    const volumePath = join(bookPath, '濮濓絾鏋?')

    if (!fs.existsSync(volumePath)) {
      return { success: false, message: '濮濓絾鏋冮惄顔肩秿娑撳秴鐡ㄩ崷?' }
    }

    // 保存设置（补齐默认值）
    const cleanSettings = {
      chapterFormat: rawSettings?.chapterFormat === 'hanzi' ? 'hanzi' : 'number',
      suffixType: rawSettings?.suffixType || '缁?',
      targetWords: Number.isFinite(Number(rawSettings?.targetWords))
        ? Number(rawSettings.targetWords)
        : 2000
    }
    store.set(`chapterSettings:${bookName}`, cleanSettings)
    const appliedSettings = cleanSettings

    // 获取所有卷和章节
    const volumes = fs.readdirSync(volumePath, { withFileTypes: true })
    let totalRenamed = 0

    for (const volume of volumes) {
      if (volume.isDirectory()) {
        const volumeName = volume.name
        const currentVolumePath = join(bookPath, '濮濓絾鏋?', volumeName)
        const files = fs.readdirSync(currentVolumePath, { withFileTypes: true })

        for (const file of files) {
          if (file.isFile() && file.name.endsWith('.txt')) {
            const oldName = file.name.replace('.txt', '')
            const parsed = parseChapterName(oldName)

            if (parsed) {
              const { number: chapterNumber, description } = parsed
              const newPrefix = generateChapterName(chapterNumber, appliedSettings)
              const suffixText = description ? ` ${description}` : ''
              const newName = `${newPrefix}${suffixText}`

              if (newName !== oldName) {
                const oldPath = join(currentVolumePath, file.name)
                const newPath = join(currentVolumePath, `${newName}.txt`)

                fs.renameSync(oldPath, newPath)
                totalRenamed++
              }
            }
          }
        }
      }
    }

    return {
      success: true,
      message: `閹存劕濮涢柌宥呮嚒閸?${totalRenamed} 娑擃亞鐝烽懞鍌涙瀮娴犵Χ`,
      totalRenamed
    }
  } catch (error) {
    const errorMessage = error.message || '閺堫亞鐓￠柨娆掝嚖'
    return { success: false, message: errorMessage }
  }
})

const CHINESE_DIGIT_MAP = {
  '\u96f6': 0,
  '\u4e00': 1,
  '\u4e8c': 2,
  '\u4e09': 3,
  '\u56db': 4,
  '\u4e94': 5,
  '\u516d': 6,
  '\u4e03': 7,
  '\u516b': 8,
  '\u4e5d': 9
}

const CHINESE_DIGITS = [
  '\u96f6',
  '\u4e00',
  '\u4e8c',
  '\u4e09',
  '\u56db',
  '\u4e94',
  '\u516d',
  '\u4e03',
  '\u516b',
  '\u4e5d'
]

const CHINESE_UNITS = {
  '\u5341': 10,
  '\u767e': 100,
  '\u5343': 1000,
  '\u4e07': 10000
}

function convertNumberToChinese(num) {
  const numeric = Number(num)
  if (!Number.isFinite(numeric) || numeric <= 0) return String(num)

  if (numeric >= 10000) {
    const high = Math.floor(numeric / 10000)
    const rest = numeric % 10000
    let result = `${convertNumberToChinese(high)}\u4e07`

    if (rest > 0) {
      let restChinese = convertNumberToChinese(rest)
      if (rest < 100 && restChinese.startsWith('\u5341')) {
        restChinese = `\u4e00${restChinese}`
      }
      result += rest < 1000 ? `\u96f6${restChinese}` : restChinese
    }

    return result
  }

  const str = String(Math.floor(numeric))
  const units = ['', '\u5341', '\u767e', '\u5343']
  let result = ''
  let zeroFlag = false

  for (let i = 0; i < str.length; i++) {
    const digit = Number(str[i])
    const position = str.length - i - 1

    if (digit === 0) {
      zeroFlag = result.length > 0
      continue
    }

    if (zeroFlag) {
      result += '\u96f6'
      zeroFlag = false
    }

    result += CHINESE_DIGITS[digit] + (units[position] || '')
  }

  result = result.replace(/^\u4e00\u5341/, '\u5341')
  return result || '\u96f6'
}

function parseChineseNumber(str) {
  if (!str) return NaN

  let total = 0
  let section = 0
  let number = 0

  for (const char of str) {
    if (char === '\u96f6') {
      if (number !== 0) number = 0
      continue
    }

    if (CHINESE_DIGIT_MAP[char] !== undefined) {
      number = CHINESE_DIGIT_MAP[char]
      continue
    }

    if (!CHINESE_UNITS[char]) {
      return NaN
    }

    const unitValue = CHINESE_UNITS[char]
    if (unitValue === 10000) {
      section = (section + number) * unitValue
      total += section
      section = 0
    } else {
      const multiplier = number === 0 && char === '\u5341' ? 1 : number
      section += multiplier * unitValue
    }

    number = 0
  }

  return total + section + number
}

function parseChapterName(name) {
  const match = String(name || '').match(/^第(.+?)([章节回卷])\s*(.*)$/u)
  if (!match) return null

  const [, rawNumber, suffix, description] = match
  const number = /^\d+$/.test(rawNumber) ? parseInt(rawNumber, 10) : parseChineseNumber(rawNumber)

  if (!Number.isFinite(number) || number <= 0) return null

  return {
    number,
    suffix,
    description: description || ''
  }
}

function generateChapterName(number, settings) {
  const format = settings?.chapterFormat === 'hanzi' ? 'hanzi' : 'number'
  const suffix = settings?.suffixType || settings?.suffix || '\u7ae0'
  const numberPart = format === 'hanzi' ? convertNumberToChinese(number) : String(number)
  return `第${numberPart}${suffix}`
}

// 检查章节编号是否连续
function checkChapterNumbering(chapters) {
  if (!chapters || chapters.length === 0) {
    return { isSequential: true, missingNumbers: [], maxNumber: 0, totalChapters: 0 }
  }

  const chapterNumbers = chapters
    .map((chapter) => {
      if (chapter.parsed?.number) return chapter.parsed.number
      const parsed = parseChapterName(chapter.name || '')
      return parsed?.number || 0
    })
    .filter((num) => num > 0)
    .sort((a, b) => a - b)

  if (chapterNumbers.length === 0) {
    return { isSequential: true, missingNumbers: [], maxNumber: 0, totalChapters: chapters.length }
  }

  const maxNumber = Math.max(...chapterNumbers)
  const totalChapters = chapters.length
  const missingNumbers = []

  // 检查缺失的编号
  for (let i = 1; i <= maxNumber; i++) {
    if (!chapterNumbers.includes(i)) {
      missingNumbers.push(i)
    }
  }

  const isSequential = missingNumbers.length === 0 && maxNumber === totalChapters

  return {
    isSequential,
    missingNumbers,
    maxNumber,
    totalChapters,
    chapterNumbers
  }
}

ipcMain.handle('set-sort-order', (event, { bookName, order }) => {
  store.set(`sortOrder:${bookName}`, order)
  return true
})

// 加载笔记数据
ipcMain.handle('load-notes', async (event, bookName) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const notesPath = join(bookPath, '缁楁棁顔?')
  if (!fs.existsSync(notesPath)) {
    return []
  }
  // 递归读取笔记目录
  function readNotesDir(dir, isRoot = false) {
    const items = fs.readdirSync(dir, { withFileTypes: true })
    return items
      .filter((item) => {
        if (isRoot) return item.isDirectory() // 閺嶇懓鐪伴崣顏囩箲閸ョ偞鏋冩禒璺恒仚閿涘牏鐟拋鐗堟拱閿?
        if (item.isDirectory()) return true
        // 只返回 .txt 文件作为笔记
        return item.isFile() && item.name.endsWith('.txt')
      })
      .map((item) => {
        if (item.isDirectory()) {
          return {
            id: item.name,
            name: item.name,
            type: 'folder',
            path: join(dir, item.name), // 閸烆垯绔?
            children: readNotesDir(join(dir, item.name))
          }
        } else {
          return {
            id: item.name,
            name: item.name.replace(/\.txt$/, ''),
            type: 'note',
            path: join(dir, item.name) // 閸烆垯绔?
          }
        }
      })
  }
  return readNotesDir(notesPath, true)
})

// 创建笔记本
ipcMain.handle('create-notebook', async (event, { bookName }) => {
  const booksDir = store.get('booksDir')
  const notesPath = join(booksDir, bookName, '缁楁棁顔?')
  let baseName = '閺傛澘缂撶粭鏃囶唶閺?'
  let notebookName = baseName
  let index = 1
  while (fs.existsSync(join(notesPath, notebookName))) {
    notebookName = `${baseName}${index}`
    index++
  }
  fs.mkdirSync(join(notesPath, notebookName))
  return { success: true, notebookName }
})

// 删除笔记本
ipcMain.handle('delete-notebook', async (event, { bookName, notebookName }) => {
  const booksDir = store.get('booksDir')
  const notebookPath = join(booksDir, bookName, '缁楁棁顔?', notebookName)
  if (!fs.existsSync(notebookPath)) {
    return { success: false, message: '缁楁棁顔囬張顑跨瑝鐎涙ê婀?' }
  }
  fs.rmSync(notebookPath, { recursive: true, force: true })
  return { success: true }
})

// 重命名笔记本
ipcMain.handle('rename-notebook', async (event, { bookName, oldName, newName }) => {
  const booksDir = store.get('booksDir')
  const notesPath = join(booksDir, bookName, '缁楁棁顔?')
  const oldPath = join(notesPath, oldName)
  const newPath = join(notesPath, newName)
  if (!fs.existsSync(oldPath)) {
    return { success: false, message: '閸樼喓鐟拋鐗堟拱娑撳秴鐡ㄩ崷?' }
  }
  if (fs.existsSync(newPath)) {
    return { success: false, message: '閺傛壆鐟拋鐗堟拱閸氬秴鍑＄€涙ê婀?' }
  }
  fs.renameSync(oldPath, newPath)
  return { success: true }
})

// 创建笔记
ipcMain.handle('create-note', async (event, { bookName, notebookName, noteName }) => {
  const booksDir = store.get('booksDir')
  const notebookPath = join(booksDir, bookName, '缁楁棁顔?', notebookName)
  if (!fs.existsSync(notebookPath)) {
    return { success: false, message: '缁楁棁顔囬張顑跨瑝鐎涙ê婀?' }
  }
  let baseName = noteName || '閺傛澘缂撶粭鏃囶唶'
  let fileName = `${baseName}.txt`
  let index = 1
  while (fs.existsSync(join(notebookPath, fileName))) {
    fileName = `${baseName}${index}.txt`
    index++
  }
  fs.writeFileSync(join(notebookPath, fileName), '')
  return { success: true }
})

// 设置书架已认证（由认证页面在密码验证通过后调用）
ipcMain.handle(
  'export-organization-to-note',
  async (event, { bookName, organizationName, content }) => {
    try {
      const booksDir = store.get('booksDir')
      if (!booksDir || !bookName || !organizationName) {
        return { success: false, message: '閸欏倹鏆熸稉宥呯暚閺?' }
      }

      const bookPath = join(booksDir, bookName)
      if (!fs.existsSync(bookPath)) {
        return { success: false, message: '娑旓妇鐫勬稉宥呯摠閸?' }
      }

      const notebookName = '缂佸嫮绮愰弸鑸电€?'
      const notebookPath = join(bookPath, '缁楁棁顔?', notebookName)
      fs.mkdirSync(notebookPath, { recursive: true })

      const safeNoteName = String(organizationName)
        .trim()
        .replace(/[\\/:*?"<>|]/g, '_')
      if (!safeNoteName) {
        return { success: false, message: '缂佸嫮绮愰弸鑸电€崥宥囆為弮鐘虫櫏' }
      }

      const notePath = join(notebookPath, `${safeNoteName}.txt`)
      fs.writeFileSync(notePath, String(content || ''), 'utf-8')
      await updateBookMetadata(bookName)

      return {
        success: true,
        notebookName,
        noteName: safeNoteName
      }
    } catch (error) {
      console.error('导出组织架构到笔记失败:', error)
      return { success: false, message: error.message || '鐎电厧鍤紒鍕矏閺嬭埖鐎崚鎵應鐠佹澘銇戠拹?' }
    }
  }
)

// 删除笔记
ipcMain.handle('delete-note', async (event, { bookName, notebookName, noteName }) => {
  const booksDir = store.get('booksDir')
  const notePath = join(booksDir, bookName, '缁楁棁顔?', notebookName, `${noteName}.txt`)
  if (!fs.existsSync(notePath)) {
    return { success: false, message: '缁楁棁顔囨稉宥呯摠閸?' }
  }
  fs.rmSync(notePath)
  return { success: true }
})

// 重命名笔记
ipcMain.handle('rename-note', async (event, { bookName, notebookName, oldName, newName }) => {
  const booksDir = store.get('booksDir')
  const notebookPath = join(booksDir, bookName, '缁楁棁顔?', notebookName)
  const oldPath = join(notebookPath, `${oldName}.txt`)
  const newPath = join(notebookPath, `${newName}.txt`)
  if (!fs.existsSync(oldPath)) {
    return { success: false, message: '閸樼喓鐟拋棰佺瑝鐎涙ê婀?' }
  }
  if (fs.existsSync(newPath)) {
    return { success: false, message: '閺傛壆鐟拋鏉挎倳瀹告彃鐡ㄩ崷?' }
  }
  fs.renameSync(oldPath, newPath)
  return { success: true }
})

// 读取笔记内容
ipcMain.handle('read-note', async (event, { bookName, notebookName, noteName }) => {
  const booksDir = store.get('booksDir')
  const notePath = join(booksDir, bookName, '缁楁棁顔?', notebookName, `${noteName}.txt`)
  if (!fs.existsSync(notePath)) {
    return { success: false, message: '缁楁棁顔囨稉宥呯摠閸?' }
  }
  const content = fs.readFileSync(notePath, 'utf-8')
  return { success: true, content }
})

// 设置书架已认证（由认证页面在密码验证通过后调用）
ipcMain.handle(
  'edit-note',
  async (event, { bookName, notebookName, noteName, newName, content }) => {
    const booksDir = store.get('booksDir')
    const notebookPath = join(booksDir, bookName, '缁楁棁顔?', notebookName)
    const oldPath = join(notebookPath, `${noteName}.txt`)
    const newPath = join(notebookPath, `${newName || noteName}.txt`)
    if (!fs.existsSync(oldPath)) {
      return { success: false, message: '缁楁棁顔囨稉宥呯摠閸?' }
    }
    // 1. 先写内容到原文件
    fs.writeFileSync(oldPath, content, 'utf-8')
    // 2. 判断是否需要重命名
    if (newName && newName !== noteName) {
      if (fs.existsSync(newPath)) {
        return { success: false, message: '缁楁棁顔囬崥宥呭嚒鐎涙ê婀?', name: noteName }
      }
      fs.renameSync(oldPath, newPath)
    }
    // 3. 更新书籍元数据（更新updatedAt字段）
    await updateBookMetadata(bookName)
    return { success: true, name: newName || noteName }
  }
)

// 读取章节内容
ipcMain.handle('read-chapter', async (event, { bookName, volumeName, chapterName }) => {
  const booksDir = store.get('booksDir')
  const chapterPath = join(booksDir, bookName, '濮濓絾鏋?', volumeName, `${chapterName}.txt`)
  if (!fs.existsSync(chapterPath)) {
    return { success: false, message: '缁旂姾濡稉宥呯摠閸?' }
  }
  const content = fs.readFileSync(chapterPath, 'utf-8')
  // 章节标题可单独存储或直接用文件名
  return { success: true, content }
})

// 检查章节是否存在（用于 AI 章纲生成前校验）
ipcMain.handle('chapter:check-exists', async (event, { bookName, volumeName, chapterName }) => {
  const booksDir = store.get('booksDir')
  const cleanChapterName = String(chapterName || '').trim()
  if (!bookName || !volumeName || !cleanChapterName) {
    return { success: false, exists: false, message: '閸欏倹鏆熸稉宥呯暚閺?' }
  }

  const chapterPath = join(booksDir, bookName, '濮濓絾鏋?', volumeName, `${cleanChapterName}.txt`)
  return { success: true, exists: fs.existsSync(chapterPath) }
})

// 计算章节字数（排除空格、换行符、制表符等格式字符）
function countChapterWords(content) {
  if (!content) return 0
  // 移除空格、换行符、制表符等格式字符，只计算实际内容
  return content.replace(/[\s\n\r\t]/g, '').length
}

// 计算书籍总字数
async function calculateBookWordCount(bookName) {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const volumePath = join(bookPath, '濮濓絾鏋?')
  let totalWords = 0

  if (!fs.existsSync(volumePath)) return totalWords

  const volumes = fs.readdirSync(volumePath, { withFileTypes: true })
  for (const volume of volumes) {
    if (volume.isDirectory()) {
      const volumeName = volume.name
      const volumePath = join(bookPath, '濮濓絾鏋?', volumeName)
      const files = fs.readdirSync(volumePath, { withFileTypes: true })
      for (const file of files) {
        if (file.isFile() && file.name.endsWith('.txt')) {
          const content = fs.readFileSync(join(volumePath, file.name), 'utf-8')
          totalWords += countChapterWords(content)
        }
      }
    }
  }
  return totalWords
}

// 更新书籍元数据
async function updateBookMetadata(bookName) {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const metaPath = join(bookPath, 'mazi.json')

  if (!fs.existsSync(metaPath)) return false

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    const totalWords = await calculateBookWordCount(bookName)

    meta.totalWords = totalWords
    meta.updatedAt = new Date().toLocaleString()

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    return true
  } catch (error) {
    console.error('更新书籍元数据失败:', error)
    return false
  }
}

// 统计文件路径
const STATS_FILE = 'word_stats.json'

// 获取统计文件路径
function getStatsFilePath() {
  const booksDir = store.get('booksDir')
  return join(booksDir, STATS_FILE)
}

// 读取统计数据
function readStats() {
  const statsPath = getStatsFilePath()
  if (!fs.existsSync(statsPath)) {
    return { dailyStats: {}, chapterStats: {}, bookDailyStats: {} }
  }
  try {
    return JSON.parse(fs.readFileSync(statsPath, 'utf-8'))
  } catch (error) {
    console.error('读取统计文件失败:', error)
    return { dailyStats: {}, chapterStats: {}, bookDailyStats: {} }
  }
}

// 保存统计数据
function saveStats(stats) {
  const statsPath = getStatsFilePath()
  try {
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf-8')
    return true
  } catch (error) {
    console.error('保存统计文件失败:', error)
    return false
  }
}

// 更新章节字数统计
function updateChapterStats(bookName, volumeName, chapterName, oldContent, newContent) {
  const stats = readStats()
  const today = new Date().toISOString().split('T')[0]
  const chapterKey = `${bookName}/${volumeName}/${chapterName}`

  // 使用统一的字数统计函数，排除空格、换行符、制表符
  const oldLength = countChapterWords(oldContent)
  const newLength = countChapterWords(newContent)
  const wordChange = newLength - oldLength

  // 章节上次统计信息
  const prev = stats.chapterStats[chapterKey]
  const lastUpdate = prev ? prev.lastUpdate : today

  // 1. 先把旧字数从旧日期扣除
  if (prev && stats.dailyStats[lastUpdate]) {
    stats.dailyStats[lastUpdate] -= prev.totalWords
    if (stats.dailyStats[lastUpdate] < 0) stats.dailyStats[lastUpdate] = 0
  }

  // 2. 再把新字数加到今天
  if (!stats.dailyStats[today]) stats.dailyStats[today] = 0
  stats.dailyStats[today] += newLength

  // 3. 更新章节统计
  stats.chapterStats[chapterKey] = {
    totalWords: newLength,
    lastUpdate: today,
    wordChange: wordChange, // 鐠佹澘缍嶉張顒侇偧鐎涙鏆熼崣妯哄
    lastContentLength: oldLength // 鐠佹澘缍嶆稉濠冾偧閸愬懎顔愰梹鍨
  }

  // 4. 更新书籍每日净增字数统计
  if (!stats.bookDailyStats) stats.bookDailyStats = {}
  if (!stats.bookDailyStats[bookName]) stats.bookDailyStats[bookName] = {}
  if (!stats.bookDailyStats[bookName][today]) {
    stats.bookDailyStats[bookName][today] = {
      netWords: 0,
      addWords: 0,
      deleteWords: 0,
      totalWords: 0
    }
  }

  // 计算净增字数
  if (wordChange > 0) {
    stats.bookDailyStats[bookName][today].addWords += wordChange
  } else if (wordChange < 0) {
    stats.bookDailyStats[bookName][today].deleteWords += Math.abs(wordChange)
  }

  stats.bookDailyStats[bookName][today].netWords =
    stats.bookDailyStats[bookName][today].addWords -
    stats.bookDailyStats[bookName][today].deleteWords

  stats.bookDailyStats[bookName][today].totalWords = newLength

  saveStats(stats)
}

// 设置书架已认证（由认证页面在密码验证通过后调用）
ipcMain.handle(
  'save-chapter',
  async (event, { bookName, volumeName, chapterName, newName, content }) => {
    const booksDir = store.get('booksDir')
    const volumePath = join(booksDir, bookName, '濮濓絾鏋?', volumeName)
    const oldPath = join(volumePath, `${chapterName}.txt`)
    const newPath = join(volumePath, `${newName || chapterName}.txt`)

    if (!fs.existsSync(oldPath)) {
      return { success: false, message: '缁旂姾濡稉宥呯摠閸?' }
    }

    // 读取旧内容用于统计
    const oldContent = fs.readFileSync(oldPath, 'utf-8')

    // 1. 先写内容到原文件
    fs.writeFileSync(oldPath, content, 'utf-8')

    // 2. 判断是否需要重命名
    if (newName && newName !== chapterName) {
      if (fs.existsSync(newPath)) {
        return { success: false, message: '缁旂姾濡崥宥呭嚒鐎涙ê婀?', name: chapterName }
      }
      fs.renameSync(oldPath, newPath)
    }

    // 3. 更新统计
    updateChapterStats(bookName, volumeName, chapterName, oldContent, content)

    // 4. 更新书籍元数据
    await updateBookMetadata(bookName)

    return { success: true, name: newName || chapterName }
  }
)

// 设置书架已认证（由认证页面在密码验证通过后调用）
ipcMain.handle(
  'chapter:upsert',
  async (event, { bookName, volumeName, chapterName, content, overwrite = false }) => {
    try {
      const booksDir = store.get('booksDir')
      const cleanChapterName = String(chapterName || '').trim()
      if (!bookName || !volumeName || !cleanChapterName) {
        return { success: false, exists: false, message: '閸欏倹鏆熸稉宥呯暚閺?' }
      }

      const volumePath = join(booksDir, bookName, '濮濓絾鏋?', volumeName)
      if (!fs.existsSync(volumePath)) {
        fs.mkdirSync(volumePath, { recursive: true })
      }

      const chapterPath = join(volumePath, `${cleanChapterName}.txt`)
      const chapterExists = fs.existsSync(chapterPath)
      if (chapterExists && !overwrite) {
        return { success: false, exists: true, message: '缁旂姾濡鎻掔摠閸?' }
      }

      const oldContent = chapterExists ? fs.readFileSync(chapterPath, 'utf-8') : ''
      fs.writeFileSync(chapterPath, String(content || ''), 'utf-8')
      updateChapterStats(bookName, volumeName, cleanChapterName, oldContent, String(content || ''))
      await updateBookMetadata(bookName)

      return { success: true, exists: chapterExists, chapterName: cleanChapterName }
    } catch (error) {
      console.error('写入章节失败:', error)
      return { success: false, exists: false, message: error.message || '閸愭瑥鍙嗙粩鐘哄Ν婢惰精瑙?' }
    }
  }
)

// 修改获取每日码字数统计的处理函数
ipcMain.handle('get-daily-word-count', async () => {
  try {
    const stats = readStats()
    return { success: true, data: stats.dailyStats }
  } catch (error) {
    console.error('获取每日码字统计失败:', error)
    return { success: false, message: '閼惧嘲褰囩紒鐔活吀婢惰精瑙?' }
  }
})

// 新增：获取书籍每日净增字数统计
ipcMain.handle('get-book-daily-stats', async (event, bookName) => {
  try {
    const stats = readStats()
    if (!stats.bookDailyStats || !stats.bookDailyStats[bookName]) {
      return { success: true, data: {} }
    }
    return { success: true, data: stats.bookDailyStats[bookName] }
  } catch (error) {
    console.error('获取书籍每日统计失败:', error)
    return { success: false, message: '閼惧嘲褰囩紒鐔活吀婢惰精瑙?' }
  }
})

// 新增：获取所有书籍的每日净增字数统计
ipcMain.handle('get-all-books-daily-stats', async () => {
  try {
    // 先判断 booksDir 是否存在且有数据
    const booksDir = store.get('booksDir')
    if (!booksDir || !fs.existsSync(booksDir)) {
      return { success: true, data: {} }
    }

    const stats = readStats()
    if (!stats.bookDailyStats) {
      return { success: true, data: {} }
    }
    return { success: true, data: stats.bookDailyStats }
  } catch (error) {
    console.error('获取所有书籍每日统计失败:', error)
    return { success: false, message: '閼惧嘲褰囩紒鐔活吀婢惰精瑙?' }
  }
})

// 添加获取章节统计的处理函数
ipcMain.handle('get-chapter-stats', async (event, { bookName, volumeName, chapterName }) => {
  try {
    const stats = readStats()
    const chapterKey = `${bookName}/${volumeName}/${chapterName}`
    return { success: true, data: stats.chapterStats[chapterKey] || null }
  } catch (error) {
    console.error('获取章节统计失败:', error)
    return { success: false, message: '閼惧嘲褰囩紒鐔活吀婢惰精瑙?' }
  }
})

// 时间线数据读写
ipcMain.handle('read-timeline', async (event, { bookName }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const timelinePath = join(bookPath, 'timelines.json')
  if (!fs.existsSync(timelinePath)) return []
  try {
    return JSON.parse(fs.readFileSync(timelinePath, 'utf-8'))
  } catch {
    return []
  }
})

// 保存时间线数据
ipcMain.handle('write-timeline', async (event, { bookName, data }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const timelinePath = join(bookPath, 'timelines.json')

  try {
    // 确保目录存在
    if (!fs.existsSync(bookPath)) {
      fs.mkdirSync(bookPath, { recursive: true })
    }

    fs.writeFileSync(timelinePath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('保存时间线失败:', error)
    return { success: false, message: error.message }
  }
})

// 大纲数据读写
ipcMain.handle('read-outlines', async (event, { bookName }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const outlinePath = join(bookPath, 'outlines.json')
  if (!fs.existsSync(outlinePath)) {
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(outlinePath, 'utf-8'))
  } catch {
    return null
  }
})

// 保存大纲数据
ipcMain.handle('write-outlines', async (event, { bookName, data }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const outlinePath = join(bookPath, 'outlines.json')

  try {
    if (!fs.existsSync(bookPath)) {
      fs.mkdirSync(bookPath, { recursive: true })
    }

    fs.writeFileSync(outlinePath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('保存大纲失败:', error)
    return { success: false, message: error.message }
  }
})


// 人物谱数据读写
ipcMain.handle('read-characters', async (event, { bookName }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const charactersPath = join(bookPath, 'characters.json')
  if (!fs.existsSync(charactersPath)) return []
  try {
    return JSON.parse(fs.readFileSync(charactersPath, 'utf-8'))
  } catch {
    return []
  }
})

// 保存人物谱数据
ipcMain.handle('write-characters', async (event, { bookName, data }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const charactersPath = join(bookPath, 'characters.json')

  try {
    // 确保目录存在
    if (!fs.existsSync(bookPath)) {
      fs.mkdirSync(bookPath, { recursive: true })
    }

    fs.writeFileSync(charactersPath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('保存人物谱失败:', error)
    return { success: false, message: error.message }
  }
})

// 扩展档案（坐骑 / 怪兽 / 妖兽 / 宝器），与人物谱分文件存储，避免影响编辑器人物高亮等逻辑
const ENTITY_PROFILES_FILE = 'entity_profiles.json'
const ENTITY_PROFILE_KEYS = ['mount', 'monster', 'spirit_beast', 'artifact']

function defaultEntityProfilesPayload() {
  return {
    mount: [],
    monster: [],
    spirit_beast: [],
    artifact: []
  }
}

function readEntityProfilesFromDisk(bookPath) {
  const profilesPath = join(bookPath, ENTITY_PROFILES_FILE)
  if (!fs.existsSync(profilesPath)) return defaultEntityProfilesPayload()
  try {
    const raw = JSON.parse(fs.readFileSync(profilesPath, 'utf-8'))
    const out = defaultEntityProfilesPayload()
    for (const key of ENTITY_PROFILE_KEYS) {
      out[key] = Array.isArray(raw[key]) ? raw[key] : []
    }
    return out
  } catch {
    return defaultEntityProfilesPayload()
  }
}

ipcMain.handle('read-entity-profiles', async (event, { bookName }) => {
  const booksDir = store.get('booksDir')
  if (!bookName) return defaultEntityProfilesPayload()
  const bookPath = join(booksDir, bookName)
  return readEntityProfilesFromDisk(bookPath)
})

ipcMain.handle('write-entity-profile-category', async (event, { bookName, category, data }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const profilesPath = join(bookPath, ENTITY_PROFILES_FILE)
  if (!bookName || !ENTITY_PROFILE_KEYS.includes(category)) {
    return { success: false, message: '閸欏倹鏆熼弮鐘虫櫏' }
  }
  if (!Array.isArray(data)) {
    return { success: false, message: '閺佺増宓佹い璁宠礋閺佹壆绮?' }
  }
  try {
    if (!fs.existsSync(bookPath)) {
      fs.mkdirSync(bookPath, { recursive: true })
    }
    const all = readEntityProfilesFromDisk(bookPath)
    all[category] = data
    fs.writeFileSync(profilesPath, JSON.stringify(all, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('保存扩展档案失败:', error)
    return { success: false, message: error.message }
  }
})

// 词条字典数据读写
ipcMain.handle('read-dictionary', async (event, { bookName }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const dictionaryPath = join(bookPath, 'dictionary.json')
  if (!fs.existsSync(dictionaryPath)) return []
  try {
    return JSON.parse(fs.readFileSync(dictionaryPath, 'utf-8'))
  } catch {
    return []
  }
})

// 保存词条字典数据
ipcMain.handle('write-dictionary', async (event, { bookName, data }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const dictionaryPath = join(bookPath, 'dictionary.json')

  try {
    // 确保目录存在
    if (!fs.existsSync(bookPath)) {
      fs.mkdirSync(bookPath, { recursive: true })
    }

    fs.writeFileSync(dictionaryPath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('保存词条字典失败:', error)
    return { success: false, message: error.message }
  }
})

const DEFAULT_SETTINGS_DATA = {
  categories: [
    {
      id: 'default',
      name: '姒涙顓荤拋鎯х暰',
      introduction: '',
      children: [],
      items: []
    }
  ]
}

function cloneDefaultSettingsData() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS_DATA))
}

function normalizeSettingItems(items, categoryIndexPath) {
  if (!Array.isArray(items)) return []

  return items
    .filter((item) => item && typeof item === 'object')
    .map((item, itemIndex) => ({
      id: String(item.id || `setting-${Date.now()}-${categoryIndexPath}-${itemIndex}`),
      name: String(item.name || '').trim(),
      introduction: String(item.introduction || '').trim()
    }))
}

function normalizeSettingCategories(categories, parentIndexPath = 'root') {
  if (!Array.isArray(categories)) return []

  return categories
    .filter((category) => category && typeof category === 'object')
    .map((category, categoryIndex) => {
      const indexPath = `${parentIndexPath}-${categoryIndex}`

      return {
        id: String(category.id || `category-${Date.now()}-${indexPath}`),
        name: String(category.name || '').trim() || '閺堫亜鎳￠崥宥呭瀻缁?',
        introduction: String(category.introduction || '').trim(),
        children: normalizeSettingCategories(category.children, indexPath),
        items: normalizeSettingItems(category.items, indexPath)
      }
    })
}

function normalizeSettingsData(data) {
  const categories = normalizeSettingCategories(data?.categories)

  if (!categories.length) {
    return cloneDefaultSettingsData()
  }

  return { categories }
}

// 设定管理数据读写
ipcMain.handle('read-settings', async (event, { bookName }) => {
  if (!bookName) return cloneDefaultSettingsData()

  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const settingsPath = join(bookPath, 'settings.json')
  if (!fs.existsSync(settingsPath)) return cloneDefaultSettingsData()

  try {
    return normalizeSettingsData(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')))
  } catch {
    return cloneDefaultSettingsData()
  }
})

ipcMain.handle('write-settings', async (event, { bookName, data }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const settingsPath = join(bookPath, 'settings.json')

  try {
    if (!bookName) {
      throw new Error('娑旓妇鐫勯崥宥囆炴稉宥堝厴娑撹櫣鈹?')
    }

    // 确保目录存在
    if (!fs.existsSync(bookPath)) {
      fs.mkdirSync(bookPath, { recursive: true })
    }

    fs.writeFileSync(settingsPath, JSON.stringify(normalizeSettingsData(data), null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('保存设定管理失败:', error)
    return { success: false, message: error.message }
  }
})

// 事序图数据读写
ipcMain.handle('read-sequence-charts', async (event, { bookName }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const filePath = join(bookPath, 'sequence-charts.json')
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return []
  }
})

ipcMain.handle('write-sequence-charts', async (event, { bookName, data }) => {
  const booksDir = store.get('booksDir')
  const bookPath = join(booksDir, bookName)
  const filePath = join(bookPath, 'sequence-charts.json')

  try {
    if (!fs.existsSync(bookPath)) {
      fs.mkdirSync(bookPath, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('保存事序图失败:', error)
    return { success: false, message: error.message }
  }
})

// 读取地图列表
ipcMain.handle('read-maps', async (event, bookName) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const bookPath = join(booksDir, bookName)
    const mapsDir = join(bookPath, 'maps')
    if (!fs.existsSync(mapsDir)) {
      fs.mkdirSync(mapsDir, { recursive: true })
      return []
    }
    const files = fs.readdirSync(mapsDir)
    const maps = files
      .filter((file) => file.endsWith('.png'))
      .map((file) => {
        const name = file.split('.').slice(0, -1).join('.')
        const filePath = join(mapsDir, file)
        const jsonPath = join(mapsDir, `${name}.json`)

        let thumbnail = ''
        try {
          const data = fs.readFileSync(filePath)
          thumbnail = `data:image/png;base64,${data.toString('base64')}`
        } catch {
          thumbnail = ''
        }

        // 读取地图元数据（如果存在）
        let mapData = {
          id: name,
          name: name,
          description: ''
        }
        if (fs.existsSync(jsonPath)) {
          try {
            const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
            mapData = {
              id: jsonData.id || name,
              name: jsonData.name || name,
              description: jsonData.description || ''
            }
          } catch (error) {
            console.error(`读取地图元数据失败: ${name}`, error)
          }
        }

        return {
          ...mapData,
          thumbnail
        }
      })
    return maps
  } catch (error) {
    console.error('读取地图列表失败:', error)
    throw error
  }
})

// 新增：读取地图图片为base64
ipcMain.handle('read-map-image', async (event, { bookName, mapName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const filePath = join(booksDir, bookName, 'maps', `${mapName}.png`)
    if (!fs.existsSync(filePath)) return ''
    const data = fs.readFileSync(filePath)
    return `data:image/png;base64,${data.toString('base64')}`
  } catch {
    return ''
  }
})

// 创建地图（有同名校验）
ipcMain.handle('create-map', async (event, { bookName, mapName, description, imageData }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const bookPath = join(booksDir, bookName)
    const mapsDir = join(bookPath, 'maps')
    if (!fs.existsSync(mapsDir)) {
      fs.mkdirSync(mapsDir, { recursive: true })
    }
    // 校验同名文件
    const filePath = join(mapsDir, `${mapName}.png`)
    const jsonPath = join(mapsDir, `${mapName}.json`)
    if (fs.existsSync(filePath) || fs.existsSync(jsonPath)) {
      throw new Error('瀹告彃鐡ㄩ崷銊ユ倱閸氬秴婀撮崶鐐瀮娴?')
    }
    // 保存图片
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    fs.writeFileSync(filePath, buffer)

    // 保存地图元数据
    const mapData = {
      id: mapName,
      name: mapName,
      description: description || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    fs.writeFileSync(jsonPath, JSON.stringify(mapData, null, 2), 'utf-8')

    return {
      success: true,
      path: filePath
    }
  } catch (error) {
    console.error('创建地图失败:', error)
    throw error
  }
})

// 更新地图（无同名校验）
ipcMain.handle('update-map', async (event, { bookName, mapName, imageData, mapData }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const bookPath = join(booksDir, bookName)
    const mapsDir = join(bookPath, 'maps')
    if (!fs.existsSync(mapsDir)) {
      fs.mkdirSync(mapsDir, { recursive: true })
    }
    const filePath = join(mapsDir, `${mapName}.png`)
    const dataFilePath = join(mapsDir, `${mapName}.data.json`)

    // 保存图片（覆盖）
    if (imageData) {
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')
      fs.writeFileSync(filePath, buffer)
    }

    // 保存地图数据（画板内容）
    if (mapData) {
      fs.writeFileSync(dataFilePath, JSON.stringify(mapData, null, 2), 'utf-8')
    }

    return {
      success: true,
      path: filePath
    }
  } catch (error) {
    console.error('更新地图失败:', error)
    throw error
  }
})

// 保存地图数据（画板内容）
ipcMain.handle('save-map-data', async (event, { bookName, mapName, mapData }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const bookPath = join(booksDir, bookName)
    const mapsDir = join(bookPath, 'maps')
    if (!fs.existsSync(mapsDir)) {
      fs.mkdirSync(mapsDir, { recursive: true })
    }
    const dataFilePath = join(mapsDir, `${mapName}.data.json`)
    fs.writeFileSync(dataFilePath, JSON.stringify(mapData, null, 2), 'utf-8')
    return {
      success: true,
      path: dataFilePath
    }
  } catch (error) {
    console.error('保存地图数据失败:', error)
    throw error
  }
})

// 加载地图数据（画板内容）
ipcMain.handle('load-map-data', async (event, { bookName, mapName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const dataFilePath = join(booksDir, bookName, 'maps', `${mapName}.data.json`)
    if (!fs.existsSync(dataFilePath)) {
      return null // 婵″倹鐏夊▽鈩冩箒閺佺増宓侀弬鍥︽閿涘矁绻戦崶鐎梪ll
    }
    const data = fs.readFileSync(dataFilePath, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    console.error('加载地图数据失败:', error)
    return null
  }
})

// 删除地图
ipcMain.handle('delete-map', async (event, { bookName, mapName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const mapsDir = join(booksDir, bookName, 'maps')
    const filePath = join(mapsDir, `${mapName}.png`)
    const jsonPath = join(mapsDir, `${mapName}.json`)
    const dataFilePath = join(mapsDir, `${mapName}.data.json`)

    // 删除图片文件
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    // 删除元数据文件
    if (fs.existsSync(jsonPath)) {
      fs.unlinkSync(jsonPath)
    }
    // 删除数据文件
    if (fs.existsSync(dataFilePath)) {
      fs.unlinkSync(dataFilePath)
    }

    return { success: true }
  } catch (error) {
    console.error('删除地图失败:', error)
    throw error
  }
})

// --------- 关系图相关 ---------

// --------- 关系图相关 ---------
ipcMain.handle('read-relationships', async (event, bookName) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const bookPath = join(booksDir, bookName)
    const relationshipsDir = join(bookPath, 'relationships')
    if (!fs.existsSync(relationshipsDir)) {
      fs.mkdirSync(relationshipsDir, { recursive: true })
      return []
    }
    const files = fs.readdirSync(relationshipsDir)
    const relationships = files
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        const name = file.replace('.json', '')
        const jsonPath = join(relationshipsDir, `${name}.json`)
        const pngPath = join(relationshipsDir, `${name}.png`)

        let relationshipData = {}
        let thumbnail = ''

        try {
          // 读取JSON数据
          relationshipData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
        } catch (error) {
          console.error(`读取关系图数据失败: ${name}`, error)
          relationshipData = {
            id: name,
            name: name,
            description: '',
            nodes: [],
            lines: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }

        // 检查PNG缩略图是否存在
        if (fs.existsSync(pngPath)) {
          thumbnail = `${name}.png`
        }

        return {
          id: relationshipData.id || name,
          name: relationshipData.name || name,
          description: relationshipData.description || '',
          thumbnail: thumbnail,
          nodes: relationshipData.nodes || [],
          lines: relationshipData.lines || [],
          createdAt: relationshipData.createdAt || new Date().toISOString(),
          updatedAt: relationshipData.updatedAt || new Date().toISOString()
        }
      })
    return relationships
  } catch (error) {
    console.error('读取关系图列表失败:', error)
    throw error
  }
})

// 读取关系图数据
ipcMain.handle('read-relationship-data', async (event, { bookName, relationshipName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const bookPath = join(booksDir, bookName)
    const relationshipsDir = join(bookPath, 'relationships')
    const jsonPath = join(relationshipsDir, `${relationshipName}.json`)

    if (!fs.existsSync(jsonPath)) {
      return null
    }

    const relationshipData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    return relationshipData
  } catch (error) {
    console.error('读取关系图数据失败:', error)
    throw error
  }
})

// 设置书架已认证（由认证页面在密码验证通过后调用）
ipcMain.handle(
  'create-relationship',
  async (event, { bookName, relationshipName, relationshipData }) => {
    try {
      const booksDir = await store.get('booksDir')
      if (!booksDir) {
        throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
      }
      const bookPath = join(booksDir, bookName)
      const relationshipsDir = join(bookPath, 'relationships')

      if (!fs.existsSync(relationshipsDir)) {
        fs.mkdirSync(relationshipsDir, { recursive: true })
      }

      // 检查同名文件
      const jsonPath = join(relationshipsDir, `${relationshipName}.json`)

      if (fs.existsSync(jsonPath)) {
        throw new Error('瀹告彃鐡ㄩ崷銊ユ倱閸氬秴鍙х化璇叉禈')
      }

      // 只保存JSON数据，不创建PNG文件
      fs.writeFileSync(jsonPath, JSON.stringify(relationshipData, null, 2), 'utf-8')

      return { success: true }
    } catch (error) {
      console.error('获取书籍总字数失败:', error)
      throw error
    }
  }
)

// 设置书架已认证（由认证页面在密码验证通过后调用）
ipcMain.handle(
  'save-relationship-data',
  async (event, { bookName, relationshipName, relationshipData }) => {
    try {
      const booksDir = await store.get('booksDir')
      if (!booksDir) {
        throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
      }
      const bookPath = join(booksDir, bookName)
      const relationshipsDir = join(bookPath, 'relationships')

      if (!fs.existsSync(relationshipsDir)) {
        fs.mkdirSync(relationshipsDir, { recursive: true })
      }

      const jsonPath = join(relationshipsDir, `${relationshipName}.json`)

      // 保存JSON数据
      fs.writeFileSync(jsonPath, JSON.stringify(relationshipData, null, 2), 'utf-8')

      return { success: true }
    } catch (error) {
      console.error('获取书籍总字数失败:', error)
      throw error
    }
  }
)

// 设置书架已认证（由认证页面在密码验证通过后调用）
ipcMain.handle(
  'update-relationship-thumbnail',
  async (event, { bookName, relationshipName, thumbnailData }) => {
    try {
      const booksDir = await store.get('booksDir')
      if (!booksDir) {
        throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
      }
      const bookPath = join(booksDir, bookName)
      const relationshipsDir = join(bookPath, 'relationships')
      const pngPath = join(relationshipsDir, `${relationshipName}.png`)

      if (!fs.existsSync(relationshipsDir)) {
        fs.mkdirSync(relationshipsDir, { recursive: true })
      }

      // 保存PNG缩略图
      if (thumbnailData) {
        const base64Data = thumbnailData.replace(/^data:image\/\w+;base64,/, '')
        const buffer = Buffer.from(base64Data, 'base64')
        fs.writeFileSync(pngPath, buffer)
      }

      return { success: true }
    } catch (error) {
      console.error('获取书籍总字数失败:', error)
      throw error
    }
  }
)

// 删除关系图
ipcMain.handle('delete-relationship', async (event, { bookName, relationshipName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const bookPath = join(booksDir, bookName)
    const relationshipsDir = join(bookPath, 'relationships')
    const jsonPath = join(relationshipsDir, `${relationshipName}.json`)
    const pngPath = join(relationshipsDir, `${relationshipName}.png`)

    // 删除JSON文件
    if (fs.existsSync(jsonPath)) {
      fs.unlinkSync(jsonPath)
    }

    // 检查PNG缩略图是否存在
    if (fs.existsSync(pngPath)) {
      fs.unlinkSync(pngPath)
    }

    return { success: true }
  } catch (error) {
    console.error('删除关系图失败:', error)
    throw error
  }
})

// 读取关系图图片
ipcMain.handle('read-relationship-image', async (event, { bookName, imageName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const bookPath = join(booksDir, bookName)
    const relationshipsDir = join(bookPath, 'relationships')
    const imagePath = join(relationshipsDir, imageName)

    if (!fs.existsSync(imagePath)) {
      throw new Error('閸ュ墽澧栭弬鍥︽娑撳秴鐡ㄩ崷?')
    }

    const data = fs.readFileSync(imagePath)
    return `data:image/png;base64,${data.toString('base64')}`
  } catch (error) {
    console.error('读取关系图图片失败:', error)
    throw error
  }
})

// --------- 组织架构相关 ---------

// --------- 组织架构相关 ---------
ipcMain.handle('read-organizations', async (event, { bookName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const bookPath = join(booksDir, bookName)
    const organizationsDir = join(bookPath, 'organizations')
    if (!fs.existsSync(organizationsDir)) {
      fs.mkdirSync(organizationsDir, { recursive: true })
      return { success: true, data: [] }
    }
    const files = fs.readdirSync(organizationsDir)
    const organizations = files
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        const name = file.replace('.json', '')
        const jsonPath = join(organizationsDir, `${name}.json`)
        const pngPath = join(organizationsDir, `${name}.png`)

        let organizationData = {}
        let thumbnail = ''

        try {
          // 读取JSON数据
          organizationData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
        } catch (error) {
          console.error(`读取组织架构数据失败: ${name}`, error)
          organizationData = {
            id: name,
            name: name,
            description: '',
            nodes: [],
            lines: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }

        // 检查PNG缩略图是否存在
        if (fs.existsSync(pngPath)) {
          thumbnail = `${name}.png`
        }

        return {
          id: organizationData.id || name,
          name: organizationData.name || name,
          description: organizationData.description || '',
          thumbnail: thumbnail,
          nodes: organizationData.nodes || [],
          lines: organizationData.lines || [],
          createdAt: organizationData.createdAt || new Date().toISOString(),
          updatedAt: organizationData.updatedAt || new Date().toISOString()
        }
      })
    return { success: true, data: organizations }
  } catch (error) {
    console.error('读取组织架构列表失败:', error)
    return { success: false, error: error.message }
  }
})

// 读取组织架构数据
ipcMain.handle('read-organization', async (event, { bookName, organizationName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const bookPath = join(booksDir, bookName)
    const organizationsDir = join(bookPath, 'organizations')
    const jsonPath = join(organizationsDir, `${organizationName}.json`)

    if (!fs.existsSync(jsonPath)) {
      return { success: false, error: '缂佸嫮绮愰弸鑸电€稉宥呯摠閸?' }
    }

    const organizationData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    return { success: true, data: organizationData }
  } catch (error) {
    console.error('读取组织架构列表失败:', error)
    return { success: false, error: error.message }
  }
})

// 设置书架已认证（由认证页面在密码验证通过后调用）
ipcMain.handle(
  'create-organization',
  async (event, { bookName, organizationName, organizationData }) => {
    try {
      const booksDir = await store.get('booksDir')
      if (!booksDir) {
        throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
      }
      const bookPath = join(booksDir, bookName)
      const organizationsDir = join(bookPath, 'organizations')

      if (!fs.existsSync(organizationsDir)) {
        fs.mkdirSync(organizationsDir, { recursive: true })
      }

      // 检查同名文件
      const jsonPath = join(organizationsDir, `${organizationName}.json`)

      if (fs.existsSync(jsonPath)) {
        throw new Error('瀹告彃鐡ㄩ崷銊ユ倱閸氬秶绮嶇紒鍥ㄧ仸閺?')
      }

      // 保存JSON数据
      fs.writeFileSync(jsonPath, JSON.stringify(organizationData, null, 2), 'utf-8')

      return { success: true }
    } catch (error) {
      console.error('获取书籍总字数失败:', error)
      throw error
    }
  }
)

// 设置书架已认证（由认证页面在密码验证通过后调用）
ipcMain.handle(
  'write-organization',
  async (event, { bookName, organizationName, organizationData }) => {
    try {
      const booksDir = await store.get('booksDir')
      if (!booksDir) {
        throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
      }
      const bookPath = join(booksDir, bookName)
      const organizationsDir = join(bookPath, 'organizations')

      if (!fs.existsSync(organizationsDir)) {
        fs.mkdirSync(organizationsDir, { recursive: true })
      }

      const jsonPath = join(organizationsDir, `${organizationName}.json`)

      // 保存JSON数据
      fs.writeFileSync(jsonPath, JSON.stringify(organizationData, null, 2), 'utf-8')

      return { success: true }
    } catch (error) {
      console.error('获取书籍总字数失败:', error)
      throw error
    }
  }
)

// 设置书架已认证（由认证页面在密码验证通过后调用）
ipcMain.handle(
  'update-organization-thumbnail',
  async (event, { bookName, organizationId, thumbnailData }) => {
    try {
      const booksDir = await store.get('booksDir')
      if (!booksDir) {
        throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
      }
      const bookPath = join(booksDir, bookName)
      const organizationsDir = join(bookPath, 'organizations')
      const pngPath = join(organizationsDir, `${organizationId}.png`)

      if (!fs.existsSync(organizationsDir)) {
        fs.mkdirSync(organizationsDir, { recursive: true })
      }

      // 保存PNG缩略图
      if (thumbnailData) {
        const base64Data = thumbnailData.replace(/^data:image\/\w+;base64,/, '')
        const buffer = Buffer.from(base64Data, 'base64')
        fs.writeFileSync(pngPath, buffer)
      }

      return { success: true }
    } catch (error) {
      console.error('获取书籍总字数失败:', error)
      throw error
    }
  }
)

// 读取组织架构图片
ipcMain.handle('read-organization-image', async (event, { bookName, imageName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const bookPath = join(booksDir, bookName)
    const organizationsDir = join(bookPath, 'organizations')
    const imagePath = join(organizationsDir, imageName)

    if (!fs.existsSync(imagePath)) {
      throw new Error('閸ュ墽澧栭弬鍥︽娑撳秴鐡ㄩ崷?')
    }

    const data = fs.readFileSync(imagePath)
    return `data:image/png;base64,${data.toString('base64')}`
  } catch (error) {
    console.error('读取组织架构图片失败:', error)
    throw error
  }
})

// 删除组织架构
ipcMain.handle('delete-organization', async (event, { bookName, organizationName }) => {
  try {
    const booksDir = await store.get('booksDir')
    if (!booksDir) {
      throw new Error('閺堫亣顔曠純顔诲姛缁秶娲拌ぐ?')
    }
    const bookPath = join(booksDir, bookName)
    const organizationsDir = join(bookPath, 'organizations')
    const jsonPath = join(organizationsDir, `${organizationName}.json`)
    const pngPath = join(organizationsDir, `${organizationName}.png`)

    // 删除JSON文件
    if (fs.existsSync(jsonPath)) {
      fs.unlinkSync(jsonPath)
    }

    // 检查PNG缩略图是否存在
    if (fs.existsSync(pngPath)) {
      fs.unlinkSync(pngPath)
    }

    return { success: true }
  } catch (error) {
    console.error('删除组织架构失败:', error)
    throw error
  }
})

// --------- 禁词管理相关 ---------

// --------- 禁词管理相关 ---------
ipcMain.handle('get-banned-words', async (event, bookName) => {
  try {
    const booksDir = store.get('booksDir')
    if (!booksDir || !bookName) {
      return { success: false, message: '閸欏倹鏆熼柨娆掝嚖' }
    }
    const bannedWordsPath = join(booksDir, bookName, 'banned-words.json')
    if (!fs.existsSync(bannedWordsPath)) {
      return { success: true, data: [] }
    }
    const data = JSON.parse(fs.readFileSync(bannedWordsPath, 'utf-8'))
    return { success: true, data: data.words || [] }
  } catch (error) {
    console.error('获取禁词列表失败:', error)
    return { success: false, message: error.message }
  }
})

// 添加禁词
ipcMain.handle('add-banned-word', async (event, bookName, word) => {
  try {
    const booksDir = store.get('booksDir')
    if (!booksDir || !bookName || !word) {
      return { success: false, message: '閸欏倹鏆熼柨娆掝嚖' }
    }
    const bannedWordsPath = join(booksDir, bookName, 'banned-words.json')
    let data = { words: [] }
    if (fs.existsSync(bannedWordsPath)) {
      data = JSON.parse(fs.readFileSync(bannedWordsPath, 'utf-8'))
    }
    if (!data.words) {
      data.words = []
    }
    // 检查是否已存在
    if (data.words.includes(word)) {
      return { success: false, message: '鐠囥儳顩︾拠宥呭嚒鐎涙ê婀?' }
    }
    // 新增禁词插入到数组开头，使最新的显示在前面
    data.words.unshift(word)
    fs.writeFileSync(bannedWordsPath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('添加禁词失败:', error)
    return { success: false, message: error.message }
  }
})

// 删除禁词
ipcMain.handle('remove-banned-word', async (event, bookName, word) => {
  try {
    const booksDir = store.get('booksDir')
    if (!booksDir || !bookName || !word) {
      return { success: false, message: '閸欏倹鏆熼柨娆掝嚖' }
    }
    const bannedWordsPath = join(booksDir, bookName, 'banned-words.json')
    if (!fs.existsSync(bannedWordsPath)) {
      return { success: false, message: '缁備浇鐦濋弬鍥︽娑撳秴鐡ㄩ崷?' }
    }
    const data = JSON.parse(fs.readFileSync(bannedWordsPath, 'utf-8'))
    const index = data.words.indexOf(word)
    if (index === -1) {
      return { success: false, message: '缁備浇鐦濇稉宥呯摠閸?' }
    }
    data.words.splice(index, 1)
    fs.writeFileSync(bannedWordsPath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('删除禁词失败:', error)
    return { success: false, message: error.message }
  }
})

