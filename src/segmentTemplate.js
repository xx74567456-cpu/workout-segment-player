// 分段模板：把视频的剪辑分段信息（segments）导出成独立 JSON 文件，
// 供他人导入后直接套用到同一段视频上，省去手动切分。
// 模板只保留 name/start/end，不含各视频自己的分段 id（导入时用 uid() 重新生成）。
import { uid } from './db'

const APP = 'fit-segment'
const TYPE = 'segment-template'

/** 从视频对象构建模板对象（segments 去掉 id，按时间排序） */
export function buildTemplate(video) {
  const segments = (video.segments || [])
    .map((s) => ({ name: s.name, start: s.start, end: s.end }))
    .sort((a, b) => a.start - b.start)
  return {
    app: APP,
    type: TYPE,
    version: 1,
    sourceName: video.name || '',
    duration: video.duration || 0,
    segments,
  }
}

/** 解析并校验模板文件内容，返回 { sourceName, duration, segments }，不合法则抛错 */
export function parseTemplate(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  if (!data || data.app !== APP || data.type !== TYPE) {
    throw new Error('不是有效的分段模板文件')
  }
  if (!Array.isArray(data.segments) || !data.segments.length) {
    throw new Error('模板中没有分段')
  }
  for (const s of data.segments) {
    if (!s || typeof s.name !== 'string' || !Number.isFinite(s.start) || !Number.isFinite(s.end)) {
      throw new Error('模板分段格式错误')
    }
  }
  return {
    sourceName: data.sourceName || '',
    duration: Number.isFinite(data.duration) ? data.duration : 0,
    segments: data.segments,
  }
}

/** 把模板套用到目标视频上：重新生成 id、裁剪到视频时长内、过滤无效段，返回最终分段列表 */
export function applyTemplate(video, template) {
  const d = video.duration || 0
  video.segments = template.segments
    .map((s) => ({
      id: uid(),
      name: s.name,
      start: Math.max(0, Math.min(d, s.start)),
      end: Math.max(0, Math.min(d, s.end)),
    }))
    .filter((s) => s.end - s.start > 0.5)
    .sort((a, b) => a.start - b.start)
  return video.segments
}
