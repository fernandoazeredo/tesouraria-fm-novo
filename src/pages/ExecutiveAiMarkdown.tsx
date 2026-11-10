import type { ReactNode } from 'react'

// Renderizador leve e seguro (sem HTML bruto) para as respostas da IA.
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    const k = `${keyBase}-${i++}`
    if (t.startsWith('**')) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={k}>{t.slice(1, -1)}</code>)
    else if (t.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)
      const href = mm?.[2] || ''
      out.push(href.startsWith('/') ? <a key={k} href={href}>{mm?.[1]}</a> : <span key={k}>{mm?.[1]}</span>)
    } else out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function AiMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: Array<{ level: number; text: string }> } | null = null
  let para: string[] = []
  const flushPara = () => { if (para.length) { blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(' '), `p${blocks.length}`)}</p>); para = [] } }
  const flushList = () => {
    if (!list) return
    const k = `l${blocks.length}`
    const items = list.items.map((it, i) => <li key={i} style={{ marginLeft: it.level * 16 }}>{inline(it.text, `${k}-${i}`)}</li>)
    blocks.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>)
    list = null
  }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    const li = /^(\s*)[*-]\s+(.*)$/.exec(line)
    const ol = /^(\s*)\d+[.)]\s+(.*)$/.exec(line)
    if (!line.trim()) { flushPara(); flushList(); continue }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); flushList(); blocks.push(<hr key={`hr${blocks.length}`} />); continue }
    if (h) { flushPara(); flushList(); const k = `h${blocks.length}`; blocks.push(h[1].length <= 2 ? <h3 key={k}>{inline(h[2], k)}</h3> : <h4 key={k}>{inline(h[2], k)}</h4>); continue }
    if (li || ol) {
      flushPara()
      const ordered = !!ol && !li
      const m = (li || ol)!
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } }
      list.items.push({ level: Math.min(3, Math.floor(m[1].length / 2)), text: m[2] })
      continue
    }
    flushList(); para.push(line.trim())
  }
  flushPara(); flushList()
  return <div className="executive-ai-md">{blocks}</div>
}
