/** `trajectory` namespace dictionaries (view tab label + toolbar strings). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'trajectory'

/** The trajectory dictionary key set (the source of truth for both locales). */
export type TrajectoryKey =
  | 'view.trajectory'
  | 'view.trace'
  | 'trace.eyebrow' | 'trace.summary' | 'trace.empty' | 'trace.turn'
  | 'trace.user' | 'trace.reasoning' | 'trace.answer' | 'trace.command'
  | 'trace.retry' | 'trace.failed' | 'trace.completed' | 'trace.maxTokens'
  | 'trace.lane.intent' | 'trace.lane.reasoning' | 'trace.lane.tools' | 'trace.lane.evidence'
  | 'toolbar.aria'
  | 'toolbar.duration'
  | 'toolbar.useActualDuration'
  | 'toolbar.useEqualWidth'
  | 'toolbar.actualTime'
  | 'toolbar.turns'
  | 'toolbar.expandTurns'
  | 'toolbar.collapseTurns'
  | 'toolbar.calls'
  | 'toolbar.expandCalls'
  | 'toolbar.collapseCalls'
  | 'toolbar.search'
  | 'toolbar.searchPlaceholder'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The trajectory view tab label and toolbar strings. */
    'trajectory': TrajectoryKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<TrajectoryKey, string> = {
  'view.trajectory': '轨迹',
  'view.trace': '泳道',
  'trace.eyebrow': '语义轨迹',
  'trace.summary': '{turns} 轮 · {steps} 步',
  'trace.empty': '开始一次研究对话后，真实步骤会显示在这里。',
  'trace.turn': '第 {turn} 轮',
  'trace.user': '用户问题',
  'trace.reasoning': 'Agent 判断',
  'trace.answer': '回答与证据',
  'trace.command': '命令',
  'trace.retry': '模型重试',
  'trace.failed': '执行失败',
  'trace.completed': '执行完成',
  'trace.maxTokens': '达到输出上限',
  'trace.lane.intent': '用户意图',
  'trace.lane.reasoning': 'Agent 判断',
  'trace.lane.tools': '工具与数据',
  'trace.lane.evidence': '证据与回答',
  'toolbar.aria': '轨迹工具栏',
  'toolbar.duration': 'Duration',
  'toolbar.useActualDuration': 'Use actual duration',
  'toolbar.useEqualWidth': 'Use equal-width operations',
  'toolbar.actualTime': '实际时间',
  'toolbar.turns': 'Turns',
  'toolbar.expandTurns': 'Expand turns',
  'toolbar.collapseTurns': 'Collapse turns',
  'toolbar.calls': 'Calls',
  'toolbar.expandCalls': 'Expand calls',
  'toolbar.collapseCalls': 'Collapse calls',
  'toolbar.search': '搜索轨迹',
  'toolbar.searchPlaceholder': '搜索',
}

/** English dictionary. */
export const en: Record<TrajectoryKey, string> = {
  'view.trajectory': 'Trajectory',
  'view.trace': 'Trace',
  'trace.eyebrow': 'Semantic trace',
  'trace.summary': '{turns} turns · {steps} steps',
  'trace.empty': 'Real steps will appear here after a research conversation starts.',
  'trace.turn': 'Turn {turn}',
  'trace.user': 'User question',
  'trace.reasoning': 'Agent judgment',
  'trace.answer': 'Answer and evidence',
  'trace.command': 'Command',
  'trace.retry': 'Model retry',
  'trace.failed': 'Execution failed',
  'trace.completed': 'Execution complete',
  'trace.maxTokens': 'Output limit reached',
  'trace.lane.intent': 'User intent',
  'trace.lane.reasoning': 'Agent judgment',
  'trace.lane.tools': 'Tools and data',
  'trace.lane.evidence': 'Evidence and answer',
  'toolbar.aria': 'Trajectory toolbar',
  'toolbar.duration': 'Duration',
  'toolbar.useActualDuration': 'Use actual duration',
  'toolbar.useEqualWidth': 'Use equal-width operations',
  'toolbar.actualTime': 'Actual time',
  'toolbar.turns': 'Turns',
  'toolbar.expandTurns': 'Expand turns',
  'toolbar.collapseTurns': 'Collapse turns',
  'toolbar.calls': 'Calls',
  'toolbar.expandCalls': 'Expand calls',
  'toolbar.collapseCalls': 'Collapse calls',
  'toolbar.search': 'Search trajectory',
  'toolbar.searchPlaceholder': 'Search',
}
