/** `science` namespace dictionaries for the dedicated chart and Outcome rows. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'science'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chart.title': '图表',
  'chart.running': '正在保存图表',
  'chart.failed': '图表保存失败',
  'chart.stopped': '图表保存已中止',
  'chart.version': 'v{version}',
  'chart.sourceRun': '来自运行 {runId}',
  'chart.dimensions': '{width}×{height}，{size}',
  'chart.open': '查看原图',
  'chart.openNamed': '查看原图：{label}',
  'chart.loading': '加载中…',
  'chart.loadFailed': '加载失败，点击重试',
  'chart.lightboxClose': '关闭',
  'chart.lightboxOriginal': '原图',
  'outcome.title': '结论',
  'outcome.revision': '第 {revision} 版',
  'outcome.running': '正在发布结论',
  'outcome.failed': '结论发布失败',
  'outcome.stopped': '结论发布已中止',
  'outcome.evidence': '依据',
  'outcome.evidenceRun': '运行 {runId}',
  'outcome.evidenceChart': '图表 {chartId} v{version}',
  'outcome.evidenceMessage': '消息 #{seq}',
  'outcome.chartMissing': '引用的图表不可用',
} satisfies Record<string, string>

/** The science namespace key union. */
export type ScienceKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chart.title': 'Chart',
  'chart.running': 'Saving chart',
  'chart.failed': 'Chart save failed',
  'chart.stopped': 'Chart save stopped',
  'chart.version': 'v{version}',
  'chart.sourceRun': 'from run {runId}',
  'chart.dimensions': '{width}×{height}, {size}',
  'chart.open': 'View original',
  'chart.openNamed': 'View original: {label}',
  'chart.loading': 'Loading…',
  'chart.loadFailed': 'Failed to load, click to retry',
  'chart.lightboxClose': 'Close',
  'chart.lightboxOriginal': 'Original',
  'outcome.title': 'Outcome',
  'outcome.revision': 'revision {revision}',
  'outcome.running': 'Publishing outcome',
  'outcome.failed': 'Outcome publish failed',
  'outcome.stopped': 'Outcome publish stopped',
  'outcome.evidence': 'Evidence',
  'outcome.evidenceRun': 'run {runId}',
  'outcome.evidenceChart': 'chart {chartId} v{version}',
  'outcome.evidenceMessage': 'message #{seq}',
  'outcome.chartMissing': 'The cited chart is unavailable',
} satisfies Record<ScienceKey, string>
