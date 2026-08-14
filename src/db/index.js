// IndexedDB 数据层
// 统一封装视频、文件夹、打卡三类数据的增删改查，全部返回 Promise。
// 说明：视频文件以 Blob 形式直接存入 IndexedDB，播放时用 URL.createObjectURL 生成临时地址。

const DB_NAME = 'fit-segment'
const DB_VERSION = 1

// 三个对象仓库（object store）
const STORE_VIDEOS = 'videos'
const STORE_FOLDERS = 'folders'
const STORE_CHECKINS = 'checkins'

let dbPromise = null

/** 打开数据库（懒加载，复用同一个连接） */
function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      // 视频：{ id, name, blob, duration, thumbnail, folderId, segments, createdAt }
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
        db.createObjectStore(STORE_VIDEOS, { keyPath: 'id' })
      }
      // 文件夹：{ id, name, createdAt }
      if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
        db.createObjectStore(STORE_FOLDERS, { keyPath: 'id' })
      }
      // 打卡：{ id, videoId, date, timestamp }
      if (!db.objectStoreNames.contains(STORE_CHECKINS)) {
        db.createObjectStore(STORE_CHECKINS, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

/**
 * 在某个仓库上执行操作，等事务提交后返回结果。
 * fn 的第二个参数 setOut 用于把 request 的结果传出来。
 */
function run(storeName, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const store = tx.objectStore(storeName)
        let out
        fn(store, (value) => {
          out = value
        })
        tx.oncomplete = () => resolve(out)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
  )
}

/** 生成简单的唯一 id（不依赖 crypto 的安全上下文要求） */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ---------- 视频 ----------

export function getAllVideos() {
  return run(STORE_VIDEOS, 'readonly', (store, setOut) => {
    store.getAll().onsuccess = (e) => setOut(e.target.result)
  })
}

export function getVideo(id) {
  return run(STORE_VIDEOS, 'readonly', (store, setOut) => {
    store.get(id).onsuccess = (e) => setOut(e.target.result)
  })
}

/**
 * 把（可能是 Vue reactive 代理的）视频对象转成普通对象。
 * IndexedDB 的结构化克隆无法克隆 Proxy，必须转成 plain object 再写入。
 */
function plainVideo(v) {
  return {
    id: v.id,
    name: v.name,
    blob: v.blob,
    duration: v.duration,
    thumbnail: v.thumbnail,
    folderId: v.folderId,
    segments: (v.segments || []).map((s) => ({
      id: s.id,
      name: s.name,
      start: s.start,
      end: s.end,
    })),
    createdAt: v.createdAt,
  }
}

export function addVideo(video) {
  const plain = plainVideo(video)
  return run(STORE_VIDEOS, 'readwrite', (store, setOut) => {
    store.add(plain).onsuccess = () => setOut(plain.id)
  })
}

export function updateVideo(video) {
  const plain = plainVideo(video)
  return run(STORE_VIDEOS, 'readwrite', (store, setOut) => {
    store.put(plain).onsuccess = () => setOut(plain.id)
  })
}

export function deleteVideo(id) {
  return run(STORE_VIDEOS, 'readwrite', (store) => {
    store.delete(id)
  })
}

// ---------- 文件夹 ----------

export function getAllFolders() {
  return run(STORE_FOLDERS, 'readonly', (store, setOut) => {
    store.getAll().onsuccess = (e) => setOut(e.target.result)
  })
}

export function addFolder(folder) {
  return run(STORE_FOLDERS, 'readwrite', (store, setOut) => {
    store.add(folder).onsuccess = () => setOut(folder.id)
  })
}

export function updateFolder(folder) {
  return run(STORE_FOLDERS, 'readwrite', (store, setOut) => {
    store.put(folder).onsuccess = () => setOut(folder.id)
  })
}

export function deleteFolder(id) {
  return run(STORE_FOLDERS, 'readwrite', (store) => {
    store.delete(id)
  })
}

// ---------- 打卡 ----------

export function getAllCheckins() {
  return run(STORE_CHECKINS, 'readonly', (store, setOut) => {
    store.getAll().onsuccess = (e) => setOut(e.target.result)
  })
}

export function addCheckin(checkin) {
  return run(STORE_CHECKINS, 'readwrite', (store, setOut) => {
    const req = store.add(checkin)
    req.onsuccess = () => setOut(req.result)
  })
}

/** 删除指定视频的全部打卡记录（用于「清除打卡次数」） */
export function deleteCheckinsByVideo(videoId) {
  return run(STORE_CHECKINS, 'readwrite', (store) => {
    const req = store.openCursor()
    req.onsuccess = (e) => {
      const cursor = e.target.result
      if (cursor) {
        if (cursor.value.videoId === videoId) {
          cursor.delete()
        }
        cursor.continue()
      }
    }
  })
}
