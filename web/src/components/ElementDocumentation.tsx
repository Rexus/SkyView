import { useState } from 'react'
import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({ html: false })
const safeLink = markdown.validateLink.bind(markdown)
markdown.validateLink = href => safeLink(href) && !/^data:/i.test(href)

// A documentation preview must never download an image on behalf of its reader.
markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index]
  const url = markdown.utils.escapeHtml(String(token.attrGet('src') ?? ''))
  const label = markdown.utils.escapeHtml(token.content || 'Image')
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
}
const renderLink = markdown.renderer.rules.link_open
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const href = tokens[index].attrGet('href')
  if (typeof href === 'string' && !href.startsWith('#')) {
    tokens[index].attrSet('target', '_blank')
    tokens[index].attrSet('rel', 'noopener noreferrer')
  }
  return renderLink?.(tokens, index, options, env, renderer) ?? renderer.renderToken(tokens, index, options)
}

export default function ElementDocumentation({ value, onChange }: {
  value: string
  onChange?: (value: string) => void
}) {
  const [mode, setMode] = useState<'code' | 'preview'>('preview')
  return (
    <section className="field element-doc" aria-label="Documentation">
      <div className="element-doc-header">
        <span className="field-label">Documentation</span>
        <div className="segmented" role="group" aria-label="Documentation view">
          <button type="button" aria-pressed={mode === 'code'} className={mode === 'code' ? 'active' : ''}
            onClick={() => setMode('code')}>Code</button>
          <button type="button" aria-pressed={mode === 'preview'} className={mode === 'preview' ? 'active' : ''}
            onClick={() => setMode('preview')}>Preview</button>
        </div>
      </div>
      {mode === 'code' ? (
        <textarea className="textarea mono" aria-label="Documentation Markdown" value={value} rows={3}
          placeholder="Write Markdown…" readOnly={!onChange} onChange={e => onChange?.(e.target.value)} />
      ) : value.trim() ? (
        <div className="element-doc-preview" dangerouslySetInnerHTML={{ __html: markdown.render(value) }} />
      ) : (
        <p className="element-doc-preview element-doc-empty">No documentation</p>
      )}
    </section>
  )
}
